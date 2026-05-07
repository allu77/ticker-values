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

## Useful commands

* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
