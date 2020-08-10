#!/usr/bin/env ruby
require 'openssl'

puts [OpenSSL::Random.random_bytes(384/8)].pack('m0')
