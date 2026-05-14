import { EventBridgeEvent, Context } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

import { GoogleCredentials } from './google-sheets-client';
import { retrieveAndUpdateValues } from './orchestrator';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_CREDENTIALS_PARAMETER = process.env.GOOGLE_CREDENTIALS_PARAMETER;

const logger = new Logger({ serviceName: 'ticker-values' });
const ssmClient = new SSMClient({});

const getGoogleCredentials = async (): Promise<GoogleCredentials> => {
    try {
        logger.debug('Retrieving Google credentials from Parameter Store');

        const command = new GetParameterCommand({
            Name: GOOGLE_CREDENTIALS_PARAMETER!,
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

export const handler = async (
    event: EventBridgeEvent<string, any>,
    context: Context
): Promise<void> => {
    try {
        logger.info('Starting ticker values processing');

        const googleCredentials = await getGoogleCredentials();
        await retrieveAndUpdateValues(SPREADSHEET_ID!, googleCredentials);

        logger.info('Ticker processing completed successfully');
    } catch (error) {
        logger.error('Error processing ticker values', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
    }
};
