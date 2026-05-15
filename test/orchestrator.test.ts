import { retrieveAndUpdateValues } from '../lambda/orchestrator';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetTickers = jest.fn();
const mockGetTickerValues = jest.fn();
const mockAppendTickerValue = jest.fn();
const mockReplaceTickerValue = jest.fn();
const mockGetLatestValue = jest.fn();

jest.mock('../lambda/google-sheets-client', () => ({
    GoogleSheetsClient: jest.fn().mockImplementation(() => ({
        getTickers: mockGetTickers,
        getTickerValues: mockGetTickerValues,
        appendTickerValue: mockAppendTickerValue,
        replaceTickerValue: mockReplaceTickerValue,
    })),
}));

jest.mock('../lambda/stock-value-retriever', () => ({
    ValueRetrieverFactory: {
        create: jest.fn(() => ({ getLatestValue: mockGetLatestValue })),
    },
}));

jest.mock('@aws-lambda-powertools/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TICKER = 'BTC-USD';
const SPREADSHEET_ID = 'test-spreadsheet-id';
const CREDENTIALS = {} as any;

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTickers.mockResolvedValue([{ ticker: TICKER }]);
    mockAppendTickerValue.mockResolvedValue(undefined);
    mockReplaceTickerValue.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

async function run(
    incoming: { date: Date; value: number },
    existing: { date: Date; value: number }[],
    opts?: { dryRun?: boolean; ticker?: string }
) {
    mockGetLatestValue.mockResolvedValue(incoming);
    mockGetTickerValues.mockResolvedValue(existing);
    await retrieveAndUpdateValues(SPREADSHEET_ID, CREDENTIALS, opts);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

describe('orchestration', () => {
    it('creates GoogleSheetsClient with the provided spreadsheet ID and credentials', async () => {
        mockGetTickers.mockResolvedValue([]);
        await retrieveAndUpdateValues(SPREADSHEET_ID, CREDENTIALS);
        const { GoogleSheetsClient } = require('../lambda/google-sheets-client');
        expect(GoogleSheetsClient).toHaveBeenCalledWith(SPREADSHEET_ID, CREDENTIALS);
    });

    it('processes all tickers when no ticker filter is set', async () => {
        mockGetTickers.mockResolvedValue([{ ticker: 'BTC-USD' }, { ticker: 'AAPL' }]);
        const date = new Date(2026, 4, 15);
        mockGetLatestValue.mockResolvedValue({ date, value: 100 });
        mockGetTickerValues.mockResolvedValue([{ date, value: 100 }]);

        await retrieveAndUpdateValues(SPREADSHEET_ID, CREDENTIALS);

        expect(mockGetTickerValues).toHaveBeenCalledTimes(2);
    });

    it('filters to a single ticker when options.ticker is set', async () => {
        mockGetTickers.mockResolvedValue([{ ticker: 'BTC-USD' }, { ticker: 'AAPL' }]);
        const date = new Date(2026, 4, 15);
        mockGetLatestValue.mockResolvedValue({ date, value: 100 });
        mockGetTickerValues.mockResolvedValue([{ date, value: 100 }]);

        await retrieveAndUpdateValues(SPREADSHEET_ID, CREDENTIALS, { ticker: 'AAPL' });

        expect(mockGetTickerValues).toHaveBeenCalledTimes(1);
        expect(mockGetTickerValues).toHaveBeenCalledWith('AAPL');
    });

    it('warns and skips processing when the requested ticker is not in the index', async () => {
        mockGetTickers.mockResolvedValue([{ ticker: 'BTC-USD' }]);

        await retrieveAndUpdateValues(SPREADSHEET_ID, CREDENTIALS, { ticker: 'NONEXISTENT' });

        expect(mockGetLatestValue).not.toHaveBeenCalled();
        expect(mockGetTickerValues).not.toHaveBeenCalled();
    });

    it('skips updateValue when the retriever throws', async () => {
        mockGetLatestValue.mockRejectedValue(new Error('network error'));

        await retrieveAndUpdateValues(SPREADSHEET_ID, CREDENTIALS);

        expect(mockGetTickerValues).not.toHaveBeenCalled();
        expect(mockReplaceTickerValue).not.toHaveBeenCalled();
        expect(mockAppendTickerValue).not.toHaveBeenCalled();
    });

    it('continues with the next ticker after a retriever failure', async () => {
        mockGetTickers.mockResolvedValue([{ ticker: 'FAIL' }, { ticker: 'OK' }]);
        const date = new Date(2026, 4, 15);
        mockGetLatestValue
            .mockRejectedValueOnce(new Error('fail'))
            .mockResolvedValueOnce({ date, value: 100 });
        mockGetTickerValues.mockResolvedValue([{ date, value: 100 }]);

        await expect(retrieveAndUpdateValues(SPREADSHEET_ID, CREDENTIALS)).resolves.not.toThrow();

        expect(mockGetTickerValues).toHaveBeenCalledWith('OK');
    });

    it('continues with the next ticker when updateValue throws', async () => {
        mockGetTickers.mockResolvedValue([{ ticker: 'ERR' }, { ticker: 'OK' }]);
        const date = new Date(2026, 4, 15);
        mockGetLatestValue.mockResolvedValue({ date, value: 100 });
        mockGetTickerValues
            .mockRejectedValueOnce(new Error('sheets error'))
            .mockResolvedValueOnce([{ date: new Date(2026, 4, 14), value: 99 }]);

        await expect(retrieveAndUpdateValues(SPREADSHEET_ID, CREDENTIALS)).resolves.not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// updateValue — branch 1: same date → replace latest row
// ---------------------------------------------------------------------------

describe('updateValue: same date', () => {
    it('replaces the latest row in-place', async () => {
        const date = new Date(2026, 4, 15);
        await run({ date, value: 105 }, [{ date, value: 100 }]);

        expect(mockReplaceTickerValue).toHaveBeenCalledWith(TICKER, 0, { date, value: 105 });
        expect(mockAppendTickerValue).not.toHaveBeenCalled();
    });

    it('uses the last row index when multiple entries exist', async () => {
        const date = new Date(2026, 4, 15);
        await run({ date, value: 105 }, [
            { date: new Date(2026, 3, 1), value: 90 },
            { date: new Date(2026, 4, 1), value: 95 },
            { date, value: 100 },
        ]);

        expect(mockReplaceTickerValue).toHaveBeenCalledWith(TICKER, 2, { date, value: 105 });
    });
});

// ---------------------------------------------------------------------------
// updateValue — branch 2: later date, same month, previous NOT day 1 → replace
// ---------------------------------------------------------------------------

describe('updateValue: same month, later date', () => {
    it('replaces the latest row', async () => {
        const existing = new Date(2026, 4, 10);
        const incoming = new Date(2026, 4, 20);
        await run({ date: incoming, value: 110 }, [{ date: existing, value: 100 }]);

        expect(mockReplaceTickerValue).toHaveBeenCalledWith(TICKER, 0, { date: incoming, value: 110 });
        expect(mockAppendTickerValue).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// updateValue — branch 3: new month, previous entry WAS day 1 → append only
// ---------------------------------------------------------------------------

describe('updateValue: new month, previous entry was day 1', () => {
    it('appends without replacing', async () => {
        const existing = new Date(2026, 4, 1);  // May 1
        const incoming = new Date(2026, 5, 10); // Jun 10
        await run({ date: incoming, value: 110 }, [{ date: existing, value: 100 }]);

        expect(mockAppendTickerValue).toHaveBeenCalledWith(TICKER, { date: incoming, value: 110 });
        expect(mockReplaceTickerValue).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// updateValue — branch 4: new month, previous NOT day 1, incoming NOT day 1
//              → rollover replace + append
// ---------------------------------------------------------------------------

describe('updateValue: new month, rollover then append', () => {
    it('replaces latest with the rollover value, then appends the real value', async () => {
        const existing = new Date(2026, 4, 15); // May 15
        const incoming = new Date(2026, 5, 10); // Jun 10
        await run({ date: incoming, value: 110 }, [{ date: existing, value: 100 }]);

        expect(mockReplaceTickerValue).toHaveBeenCalledWith(TICKER, 0, {
            value: 100,
            date: new Date(2026, 5, 1), // Jun 1 — first of the month after May
        });
        expect(mockAppendTickerValue).toHaveBeenCalledWith(TICKER, { date: incoming, value: 110 });
    });

    it('carries the previous entry value (not the incoming value) into the rollover', async () => {
        const existing = new Date(2026, 4, 15);
        const incoming = new Date(2026, 5, 10);
        await run({ date: incoming, value: 999 }, [{ date: existing, value: 42 }]);

        const [, , rollover] = mockReplaceTickerValue.mock.calls[0];
        expect(rollover.value).toBe(42);
    });

    it('rolls the date forward to the 1st of the month after the previous entry', async () => {
        const existing = new Date(2026, 4, 15); // May 15
        const incoming = new Date(2026, 5, 10); // Jun 10
        await run({ date: incoming, value: 110 }, [{ date: existing, value: 100 }]);

        const [, , rollover] = mockReplaceTickerValue.mock.calls[0];
        expect(rollover.date).toEqual(new Date(2026, 5, 1)); // Jun 1
    });

    it('wraps December to January correctly for the rollover month', async () => {
        const existing = new Date(2025, 11, 20); // Dec 20, 2025
        const incoming = new Date(2026, 1, 5);   // Feb 5, 2026
        await run({ date: incoming, value: 110 }, [{ date: existing, value: 100 }]);

        const [, , rollover] = mockReplaceTickerValue.mock.calls[0];
        expect(rollover.date).toEqual(new Date(2026, 0, 1)); // Jan 1, 2026
    });
});

// ---------------------------------------------------------------------------
// updateValue — branch 5: new month, previous NOT day 1, incoming IS day 1
//              → append only (no rollover needed)
// ---------------------------------------------------------------------------

describe('updateValue: new month starts on day 1, no rollover', () => {
    it('appends without rolling over when the incoming date is the 1st', async () => {
        const existing = new Date(2026, 4, 15); // May 15
        const incoming = new Date(2026, 5, 1);  // Jun 1
        await run({ date: incoming, value: 110 }, [{ date: existing, value: 100 }]);

        expect(mockAppendTickerValue).toHaveBeenCalledWith(TICKER, { date: incoming, value: 110 });
        expect(mockReplaceTickerValue).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// updateValue — branch 6: incoming date older than latest → skip
// ---------------------------------------------------------------------------

describe('updateValue: incoming date older than latest', () => {
    it('makes no API write calls', async () => {
        const existing = new Date(2026, 4, 15);
        const incoming = new Date(2026, 4, 10); // earlier
        await run({ date: incoming, value: 90 }, [{ date: existing, value: 100 }]);

        expect(mockReplaceTickerValue).not.toHaveBeenCalled();
        expect(mockAppendTickerValue).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Dry-run mode
// ---------------------------------------------------------------------------

describe('dry-run mode', () => {
    it('does not call any write methods', async () => {
        const existing = new Date(2026, 4, 15);
        const incoming = new Date(2026, 5, 10);
        await run({ date: incoming, value: 110 }, [{ date: existing, value: 100 }], { dryRun: true });

        expect(mockAppendTickerValue).not.toHaveBeenCalled();
        expect(mockReplaceTickerValue).not.toHaveBeenCalled();
    });

    it('still reads the sheet to compute what would change', async () => {
        const existing = new Date(2026, 4, 15);
        const incoming = new Date(2026, 5, 10);
        await run({ date: incoming, value: 110 }, [{ date: existing, value: 100 }], { dryRun: true });

        expect(mockGetTickerValues).toHaveBeenCalledWith(TICKER);
    });
});
