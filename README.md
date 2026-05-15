# Ticker values updater

This project retrieves values for stock and bond ticker and stores them in a Google Spreadsheet.
I use it as a fallback to the `GOOGLEFINANCE(...)` Google Spreadhseet function, which can be unstable
(especially for stock exchanges other than NYSE).

Contact the me for any further info.

## Configuration

The stack requires two mandatory parameters and two optional ones.

### Priority Order:
1. Command line parameters (CDK context)
2. Environment variables (from `.env` file if present)

### Option 1: Command Line Parameters
```bash
npx cdk deploy \
  -c googleSpreadsheetId=YOUR_SPREADSHEET_ID \
  -c alertEmail=your-email@example.com \
  -c failureThreshold=3 \
  -c pollIntervalHours=2
```

### Option 2: Environment Variables
Create a `.env` file in the project root:
```
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id_here
ALERT_EMAIL=your-email@example.com

# Optional — alerting behaviour (defaults shown)
FAILURE_THRESHOLD=3       # consecutive failing runs before alerting
POLL_INTERVAL_HOURS=2    # run interval in hours; also sets the alarm evaluation window
```

Then deploy:
```bash
npx cdk deploy
```

## Alerting

The stack alerts only when a specific ticker fails consistently across multiple runs, ignoring transient errors.

**How it works:**
1. The ticker Lambda logs a structured `ERROR` entry (including the `ticker` field) whenever a ticker cannot be fetched or updated.
2. A CloudWatch Metric Filter counts these errors and feeds a CloudWatch Alarm with a 5-minute evaluation window.
3. The alarm fires within ~5 minutes of any run that produces errors, then resets automatically — well before the next scheduled run. It acts purely as a reactive trigger, not a consecutive-failure detector.
4. Each alarm trigger invokes an Alerting Lambda via EventBridge. The Lambda runs a CloudWatch Logs Insights query over the last `failureThreshold × pollIntervalHours` hours (default: 6h) and counts errors per ticker.
5. If any ticker has accumulated ≥ `failureThreshold` errors in that window, a notification email is sent with the ticker name and last error message.
6. If no ticker exceeds the threshold (e.g. different tickers failed in each run), the Lambda exits silently — no email sent.

**Scenarios:**
- *3 different tickers each fail once*: alarm fires, but no single ticker has ≥ 3 errors in the query window → no email.
- *Same ticker fails 3 consecutive runs*: alarm fires on each run; by the third, the Logs Insights query finds ≥ 3 errors for that ticker → email sent.
- *Ticker recovers after 3 failures*: alarm fires no more (no errors in subsequent runs) → emails stop automatically.

**Tuning:**
- Increase `failureThreshold` to require more consecutive failures before alerting.
- `pollIntervalHours` controls both the EventBridge schedule and the query window size (`failureThreshold × pollIntervalHours` hours).

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
