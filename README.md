# Ticker values updater

This project retrieves values for stock and bond ticker and stores them in a Google Spreadsheet.
I use it as a fallback to the `GOOGLEFINANCE(...)` Google Spreadhseet function, which can be unstable
(especially for stock exchanges other than NYSE).

Contact the me for any further info.

## Configuration

The stack requires two parameters: Google Spreadsheet ID and Alert Email.

### Priority Order:
1. Command line parameters (CDK context)
2. Environment variables (from `.env` file if present)

### Option 1: Command Line Parameters
```bash
npx cdk deploy -c googleSpreadsheetId=YOUR_SPREADSHEET_ID -c alertEmail=your-email@example.com
```

### Option 2: Environment Variables
Create a `.env` file in the project root:
```
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id_here
ALERT_EMAIL=your-email@example.com
```

Then deploy:
```bash
npx cdk deploy
```

## Running locally

You can run the update process locally without deploying to AWS.

### Prerequisites

Add the following to your `.env` file:

```
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id_here
GOOGLE_CREDENTIALS_FILE=/path/to/service-account.json
```

`GOOGLE_CREDENTIALS_FILE` should point to a Google service account JSON key file with access to the spreadsheet.

### Commands

Run the full update (all tickers):
```bash
npm run run-local
```

Preview what would be written without modifying the spreadsheet:
```bash
npm run run-local:dry
```

Target a single ticker:
```bash
npm run run-local -- --ticker BTC-USD
npm run run-local:dry -- --ticker BTC-USD
```

Enable debug logging:
```bash
POWERTOOLS_LOG_LEVEL=DEBUG npm run run-local:dry
```

## Useful commands

* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
