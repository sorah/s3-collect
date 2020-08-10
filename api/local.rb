require_relative './index.rb'
require 'time'
require 'securerandom'
require 'sinatra'

MyContext = Struct.new(:aws_request_id, keyword_init: true)
post '/api-prd/sessions' do
  r = Api.handler(
    event: {
      'routeKey' => 'POST /sessions',
      'body' => request.body.tap(&:rewind).read,
      'requestContext' => {'timeEpoch' => Time.now.to_i*1000},
    },
    context: MyContext.new(
      aws_request_id: "#{Time.now.to_i}-#{SecureRandom.urlsafe_base64(12)}"
    ),
  )
  content_type :json
  status r.fetch('statusCode')
  r.fetch('body')
end

post '/api-prd/complete' do
  r = Api.handler(
    event: {
      'routeKey' => 'POST /complete',
      'body' => request.body.tap(&:rewind).read,
      'requestContext' => {'timeEpoch' => Time.now.to_i*1000},
    },
    context: MyContext.new(
      aws_request_id: "#{Time.now.to_i}-#{SecureRandom.urlsafe_base64(12)}"
    ),
  )
  content_type :json
  status r.fetch('statusCode')
  r.fetch('body')
end
