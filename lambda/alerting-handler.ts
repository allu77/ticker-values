import {
    CloudWatchLogsClient,
    StartQueryCommand,
    GetQueryResultsCommand,
    QueryStatus,
    ResultField,
} from '@aws-sdk/client-cloudwatch-logs';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const logsClient = new CloudWatchLogsClient({});
const snsClient = new SNSClient({});

const LOG_GROUP_NAME = process.env.LOG_GROUP_NAME!;
const FAILURE_THRESHOLD = parseInt(process.env.FAILURE_THRESHOLD!, 10);
const POLL_INTERVAL_HOURS = parseInt(process.env.POLL_INTERVAL_HOURS!, 10);
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN!;

interface FailingTicker {
    ticker: string;
    windowsWithErrors: number;
    lastError: string;
}

export const handler = async (): Promise<void> => {
    await handleAlarm();
};

async function handleAlarm(): Promise<void> {
    const failingTickers = await queryFailingTickers();

    if (failingTickers.length === 0) {
        // Alarm fired but no single ticker failed across all windows (rotating failures).
        // No email needed.
        console.log('Alarm fired but no ticker exceeded the consecutive failure threshold — spurious trigger, skipping notification');
        return;
    }

    const subject = buildAlertSubject(failingTickers);
    const body = buildAlertBody(failingTickers);
    await publish(subject, body);
}

async function queryFailingTickers(): Promise<FailingTicker[]> {
    const endTime = Math.floor(Date.now() / 1000);
    // Add 15-minute buffer to account for clock alignment between Lambda runs and CloudWatch windows
    const windowSeconds = FAILURE_THRESHOLD * POLL_INTERVAL_HOURS * 3600 + 900;
    const startTime = endTime - windowSeconds;

    const query = [
        'filter level = "ERROR" and ispresent(ticker)',
        `| stats count() as totalErrors, latest(error) as lastError by ticker`,
        `| filter totalErrors >= ${FAILURE_THRESHOLD}`,
        '| sort totalErrors desc',
    ].join('\n');

    const { queryId } = await logsClient.send(new StartQueryCommand({
        logGroupName: LOG_GROUP_NAME,
        startTime,
        endTime,
        queryString: query,
    }));

    const results = await pollQueryResults(queryId!);
    return parseResults(results);
}

async function pollQueryResults(queryId: string): Promise<ResultField[][]> {
    const maxAttempts = 30;
    let delay = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await sleep(delay);
        delay = Math.min(delay * 1.5, 10000);

        const response = await logsClient.send(new GetQueryResultsCommand({ queryId }));

        if (response.status === QueryStatus.Complete) {
            return response.results ?? [];
        }
        if (response.status === QueryStatus.Failed || response.status === QueryStatus.Cancelled) {
            throw new Error(`Logs Insights query ${response.status}`);
        }
    }

    throw new Error('Logs Insights query timed out');
}

function parseResults(rows: ResultField[][]): FailingTicker[] {
    return rows.map(row => {
        const get = (field: string) => row.find(f => f.field === field)?.value ?? '';
        return {
            ticker: get('ticker'),
            windowsWithErrors: parseInt(get('totalErrors'), 10),
            lastError: get('lastError'),
        };
    }).filter(t => t.ticker);
}

function buildAlertSubject(tickers: FailingTicker[]): string {
    const names = tickers.map(t => t.ticker).join(', ');
    const subject = `[ALERT] Tickers consistently failing: ${names}`;
    return subject.length <= 100 ? subject : subject.slice(0, 97) + '...';
}

function buildAlertBody(tickers: FailingTicker[]): string {
    const lines: string[] = [
        `Ticker failure alert — ${new Date().toISOString()}`,
        '',
        `The following ticker(s) have failed in ${FAILURE_THRESHOLD} consecutive runs:`,
        '',
    ];

    for (const t of tickers) {
        lines.push(`Ticker:     ${t.ticker}`);
        lines.push(`Windows:    ${t.windowsWithErrors} of ${FAILURE_THRESHOLD}`);
        lines.push(`Last error: ${t.lastError || '(no error message captured)'}`);
        lines.push('');
    }

    lines.push('---');
    lines.push(`Threshold: ${FAILURE_THRESHOLD} consecutive failures / ${POLL_INTERVAL_HOURS}h interval`);
    lines.push('Check CloudWatch Logs Insights for full details.');
    return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function publish(subject: string, message: string): Promise<void> {
    await snsClient.send(new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: subject,
        Message: message,
    }));
}
