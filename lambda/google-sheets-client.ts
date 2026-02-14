import { google, sheets_v4 } from 'googleapis';
import { TickerConfig, TickerValue } from './data-models';

interface GoogleCredentials {
    type: string;
    project_id: string;
    private_key_id: string;
    private_key: string;
    client_email: string;
    client_id: string;
    auth_uri: string;
    token_uri: string;
    auth_provider_x509_cert_url: string;
    client_x509_cert_url: string;
    universe_domain: string;
}

// Convert Google Sheets serial date to JavaScript Date
// Google Sheets uses days since December 30, 1899
function serialToDate(serialDate: number): Date {
    // const millisecondsPerDay = 24 * 60 * 60 * 1000;
    // const epoch = new Date(1899, 11, 30); // December 30, 1899
    // return new Date(epoch.getTime() + serialDate * millisecondsPerDay);
    return new Date(1899, 11, 30 + serialDate)
}

function dateToSerial(date: Date): number {
    // Starting from serial date of 1/1/2000 (36526), because using 12/30/1899 was creating discrepancies
    return 36526 + Math.floor((date.getTime() - new Date(2000, 0, 1).getTime()) / (24 * 60 * 60 * 1000));
}


export class GoogleSheetsClient {
    private spreadSheetId;
    private sheets: sheets_v4.Sheets;

    constructor(spreadSeetId: string, credentials: GoogleCredentials) {
        this.spreadSheetId = spreadSeetId;

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });

        this.sheets = google.sheets({ version: 'v4', auth });
    }

    public async getTickers(): Promise<TickerConfig[]> {
        const result = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadSheetId,
            range: 'Index!A2:C',
        });

        const rows = result.data.values;
        if (!rows || rows.length === 0) return [];

        return rows.map(row => ({ ticker: row[0], isinCode: row[1], url: row[2] }));
    }

    public async getTickerValues(ticker: string): Promise<TickerValue[]> {
        const result = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadSheetId,
            range: `${ticker}!A:B`,
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'SERIAL_NUMBER',
        });

        return result.data.values?.map(row => ({
            ticker,
            value: parseFloat(row[1]),
            date: serialToDate(parseFloat(row[0]))
        })) || [];
    }

    public async appendTickerValue(ticker: string, value: TickerValue): Promise<void> {
        const serialDate = dateToSerial(value.date);
        // console.debug(`Appending value for ${ticker} with ${value.value} on ${value.date}, serial ${serialDate}`);

        await this.sheets.spreadsheets.values.append({
            spreadsheetId: this.spreadSheetId,
            range: `${ticker}!A:B`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[serialDate, value.value]],
            },
        });
    }

    public async replaceTickerValue(ticker: string, index: number, value: TickerValue): Promise<void> {
        const serialDate = dateToSerial(value.date);
        // console.debug(value.date.getTime() - new Date(1899, 11, 30).getTime())
        // console.debug(`Replacing value for ${ticker} at index ${index} with ${value.value} on ${value.date}, serial ${serialDate}`);

        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadSheetId,
            range: `${ticker}!A${index + 1}:B${index + 1}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[serialDate, value.value]],
            },
        });
    }
}