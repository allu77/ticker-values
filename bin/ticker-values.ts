#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { TickerValuesStack } from '../lib/ticker-values-stack';
import * as dotenv from 'dotenv';

// Load environment variables from .env file if present
dotenv.config();

const app = new cdk.App();

// Priority: CDK context (command line -c) > environment variables
const googleSpreadsheetId = app.node.tryGetContext('googleSpreadsheetId') || process.env.GOOGLE_SPREADSHEET_ID;
const alertEmail = app.node.tryGetContext('alertEmail') || process.env.ALERT_EMAIL;

if (!googleSpreadsheetId) {
  throw new Error('googleSpreadsheetId is required. Provide it via CDK context (-c googleSpreadsheetId=YOUR_ID) or GOOGLE_SPREADSHEET_ID environment variable');
}

if (!alertEmail) {
  throw new Error('alertEmail is required. Provide it via CDK context (-c alertEmail=YOUR_EMAIL) or ALERT_EMAIL environment variable');
}

new TickerValuesStack(app, 'TickerValuesStack', {
  spreadSheetId: googleSpreadsheetId,
  alertEmail: alertEmail,

  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});
