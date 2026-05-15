import { GoogleSheetsClient, GoogleCredentials } from '../lambda/google-sheets-client';

const mockGet = jest.fn();
const mockAppend = jest.fn();
const mockUpdate = jest.fn();

jest.mock('googleapis', () => ({
    google: {
        auth: { GoogleAuth: jest.fn() },
        sheets: jest.fn(() => ({
            spreadsheets: {
                values: { get: mockGet, append: mockAppend, update: mockUpdate },
            },
        })),
    },
}));

const SPREADSHEET_ID = 'test-spreadsheet-id';

const mockCredentials: GoogleCredentials = {
    type: 'service_account',
    project_id: 'proj',
    private_key_id: 'kid',
    private_key: 'pk',
    client_email: 'svc@proj.iam.gserviceaccount.com',
    client_id: '1',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/svc',
    universe_domain: 'googleapis.com',
};

function makeClient() {
    return new GoogleSheetsClient(SPREADSHEET_ID, mockCredentials);
}

afterEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// getTickers
// ---------------------------------------------------------------------------

describe('getTickers', () => {
    it('returns empty array when the sheet has no rows', async () => {
        mockGet.mockResolvedValue({ data: { values: null } });
        expect(await makeClient().getTickers()).toEqual([]);
    });

    it('returns empty array when values array is empty', async () => {
        mockGet.mockResolvedValue({ data: { values: [] } });
        expect(await makeClient().getTickers()).toEqual([]);
    });

    it('maps rows to TickerConfig objects', async () => {
        mockGet.mockResolvedValue({
            data: {
                values: [
                    ['BTC', 'IT0001', 'https://example.com/btc'],
                    ['AAPL', 'US0002', 'https://example.com/aapl'],
                ],
            },
        });

        const tickers = await makeClient().getTickers();

        expect(tickers).toEqual([
            { ticker: 'BTC', isinCode: 'IT0001', url: 'https://example.com/btc' },
            { ticker: 'AAPL', isinCode: 'US0002', url: 'https://example.com/aapl' },
        ]);
    });

    it('reads from the Index sheet range A2:C', async () => {
        mockGet.mockResolvedValue({ data: { values: [] } });
        await makeClient().getTickers();
        expect(mockGet).toHaveBeenCalledWith({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Index!A2:C',
        });
    });
});

// ---------------------------------------------------------------------------
// getTickerValues
// ---------------------------------------------------------------------------

describe('getTickerValues', () => {
    it('returns empty array when the sheet has no values', async () => {
        mockGet.mockResolvedValue({ data: {} });
        expect(await makeClient().getTickerValues('BTC-USD')).toEqual([]);
    });

    it('converts serial date 36526 to 1 Jan 2000', async () => {
        mockGet.mockResolvedValue({ data: { values: [['36526', '12345.67']] } });

        const [item] = await makeClient().getTickerValues('BTC-USD');

        expect(item.date).toEqual(new Date(2000, 0, 1));
    });

    it('converts serial date 46037 to 15 Jan 2026', async () => {
        mockGet.mockResolvedValue({ data: { values: [['46037', '99.5']] } });

        const [item] = await makeClient().getTickerValues('BTC-USD');

        // 46037 - 36526 = 9511 days after Jan 1, 2000 = Jan 15, 2026
        expect(item.date).toEqual(new Date(2026, 0, 15));
    });

    it('parses float values from string rows', async () => {
        mockGet.mockResolvedValue({
            data: { values: [['36526', '98.765']] },
        });

        const [item] = await makeClient().getTickerValues('BTP');

        expect(item.value).toBeCloseTo(98.765);
    });

    it('returns multiple rows in order', async () => {
        mockGet.mockResolvedValue({
            data: {
                values: [
                    ['36526', '1.0'],
                    ['36527', '2.0'],
                ],
            },
        });

        const values = await makeClient().getTickerValues('EUR');

        expect(values).toHaveLength(2);
        expect(values[0].date).toEqual(new Date(2000, 0, 1));
        expect(values[1].date).toEqual(new Date(2000, 0, 2));
    });

    it('reads from {ticker}!A:B with UNFORMATTED_VALUE and SERIAL_NUMBER options', async () => {
        mockGet.mockResolvedValue({ data: {} });
        await makeClient().getTickerValues('BTC-USD');
        expect(mockGet).toHaveBeenCalledWith({
            spreadsheetId: SPREADSHEET_ID,
            range: 'BTC-USD!A:B',
            valueRenderOption: 'UNFORMATTED_VALUE',
            dateTimeRenderOption: 'SERIAL_NUMBER',
        });
    });
});

