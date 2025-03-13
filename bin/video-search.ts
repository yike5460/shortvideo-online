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
  externalVideoEmbeddingEndpoint: app.node.tryGetContext('externalVideoEmbeddingEndpoint') || process.env.EXTERNAL_EMBEDDING_ENDPOINT || ''
});

app.synth();
