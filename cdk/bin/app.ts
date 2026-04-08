#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WeolbuN8nStack } from '../lib/weolbu-n8n-stack';

const app = new cdk.App();

new WeolbuN8nStack(app, 'WeolbuN8nStack', {
  env: {
    account: '299743443000',
    region: 'ap-northeast-2',
  },
});
