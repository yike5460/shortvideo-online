#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VideoSearchStack } from '../lib/video-search-stack';

const app = new cdk.App();
new VideoSearchStack(app, 'VideoSearchStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  environment: process.env.DEPLOYMENT_ENV || 'dev',
  maxAzs: 2,
});

app.synth(); 