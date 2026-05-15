import { ValueRetrieverFactory, BondValueRetrieverMIB, StockValueRetrieverMIB } from '../lambda/stock-value-retriever';

const mockQuoteCombine = jest.fn();

jest.mock('yahoo-finance2', () =>
    jest.fn().mockImplementation(() => ({ quoteCombine: mockQuoteCombine }))
);

function mockFetchHtml(html: string) {
    global.fetch = jest.fn().mockResolvedValue({ text: () => Promise.resolve(html) } as any);
}

afterEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// ValueRetrieverFactory — routing
// ---------------------------------------------------------------------------

describe('ValueRetrieverFactory', () => {
    const anyDate = new Date('2026-05-14');

    beforeEach(() => {
        mockQuoteCombine.mockResolvedValue({
            regularMarketPrice: 100,
            regularMarketTime: anyDate,
        });
    });

    it('maps BTC to BTC-USD', async () => {
        await ValueRetrieverFactory.create({ ticker: 'BTC' }).getLatestValue();
        expect(mockQuoteCombine).toHaveBeenCalledWith('BTC-USD', expect.any(Object));
    });

    it('maps USDEUR to EURUSD=X', async () => {
        await ValueRetrieverFactory.create({ ticker: 'USDEUR' }).getLatestValue();
        expect(mockQuoteCombine).toHaveBeenCalledWith('EURUSD=X', expect.any(Object));
    });

    it('maps XETRA:<sym> to <sym>.DE', async () => {
        await ValueRetrieverFactory.create({ ticker: 'XETRA:DAX' }).getLatestValue();
        expect(mockQuoteCombine).toHaveBeenCalledWith('DAX.DE', expect.any(Object));
    });

    it('maps BIT:<sym> without URL to <sym>.MI', async () => {
        await ValueRetrieverFactory.create({ ticker: 'BIT:ENI' }).getLatestValue();
        expect(mockQuoteCombine).toHaveBeenCalledWith('ENI.MI', expect.any(Object));
    });

    it('maps BIT:<sym> with non-obbligazioni URL to <sym>.MI', async () => {
        await ValueRetrieverFactory.create({
            ticker: 'BIT:ISP',
            url: 'https://www.borsaitaliana.it/borsa/azioni/dettaglio.html',
        }).getLatestValue();
        expect(mockQuoteCombine).toHaveBeenCalledWith('ISP.MI', expect.any(Object));
    });

    it('maps BIT:<sym> with obbligazioni URL to BondValueRetrieverMIB', () => {
        const retriever = ValueRetrieverFactory.create({
            ticker: 'BIT:BTP',
            url: 'https://www.borsaitaliana.it/borsa/obbligazioni/dettaglio.html',
        });
        expect(retriever).toBeInstanceOf(BondValueRetrieverMIB);
    });

    it('passes unknown tickers directly to Yahoo', async () => {
        await ValueRetrieverFactory.create({ ticker: 'AAPL' }).getLatestValue();
        expect(mockQuoteCombine).toHaveBeenCalledWith('AAPL', expect.any(Object));
    });
});

// ---------------------------------------------------------------------------
// ValueRetrieverYahoo (exercised via factory with a plain ticker)
// ---------------------------------------------------------------------------

describe('ValueRetrieverYahoo', () => {
    it('returns value and date', async () => {
        const date = new Date('2026-05-14');
        mockQuoteCombine.mockResolvedValue({ regularMarketPrice: 98.76, regularMarketTime: date });

        const result = await ValueRetrieverFactory.create({ ticker: 'AAPL' }).getLatestValue();

        expect(result.value).toBe(98.76);
        expect(result.date).toBe(date);
    });

    it('throws when regularMarketPrice is missing', async () => {
        mockQuoteCombine.mockResolvedValue({ regularMarketTime: new Date() });
        await expect(ValueRetrieverFactory.create({ ticker: 'AAPL' }).getLatestValue())
            .rejects.toThrow('Price not found');
    });

    it('throws when regularMarketTime is missing', async () => {
        mockQuoteCombine.mockResolvedValue({ regularMarketPrice: 100 });
        await expect(ValueRetrieverFactory.create({ ticker: 'AAPL' }).getLatestValue())
            .rejects.toThrow('Price not found');
    });
});