// ---------------------------------------------------------------------------
// appendTickerValue
// ---------------------------------------------------------------------------

describe('appendTickerValue', () => {
    it('converts 1 Jan 2000 to serial 36526', async () => {
        mockAppend.mockResolvedValue({});
        await makeClient().appendTickerValue('BTC-USD', { value: 100, date: new Date(2000, 0, 1) });

        const body = mockAppend.mock.calls[0][0];
        expect(body.requestBody.values[0][0]).toBe(36526);
    });

    it('converts 2 Jan 2000 to serial 36527', async () => {
        mockAppend.mockResolvedValue({});
        await makeClient().appendTickerValue('BTC-USD', { value: 100, date: new Date(2000, 0, 2) });

        const body = mockAppend.mock.calls[0][0];
        expect(body.requestBody.values[0][0]).toBe(36527);
    });

    it('truncates intra-day time when computing the serial', async () => {
        mockAppend.mockResolvedValue({});
        // noon on Jan 1 2000 should still be serial 36526
        await makeClient().appendTickerValue('BTC-USD', { value: 100, date: new Date(2000, 0, 1, 12, 0, 0) });

        const body = mockAppend.mock.calls[0][0];
        expect(body.requestBody.values[0][0]).toBe(36526);
    });

    it('appends the value alongside the serial date', async () => {
        mockAppend.mockResolvedValue({});
        await makeClient().appendTickerValue('ETH-USD', { value: 2500.5, date: new Date(2000, 0, 1) });

        const body = mockAppend.mock.calls[0][0];
        expect(body.requestBody.values[0][1]).toBe(2500.5);
    });

    it('calls append on the correct range and spreadsheet', async () => {
        mockAppend.mockResolvedValue({});
        await makeClient().appendTickerValue('ETH-USD', { value: 1, date: new Date(2000, 0, 1) });

        expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
            spreadsheetId: SPREADSHEET_ID,
            range: 'ETH-USD!A:B',
            valueInputOption: 'USER_ENTERED',
        }));
    });
});

// ---------------------------------------------------------------------------
// replaceTickerValue
// ---------------------------------------------------------------------------

describe('replaceTickerValue', () => {
    it('converts index 0 to row 1 in the range', async () => {
        mockUpdate.mockResolvedValue({});
        await makeClient().replaceTickerValue('BTC-USD', 0, { value: 1, date: new Date(2000, 0, 1) });

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            range: 'BTC-USD!A1:B1',
        }));
    });

    it('converts index 4 to row 5 in the range', async () => {
        mockUpdate.mockResolvedValue({});
        await makeClient().replaceTickerValue('BTC-USD', 4, { value: 1, date: new Date(2000, 0, 1) });

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            range: 'BTC-USD!A5:B5',
        }));
    });

    it('writes the correct serial date and value', async () => {
        mockUpdate.mockResolvedValue({});
        await makeClient().replaceTickerValue('BTC-USD', 0, { value: 55000.25, date: new Date(2000, 0, 1) });

        const body = mockUpdate.mock.calls[0][0];
        expect(body.requestBody.values[0]).toEqual([36526, 55000.25]);
    });

    it('calls update on the correct spreadsheet with USER_ENTERED', async () => {
        mockUpdate.mockResolvedValue({});
        await makeClient().replaceTickerValue('BTC-USD', 2, { value: 1, date: new Date(2000, 0, 1) });

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            spreadsheetId: SPREADSHEET_ID,
            valueInputOption: 'USER_ENTERED',
        }));
    });
});
