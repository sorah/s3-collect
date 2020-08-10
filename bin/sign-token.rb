#!/usr/bin/env ruby
require 'openssl'
require 'aws-sdk-ssm'
@ssm = Aws::SSM::Client.new
@psk_secret = ENV.fetch('S3COLLECT_PSK_SECRET')
@psks = {}
def get_psk(name)
  return @psks[name] if @psks[name]
  @psks[name] ||= @ssm.get_parameter(name: @psk_secret, with_decryption: true).parameter.value.each_line.find { |_| _.start_with?("#{name}:") }&.split(?:,2)&.last&.unpack1('m*')
end

if ARGV.length < 3
  abort "usage: #$0 key_name campaign_name expires_in"
end

key_name = ARGV[0]

psk = get_psk(key_name)
campaign = ARGV[1]
expiry = Time.now + ARGV[2].to_i

signature = OpenSSL::HMAC.hexdigest("sha384", psk, "#{expiry.to_i}:#{campaign}")
puts "1:#{key_name}:#{signature}:#{expiry.to_i}:#{campaign}"
