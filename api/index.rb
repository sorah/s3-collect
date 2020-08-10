require 'time'
require 'json'
require 'openssl'
require 'aws-sdk-ssm'
require 'aws-sdk-sts'
require 'uri'
require 'net/http'

module Api
  class BadRequest < StandardError; end
  class NotFound < StandardError; end
  class Forbidden < StandardError; end

  class << self
    def sts
      @sts ||= Aws::STS::Client.new
    end
    def ssm
      @ssm ||= Aws::SSM::Client.new
    end
    def region
      @region ||= ssm.config.region
    end

    def client_role_arn
      @client_role_arn ||= ENV.fetch('S3COLLECT_CLIENT_ROLE_ARN')
    end
    def files_bucket
      @files_bucket ||= ENV.fetch('S3COLLECT_FILES_BUCKET')
    end
    def psk_secret
      @psk_secret ||= ENV.fetch('S3COLLECT_PSK_SECRET')
    end
    def slack_webhook_url
      @slack_webhook_url ||= URI.parse(ENV.fetch('S3COLLECT_SLACK_WEBHOOK_URL'))
    end


    def psks
      @psks ||= {}
    end

    def get_psk(name)
      return psks[name] if psks[name]
      psks[name] ||= ssm.get_parameter(name: psk_secret, with_decryption: true).parameter.value.each_line.find { |_| _.start_with?("#{name}:") }&.split(?:,2)&.last&.unpack1('m*')
    end

    Token = Struct.new(:version, :key, :signature, :expiry, :campaign) do
      def complete?
        version && key && signature && campaign && expiry
      end

      def signature_payload
        "#{expiry}:#{campaign}"
      end
    end

    def verify_token(token_str)
      return nil unless token_str
      token = Token.new(*token_str.split(?:,5))
      return nil unless token.complete?

      psk = get_psk(token.key)
      return nil unless psk

      return nil if Time.now > Time.at(token.expiry.to_i)

      expected_signature = OpenSSL::HMAC.hexdigest("sha384", psk, token.signature_payload)
      return nil unless secure_compare(expected_signature, token.signature)

      return token
    end

    ContinuationHandler = Struct.new(:version, :signature, :expiry, :session_prefix) do
      def complete?
        version && signature && expiry && session_prefix
      end

      def signature_payload
        "#{expiry}:#{session_prefix}"
      end
    end

    def verify_continuation_handler(key, handler_str)
      return nil unless handler_str
      handler = ContinuationHandler.new(*handler_str.split(?:,4))
      return nil unless handler.complete?

      psk = get_psk(key)
      return nil unless psk

      return nil if Time.now > Time.at(handler.expiry.to_i)

      expected_signature = OpenSSL::HMAC.hexdigest("sha384", psk, handler.signature_payload)
      return nil unless secure_compare(expected_signature, handler.signature)

      return handler
    end

    def create_continuation_handler(key, prefix, expires_in: 3600)
      psk = get_psk(key)
      handler = ContinuationHandler.new('1', nil, (Time.now + expires_in).to_i.to_s, prefix)
      signature = OpenSSL::HMAC.hexdigest('sha384', psk, handler.signature_payload)
      "#{handler.version}:#{signature}:#{handler.expiry}:#{handler.session_prefix}"
    end


    def handler(event:, context:)
      p id: context.aws_request_id, event: event, context: context
      resp = case event.fetch('routeKey')
      when 'POST /sessions'
        return post_sessions(event, context)
      when 'POST /complete'
        return post_complete(event, context)
      else
        raise NotFound, "404: #{event.fetch('routeKey')}"
      end
      p(id: context.aws_request_id, response: {status: response['statusCode'], body: (400..499).cover?(response['statusCode']) ? response['body'] : nil})
    rescue BadRequest => e
      $stderr.puts e.full_message
      return {'isBase64Encoded' => false, 'statusCode' => 400, 'headers' => {'Content-Type': 'application/json'}, 'body' => {message: e.message}.to_json}
    rescue NotFound => e
      $stderr.puts e.full_message
      return {'isBase64Encoded' => false, 'statusCode' => 404, 'headers' => {'Content-Type': 'application/json'}, 'body' => {message: e.message}.to_json}
    rescue Forbidden => e
      $stderr.puts e.full_message
      return {'isBase64Encoded' => false, 'statusCode' => 403, 'headers' => {'Content-Type': 'application/json'}, 'body' => {message: e.message}.to_json}
    end

    def post_sessions(event, context)
      body = JSON.parse(event.fetch('body') || '')
      name = body&.dig('name') or raise BadRequest, "name is missing"
      raise BadRequest, "name has an invalid format" unless name.match?(/\A[a-zA-Z0-9._\-]{1,20}\z/)
      token = verify_token(body&.fetch('token')) or raise Forbidden, "token is invalid; likely mistyped or expired"

      time = Time.at(event.fetch('requestContext').fetch('timeEpoch')/1000).utc.iso8601.gsub(':','').gsub('-','')
      session_prefix = case
                       when body['continuation_handler']
                         (verify_continuation_handler(token.key, body['continuation_handler']) or raise BadRequest, "invalid continuation_handler")
                           .session_prefix
                       else
                         "#{time}--#{context.aws_request_id}"
                       end

      prefix = "#{token.campaign}/#{name}/#{session_prefix}/"
      role_session = sts.assume_role(
        duration_seconds: 3600,
        role_arn: client_role_arn,
        role_session_name: "#{name.gsub(/[_ ]/,'-')}@#{context.aws_request_id}",
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: %w(
                s3:PutObject
                s3:AbortMultipartUpload
              ),
              Resource: "arn:aws:s3:::#{files_bucket}/#{prefix}*",
            },
          ],
        }.to_json,
      )

      {
        'statusCode' => 200,
        'isBase64Encoded' => false,
        'headers' => {'Content-Type' => 'application/json'},
        'body' => {
          region: region,
          bucket: files_bucket,
          prefix: prefix,
          use_accelerated_endpoint: true,
          refresh_after: 3500,
          continuation_handler: create_continuation_handler(token.key, session_prefix),
          credentials: {
            access_key_id: role_session.credentials.access_key_id,
            secret_access_key: role_session.credentials.secret_access_key,
            session_token: role_session.credentials.session_token,
          },
        }.to_json,
      }
    rescue JSON::ParserError
      raise BadRequest, "Payload has an invalid JSON"
    end

    def post_complete(event, context)
      body = JSON.parse(event.fetch('body') || '')
      name = body&.dig('name') or raise BadRequest, "name is missing"
      raise BadRequest, "name has an invalid format" unless name.match?(/\A[a-zA-Z0-9._\-]{1,20}\z/)
      token = verify_token(body&.fetch('token')) or raise Forbidden, "token is invalid; likely mistyped or expired"
      session_prefix = (verify_continuation_handler(token.key, body['continuation_handler']) or raise BadRequest, "invalid continuation_handler")
                        .session_prefix

      prefix = "#{token.campaign}/#{name}/#{session_prefix}/"
      s3_console_url = "https://s3.console.aws.amazon.com/s3/buckets/#{URI.encode_www_form_component(files_bucket)}/#{prefix}"

      Net::HTTP.post_form(
        slack_webhook_url,
        payload: {text: ":mailbox: #{name} uploaded files to #{token.campaign} (<#{s3_console_url}|S3 console>)"}.to_json,
      )

      {
        'statusCode' => 200,
        'isBase64Encoded' => false,
        'headers' => {'Content-Type' => 'application/json'},
        'body' => {
          ok: true,
        }.to_json,
      }
    rescue JSON::ParserError
      raise BadRequest, "Payload has an invalid JSON"
    end

    ##
    # https://github.com/rack/rack/blob/master/lib/rack/utils.rb
    # https://github.com/rack/rack/blob/master/MIT-LICENSE
    def secure_compare(a, b)
      return false unless a.bytesize == b.bytesize

      l = a.unpack("C*")

      r, i = 0, -1
      b.each_byte { |v| r |= v ^ l[i += 1] }
      r == 0
    end
  end
end

def handler(event:, context:)
  Api.handler(event: event, context: context)
end
