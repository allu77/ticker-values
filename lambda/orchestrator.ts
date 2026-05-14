import { Logger } from '@aws-lambda-powertools/logger';

import { TickerConfig, TickerValue } from './data-models';
import { GoogleCredentials, GoogleSheetsClient } from './google-sheets-client';
import { ValueRetrieverFactory } from './stock-value-retriever';

const logger = new Logger({ serviceName: 'ticker-values' });

const retrieveValues = (configs: TickerConfig[]): Promise<TickerValue | null>[] =>
    configs.map(async (config: TickerConfig) => {
        try {
            return await ValueRetrieverFactory.create(config).getLatestValue();
        } catch (error) {
            logger.error('Failed to retrieve value', {
                error: error instanceof Error ? error.message : String(error),
                ticker: config.ticker
            });
            return null;
        }
    });

const updateValue = async (
    googleSheetsClient: GoogleSheetsClient,
    config: TickerConfig,
    value: TickerValue,
    dryRun: boolean
) => {
    const tickerValues = await googleSheetsClient.getTickerValues(config.ticker);
    const latestTickerValue = tickerValues[tickerValues.length - 1];
    const latestRow = tickerValues.length; // 1-based row index of latest entry

    logger.debug('Checking value', { ticker: config.ticker, value, latestTickerValue });

    const report = (op: 'REPLACE' | 'APPEND', row: number | null, v: TickerValue) => {
        const rowStr = row !== null ? `row ${row}` : 'append ';
        console.log(`[DRY-RUN] ${config.ticker.padEnd(12)} ${op} ${rowStr.padEnd(8)}  value=${v.value}  date=${v.date.toISOString().slice(0, 10)}`);
    };

    // Udate logic:
    // 1) Keep beginning of the month values for each month
    // 2) Keep only the latest value in the current month
    // 3) If we don't have a beginning of the month quote (e.g. beginning of the month was during
    //    Stock Exhange closure), we roll over the latest value from the previous month to the 
    //    first day of the new month, and append the new value with actual date

    if ((value.date.getFullYear() === latestTickerValue.date.getFullYear()) &&
        (value.date.getMonth() === latestTickerValue.date.getMonth()) &&
        (value.date.getDate() === latestTickerValue.date.getDate())) {

        // Same date

        logger.debug('New value for the same date, replacing latest value', { ticker: config.ticker });
        if (dryRun) { report('REPLACE', latestRow, value); return; }
        googleSheetsClient.replaceTickerValue(config.ticker, tickerValues.length - 1, value);

    } else if (value.date.getTime() > latestTickerValue.date.getTime()) {

        // In this brach we know that the new value is for a later date than the latest value in the sheet
        // getTime compares milliseconds, if this was same day but a later time, it would be caught by 
        // the previous condition

        if (latestTickerValue.date.getDate() == 1) {

            // Keep beginning of month value, append new value with actual date

            logger.debug('Appending new value', { ticker: config.ticker });
            if (dryRun) { report('APPEND', null, value); return; }
            googleSheetsClient.appendTickerValue(config.ticker, value);

        } else if (
            value.date.getFullYear() == latestTickerValue.date.getFullYear() &&
            value.date.getMonth() == latestTickerValue.date.getMonth()
        ) {

            // Same month but new value with later date, replace latest value

            logger.debug('Replacing latest value', { ticker: config.ticker });
            if (dryRun) { report('REPLACE', latestRow, value); return; }
            googleSheetsClient.replaceTickerValue(config.ticker, tickerValues.length - 1, value);

        } else {

            // If we are here, it means that the new value is for a new month compared to the latest value in the sheet

            if (value.date.getDate() > 1) {

                // We are in a new month, we don't have beginning of the month value in the sheet
                // we roll over whatever was the latest value to the first day of the new month

                const rolloverValue: TickerValue = {
                    value: latestTickerValue.value,
                    date: new Date(latestTickerValue.date.getFullYear(), latestTickerValue.date.getMonth() + 1, 1)
                };
                logger.debug('Rolling new value', { ticker: config.ticker });
                if (dryRun) {
                    report('REPLACE', latestRow, rolloverValue);
                } else {
                    googleSheetsClient.replaceTickerValue(config.ticker, tickerValues.length - 1, rolloverValue);
                }
            }
            logger.debug('Appending new value', { ticker: config.ticker });
            if (dryRun) { report('APPEND', null, value); return; }
            googleSheetsClient.appendTickerValue(config.ticker, value);
        }
    } else {
        logger.debug('New value older than latest value, skipping', { ticker: config.ticker });
    }
};

export const retrieveAndUpdateValues = async (
    spreadsheetId: string,
    googleCredentials: GoogleCredentials,
    options: { dryRun?: boolean; ticker?: string } = {}
): Promise<void> => {
    const dryRun = options.dryRun ?? false;
    console.log(dryRun ? '[DRY-RUN] No changes will be written to Google Sheets' : '[LIVE] Changes will be written to Google Sheets');
    const googleSheetsClient = new GoogleSheetsClient(spreadsheetId, googleCredentials);

    const allConfigs = await googleSheetsClient.getTickers();
    const configs = options.ticker
        ? allConfigs.filter(c => c.ticker === options.ticker)
        : allConfigs;

    if (options.ticker && configs.length === 0) {
        logger.warn('Ticker not found in Index sheet', { ticker: options.ticker });
        return;
    }

    logger.info('Retrieved ticker configurations', { count: configs.length });

    const valuePromises = retrieveValues(configs);

    for (let i = 0; i < valuePromises.length; i++) {
        const value = await valuePromises[i];
        if (value !== null) {
            try {
                await updateValue(googleSheetsClient, configs[i], value, dryRun);
            } catch (error) {
                logger.error('Failed to update value', {
                    error: error instanceof Error ? error.message : String(error),
                    ticker: configs[i].ticker
                });
            }
        }
    }
};
