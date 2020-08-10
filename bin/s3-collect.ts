#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { S3CollectStack } from '../lib/s3-collect-stack';

const app = new cdk.App();
new S3CollectStack(app, 'S3CollectStack', { 
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION,
  },
});
