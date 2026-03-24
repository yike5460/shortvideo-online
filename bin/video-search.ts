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
  deploymentEnvironment: process.env.DEPLOYMENT_ENV || 'dev',
  maxAzs: 2,
  appDomain: app.node.tryGetContext('appDomain') || process.env.APP_DOMAIN,
  siliconflowApiKey: app.node.tryGetContext('siliconflowApiKey') || process.env.SILICONFLOW_API_KEY || '',
  googleApiKey: app.node.tryGetContext('googleApiKey') || process.env.GOOGLE_API_KEY || '',
  validationModel: app.node.tryGetContext('validationModel') || process.env.VALIDATION_MODEL || ''
});

app.synth();
