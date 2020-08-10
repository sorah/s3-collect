import * as cdk from '@aws-cdk/core';
import * as acm from '@aws-cdk/aws-certificatemanager';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as s3 from '@aws-cdk/aws-s3';
import * as s3deploy from '@aws-cdk/aws-s3-deployment';
import * as ssm from '@aws-cdk/aws-ssm';
import * as kms from '@aws-cdk/aws-kms';

export class S3CollectStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tag.add(this, 'Project', 's3-collect');
    const cfDomain = this.node.tryGetContext('cf_domain');

    const filesBucket = new s3.Bucket(this, 'files-bucket', {});
    (filesBucket.node.defaultChild as s3.CfnBucket).accelerateConfiguration = { accelerationStatus: "Enabled" };
    filesBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD, s3.HttpMethods.POST, s3.HttpMethods.PUT, s3.HttpMethods.DELETE],
      allowedOrigins: [`https://${cfDomain}`, "http://localhost:3000", "http://localhost:3001"],
      allowedHeaders: ["Authorization", "Content-Type", "x-amz-content-sha256","x-amz-date","x-amz-security-token","x-amz-user-agent"],
      exposedHeaders: ["ETag"],
    });
    filesBucket.addLifecycleRule({
      enabled: true,
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(14),
    });

    const uiBucket = new s3.Bucket(this, 'ui-bucket', {});
    uiBucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [uiBucket.arnForObjects('*')],
      principals: [new iam.AnyPrincipal()],
    }));

    const clientRole = new iam.Role(this, 'client-role', {
      assumedBy: new iam.AccountRootPrincipal(),
    });
    clientRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:AbortMultipartUpload'],
      resources: [filesBucket.arnForObjects('*')],
    }));

    const ssmKmsKey = kms.Alias.fromAliasName(this, 'ssm', 'alias/aws/ssm');
    // const pskSecret = new ssm.StringParameter(this, 'psks', { type: ssm.ParameterType.SECURE_STRING, stringValue: '-' });

    const apiRole = new iam.Role(this, 'api-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    apiRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    apiRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: [clientRole.roleArn],
    }));
    apiRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter*'],
      resources: [this.node.tryGetContext('psks_parameter_arn')],
    }));
    apiRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['kms:Decrypt'],
      resources: [ssmKmsKey.keyArn],
      conditions: {StringEquals: {"kms:EncryptionContext:PARAMETER_ARN": this.node.tryGetContext('psks_parameter_arn')}},
    }));

    const fn = new lambda.Function(this, 'api-lambda', {
      code: lambda.Code.fromAsset('./api'),
      handler: 'index.handler',
      runtime: lambda.Runtime.RUBY_2_7,
      role: apiRole,
      environment: {
        S3COLLECT_CLIENT_ROLE_ARN: clientRole.roleArn,
        S3COLLECT_FILES_BUCKET: filesBucket.bucketName,
        S3COLLECT_PSK_SECRET: this.node.tryGetContext('psks_parameter_arn').replace(/^arn:.+:parameter\//, '/'),
        S3COLLECT_SLACK_WEBHOOK_URL: this.node.tryGetContext('slack_webhook_url'),
      },
    });

    const apiBackend = new apigatewayv2.LambdaProxyIntegration({
      handler: fn,
      payloadFormatVersion: apigatewayv2.PayloadFormatVersion.VERSION_2_0,
    });
    const api = new apigatewayv2.HttpApi(this, 'api', {
      apiName: 's3-collect-api',
      createDefaultStage: false,
    });
    api.addRoutes({
      path: '/sessions',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: apiBackend,
    });
    api.addRoutes({
      path: '/complete',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: apiBackend,
    });

    const apiStage = new apigatewayv2.HttpStage(this, 'api-stage-prd', {
      stageName: 'api-prd',
      autoDeploy: true,
      httpApi: api,
    });


    const cert = acm.Certificate.fromCertificateArn(this, 'cert', this.node.tryGetContext('certificate_arn'));

    const dist = new cloudfront.CloudFrontWebDistribution(this, 'distribution', {
      aliasConfiguration: {
        names: [cfDomain],
        acmCertRef: cert.certificateArn,
        securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2018,
        sslMethod: cloudfront.SSLMethod.SNI,
      },
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      enableIpV6: true,
      defaultRootObject: 'index.html',
      originConfigs: [
        {
          customOriginSource: {
            domainName: `${api.httpApiId}.execute-api.${this.region}.${this.urlSuffix}`,
          },
          behaviors: [
            {
              isDefaultBehavior: false,
              pathPattern: `/${apiStage.stageName}/*`,
              allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
              defaultTtl: cdk.Duration.seconds(0),
              minTtl: cdk.Duration.seconds(0),
              maxTtl: cdk.Duration.seconds(0),
              forwardedValues: {
                headers: ['X-Requested-With'],
                queryString: true,
                queryStringCacheKeys: [],
              },
            },
          ],
        },
        {
          s3OriginSource: {
            s3BucketSource: uiBucket,
          },
          behaviors: [
            {
              isDefaultBehavior: true,
              allowedMethods: cloudfront.CloudFrontAllowedMethods.GET_HEAD,
              cachedMethods: cloudfront.CloudFrontAllowedCachedMethods.GET_HEAD,
              compress: true,
              defaultTtl: cdk.Duration.seconds(0),
              minTtl: cdk.Duration.seconds(0),
              maxTtl: cdk.Duration.seconds(31536000),
            },
          ],
        },
      ],
    });

    new s3deploy.BucketDeployment(this, 'ui-dpl-assets', {
      sources: [s3deploy.Source.asset('./dist/ui', {exclude: ['index.html']})],
      destinationBucket: uiBucket,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
      prune: false,
    });
    new s3deploy.BucketDeployment(this, 'ui-dpl-html', {
      sources: [s3deploy.Source.asset('./dist/ui', {exclude: ['*', '!index.html']})],
      destinationBucket: uiBucket,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=0, s-maxage=31536000')],
      distribution: dist,
      distributionPaths: ['/', '/index.html'],
      prune: false,
    });
  }
}
