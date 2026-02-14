#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { TickerValuesStack } from '../lib/ticker-values-stack';

const app = new cdk.App();

// Retrieve Google Spreadsheet ID from CDK context
const googleSpreadsheetId = app.node.tryGetContext('googleSpreadsheetId');
const alertEmail = app.node.tryGetContext('alertEmail');

if (!googleSpreadsheetId) {
  throw new Error('googleSpreadsheetId context parameter is required. Please provide it using: cdk deploy -c googleSpreadsheetId=YOUR_SPREADSHEET_ID');
}

if (!alertEmail) {
  throw new Error('alertEmail context parameter is required. Please provide it using: cdk deploy -c alertEmail=your-email@example.com');
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
