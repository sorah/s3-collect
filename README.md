# s3-collect

## Development

```
ruby api/local.rb &
npx webpack-dev-server --progress
```

## Deploy

```
yarn build && cdk deploy \
  -c certificate_arn="arn:aws:acm:us-east-1:...:certificate/..." \
  -c cf_domain="s3collect.example.org" \
  -c psks_parameter_arn="arn:aws:ssm:...:...:parameter/s3collect/psks"
  -c slack_webhook_url="https://..."
```

## Generate PSK

```
ruby bin/generate-psk.rb
```

Set it to SSM SecureString, add new line under a format `${NAME}:${PSK}`

## Generate and sign token

```
ruby bin/sign-token.rb key_name campaign_name expires_in_seconds
```
