#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EksStack } from '../lib/cdk-stack';
import { getConfig } from "./config";


const app = new cdk.App();
const config = getConfig();

new EksStack(app, 'EksStack', {
  config,
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION, 
  },
});