// ---------------------------------------------------------------------------
// BondValueRetrieverMIB
// ---------------------------------------------------------------------------

describe('BondValueRetrieverMIB', () => {
    const BOND_URL = 'https://www.borsaitaliana.it/borsa/obbligazioni/dettaglio.html?isin=IT0001234567';

    const validHtml = `
        <html><body><table>
            <tr><td><strong>Reference price</strong></td><td><span>98.50</span></td></tr>
            <tr><td><strong>Reference price date</strong></td><td><span>14/05/2026</span></td></tr>
        </table></body></html>
    `;

    it('parses value and date correctly', async () => {
        mockFetchHtml(validHtml);
        const result = await new BondValueRetrieverMIB({ ticker: 'BIT:BTP', url: BOND_URL }).getLatestValue();
        expect(result.value).toBe(98.5);
        expect(result.date).toEqual(new Date(2026, 4, 14)); // months are 0-indexed
    });

    it('fetches the URL from config', async () => {
        mockFetchHtml(validHtml);
        await new BondValueRetrieverMIB({ ticker: 'BIT:BTP', url: BOND_URL }).getLatestValue();
        expect(global.fetch).toHaveBeenCalledWith(BOND_URL);
    });

    it('throws when Reference price xpath is not found', async () => {
        mockFetchHtml('<html><body></body></html>');
        await expect(new BondValueRetrieverMIB({ ticker: 'BIT:BTP', url: BOND_URL }).getLatestValue())
            .rejects.toThrow(/xpath/i);
    });

    it('throws when Reference price date xpath is not found', async () => {
        mockFetchHtml(`
            <html><body><table>
                <tr><td><strong>Reference price</strong></td><td><span>98.50</span></td></tr>
            </table></body></html>
        `);
        await expect(new BondValueRetrieverMIB({ ticker: 'BIT:BTP', url: BOND_URL }).getLatestValue())
            .rejects.toThrow(/xpath/i);
    });
});

// ---------------------------------------------------------------------------
// StockValueRetrieverMIB
// ---------------------------------------------------------------------------

describe('StockValueRetrieverMIB', () => {
    // Span format: "<value> - <yy>/<mm>/<dd>"
    const validHtml = `
        <html><body><table>
            <tr><td><strong>Reference Close</strong></td><td><span>125.30 - 26/05/14</span></td></tr>
        </table></body></html>
    `;

    it('throws when ISIN code is not provided', async () => {
        await expect(new StockValueRetrieverMIB({ ticker: 'BIT:ETF' }).getLatestValue())
            .rejects.toThrow('ISIN code not provided');
    });

    it('uses the default Borsa Italiana URL when no url is configured', async () => {
        mockFetchHtml(validHtml);
        await new StockValueRetrieverMIB({ ticker: 'BIT:ETF', isinCode: 'IT0001234567' }).getLatestValue();
        expect(global.fetch).toHaveBeenCalledWith(
            'https://www.borsaitaliana.it/borsa/etf/dettaglio.html?isin=IT0001234567&lang=en'
        );
    });

    it('uses the custom URL from config when provided', async () => {
        const customUrl = 'https://www.borsaitaliana.it/borsa/etf/custom.html';
        mockFetchHtml(validHtml);
        await new StockValueRetrieverMIB({ ticker: 'BIT:ETF', isinCode: 'IT0001234567', url: customUrl }).getLatestValue();
        expect(global.fetch).toHaveBeenCalledWith(customUrl);
    });

    it('parses value and date correctly', async () => {
        mockFetchHtml(validHtml);
        const result = await new StockValueRetrieverMIB({ ticker: 'BIT:ETF', isinCode: 'IT0001234567' }).getLatestValue();
        // "26/05/14" → year=2026, month=5 (index 4), day=14
        expect(result.value).toBe(125.30);
        expect(result.date).toEqual(new Date(2026, 4, 14));
    });

    it('throws when Reference Close xpath is not found', async () => {
        mockFetchHtml('<html><body></body></html>');
        await expect(new StockValueRetrieverMIB({ ticker: 'BIT:ETF', isinCode: 'IT0001234567' }).getLatestValue())
            .rejects.toThrow(/xpath/i);
    });
});
