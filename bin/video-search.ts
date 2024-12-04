import { App } from 'aws-cdk-lib';
import { VideoSearchStack } from '../lib/video-search-stack';

const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new VideoSearchStack(app, 'shortvideo-online-dev', { env: devEnv });

app.synth(); 