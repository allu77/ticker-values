# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # compile TypeScript
npm run watch          # compile TypeScript in watch mode
npm test               # run Jest tests

# Local execution (requires .env with GOOGLE_SPREADSHEET_ID and GOOGLE_CREDENTIALS_FILE)
npm run run-local                        # run full update against live spreadsheet
npm run run-local:dry                    # preview changes without writing
npm run run-local -- --ticker BTC-USD   # single ticker
npm run run-local:dry -- --ticker BTC-USD

POWERTOOLS_LOG_LEVEL=DEBUG npm run run-local:dry  # enable debug logging

# CDK
npx cdk synth   # emit CloudFormation template
npx cdk diff    # compare with deployed stack
npx cdk deploy  # deploy to AWS
```

## Architecture

This is an AWS CDK project (TypeScript) that runs a scheduled Lambda to fetch stock/bond ticker values and store them in a Google Spreadsheet.

### Infrastructure (`lib/ticker-values-stack.ts`)

One CDK stack (`TickerValuesStack`) creates:
- **Ticker Lambda** (`lambda/ticker-handler.ts`) — main worker, invoked on an EventBridge schedule (every `pollIntervalHours` hours, Europe/Berlin timezone)
- **Alerting Lambda** (`lambda/alerting-handler.ts`) — triggered by a CloudWatch Alarm; runs a Logs Insights query to find persistently-failing tickers and sends an SNS email
- CloudWatch Metric Filter on ERROR-level logs → Alarm → EventBridge rule → Alerting Lambda
- SNS Topic for email notifications
- SSM permission for Ticker Lambda to read Google credentials from `/iuk/ticker-values/google-credentials`

Configuration parameters (`failureThreshold`, `pollIntervalHours`, `googleSpreadsheetId`, `alertEmail`) are supplied via CDK context or `.env` file.

### Lambda execution flow

1. `ticker-handler.ts` — Lambda entrypoint: fetches Google credentials from SSM, then delegates to `orchestrator.ts`
2. `orchestrator.ts` — reads all ticker configs from the `Index` sheet, fetches values in parallel via `ValueRetrieverFactory`, then applies update logic sequentially
3. `stock-value-retriever.ts` — `ValueRetrieverFactory` routes each ticker to the right retriever:
   - `ValueRetrieverYahoo`: default; handles Yahoo Finance symbol mapping (`BTC→BTC-USD`, `USDEUR→EURUSD=X`, `XETRA:X→X.DE`, `BIT:X→X.MI`)
   - `BondValueRetrieverMIB`: HTML scraper for Italian bonds on Borsa Italiana (activated when `BIT:` prefix + URL contains `obbligazioni`)
   - `StockValueRetrieverMIB`: HTML scraper for ETFs on Borsa Italiana (not wired into the factory currently)
4. `google-sheets-client.ts` — wraps Google Sheets API v4; stores dates as serial numbers (anchored to 1 Jan 2000 = 36526)

### Spreadsheet structure

- **Index sheet** (`Index!A2:C`): columns = ticker, ISIN code, URL
- **Per-ticker sheets** (e.g. `BTC-USD!A:B`): column A = date serial, column B = value

### Update logic (`orchestrator.ts` → `updateValue`)

The orchestrator maintains one data point per month (beginning-of-month), plus the current month's latest value:
- **Same date** → replace in-place
- **Same month, later date** → replace latest row
- **New month, existing entry was day 1** → append new row
- **New month, existing entry was NOT day 1** → roll the previous entry's value forward to the 1st of the new month (replace), then append the actual new value

### Alerting logic (`alerting-handler.ts`)

When the alarm fires, the Lambda queries Logs Insights over a `failureThreshold × pollIntervalHours + 15 min` window counting ERROR entries per `ticker` field. Only tickers with ≥ `failureThreshold` errors trigger an email; transient or rotating failures are silently ignored.

### Local vs Lambda credentials

- **Lambda**: Google credentials JSON stored in SSM Parameter Store at `/iuk/ticker-values/google-credentials`
- **Local** (`bin/run-local.ts`): reads `GOOGLE_SPREADSHEET_ID` and `GOOGLE_CREDENTIALS_FILE` (path to service-account JSON) from `.env`
