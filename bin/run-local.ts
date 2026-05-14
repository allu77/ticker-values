import 'dotenv/config';
import * as fs from 'fs';
import { GoogleCredentials } from '../lambda/google-sheets-client';
import { retrieveAndUpdateValues } from '../lambda/orchestrator';

const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
const credsFile = process.env.GOOGLE_CREDENTIALS_FILE;

if (!spreadsheetId) throw new Error('SPREADSHEET_ID env var is required');
if (!credsFile) throw new Error('GOOGLE_CREDENTIALS_FILE env var is required');

const credentials: GoogleCredentials = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
const dryRun = process.argv.includes('--dry-run');
const tickerArgIndex = process.argv.indexOf('--ticker');
const ticker = tickerArgIndex !== -1 ? process.argv[tickerArgIndex + 1] : undefined;

retrieveAndUpdateValues(spreadsheetId, credentials, { dryRun, ticker })
    .then(() => console.log('Done'))
    .catch(err => { console.error(err); process.exit(1); });
