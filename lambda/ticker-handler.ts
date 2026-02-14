import { EventBridgeEvent, Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

import { TickerConfig, TickerValue } from './data-models';
import { GoogleSheetsClient } from './google-sheets-client';
import { ValueRetrieverFactory } from './stock-value-retriever';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS_PARAMETER = process.env.GOOGLE_CREDENTIALS_PARAMETER;

// Initialize logger with service name
const logger = new Logger({
    serviceName: 'ticker-values',
});

// Initialize SSM client
const ssmClient = new SSMClient({});

// export interface TickerEvent {
//     // Define your event structure here if needed
//     source: string;
//     detail: any;
// }

const getGoogleCredentials = async (): Promise<any> => {
    try {
        logger.debug('Retrieving Google credentials from Parameter Store');

        const command = new GetParameterCommand({
            Name: GOOGLE_CREDENTIALS_PARAMETER!,
            // WithDecryption: true
        });

        const response = await ssmClient.send(command);

        if (!response.Parameter?.Value) {
            throw new Error('Google credentials parameter not found or empty');
        }

        return JSON.parse(response.Parameter.Value);
    } catch (error) {
        logger.error('Failed to retrieve Google credentials', {
            error: error instanceof Error ? error.message : String(error),
            parameter: GOOGLE_CREDENTIALS_PARAMETER
        });
        throw error;
    }
};


const retrieveValues = (configs: TickerConfig[]): Promise<TickerValue | null>[] =>
    configs.map(async (config: TickerConfig) => {
        try {
            return await ValueRetrieverFactory.create(config).getLatestValue();
        } catch (error) {
            logger.error('Failed to retrieve value', {
                error: error instanceof Error ? error.message : String(error),
                ticker: config.ticker
            });
            return null; // Return null for failed retrievals
        }
    });


const updateValue = async (googleSheetsClient: GoogleSheetsClient, config: TickerConfig, value: TickerValue) => {

    const tickerValues = await googleSheetsClient.getTickerValues(config.ticker);
    const latestTickerValue = tickerValues[tickerValues.length - 1]

    logger.debug("Checking value", { ticker: config.ticker, value, latestTickerValue })

    if (value.date.getTime() == latestTickerValue.date.getTime()) {
        logger.debug(`New value for the same date, replacing latest value`, { ticker: config.ticker });
        googleSheetsClient.replaceTickerValue(config.ticker, tickerValues.length - 1, value)

    } else if (value.date.getTime() > latestTickerValue.date.getTime()) {

        if (latestTickerValue.date.getDate() == 1) {
            // Always keep beginning of the month value => append
            logger.debug(`Appending new value`, { ticker: config.ticker });
            googleSheetsClient.appendTickerValue(config.ticker, value);


        } else if (value.date.getFullYear() == latestTickerValue.date.getFullYear() &&
            value.date.getMonth() == latestTickerValue.date.getMonth()) {
            // Same month and year => replace
            logger.debug(`Replacing latest value`, { ticker: config.ticker });
            googleSheetsClient.replaceTickerValue(config.ticker, tickerValues.length - 1, value)

        } else {
            // New month => roll over latest value (if needed) and append the new one
            if (value.date.getDate() > 1) {
                logger.debug(`Rolling new value`, { ticker: config.ticker });
                googleSheetsClient.replaceTickerValue(config.ticker, tickerValues.length - 1, {
                    value: latestTickerValue.value,
                    date: new Date(latestTickerValue.date.getFullYear(), latestTickerValue.date.getMonth() + 1, 1)
                })
            }
            logger.debug(`Appending new value`, { ticker: config.ticker });
            googleSheetsClient.appendTickerValue(config.ticker, value);
        }
    } else {
        logger.debug(`New value older than latest value, skipping`, { ticker: config.ticker });
    }

}

const retrieveAndUpdateValue = async () => {
    // logger.info('Starting updateValues process');

    // Get Google credentials from Parameter Store
    const googleCredentials = await getGoogleCredentials();

    // Create Google Sheets client with credentials
    const googleSheetsClient = new GoogleSheetsClient(SPREADSHEET_ID!, googleCredentials);

    // Get ticker configurations
    const configs = await googleSheetsClient.getTickers();
    logger.info('Retrieved ticker configurations', { count: configs.length });

    const valuePromises = retrieveValues(configs);

    // Loop sequentially through values to avoid concurrent accesses to Google Sheet
    for (let i = 0; i < valuePromises.length; i++) {
        const value = await valuePromises[i];
        if (value !== null) {
            try {
                await updateValue(googleSheetsClient, configs[i], value);
            } catch (error) {
                logger.error('Failed to update value', {
                    error: error instanceof Error ? error.message : String(error),
                    ticker: configs[i].ticker
                });
            }

        }
    }

    // logger.info('updateValues process completed');
};

export const handler = async (
    event: EventBridgeEvent<string, any>,
    context: Context
): Promise<void> => {
    // Add correlation ID for tracing
    // logger.addContext(context);

    // logger.info('Ticker function triggered', {
    //     timestamp: new Date().toISOString(),
    //     requestId: context.awsRequestId
    // });

    try {
        // Your ticker processing logic goes here
        logger.info('Starting ticker values processing');

        await retrieveAndUpdateValue();

        logger.info('Ticker processing completed successfully');
    } catch (error) {
        logger.error('Error processing ticker values', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        throw error; // Re-throw to mark the Lambda execution as failed
    }
};