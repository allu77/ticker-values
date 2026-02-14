import { JSDOM } from 'jsdom';
import YahooFinance from 'yahoo-finance2'

import { TickerConfig, TickerValue } from "./data-models";



export interface IValueRetriever {
    getLatestValue(): Promise<TickerValue>;
}

export class ValueRetrieverFactory {
    static create(config: TickerConfig): IValueRetriever {

        if (config.ticker == 'BTC') return new ValueRetrieverYahoo({ ticker: 'BTC-USD' });
        if (config.ticker == 'USDEUR') return new ValueRetrieverYahoo({ ticker: 'EURUSD=X' });
        if (config.ticker.startsWith('XETRA:')) return new ValueRetrieverYahoo({ ticker: config.ticker.split(':')[1] + '.DE' })

        if (config.ticker.startsWith('BIT:')) {
            if (config.url?.includes('obbligazioni')) return new BondValueRetrieverMIB(config);
            return new ValueRetrieverYahoo({ ticker: config.ticker.split(':')[1] + '.MI' })
        }

        return new ValueRetrieverYahoo(config);
    }
}

abstract class ValueRetrieverBase implements IValueRetriever {
    protected config: TickerConfig;

    abstract getLatestValue(): Promise<TickerValue>;

    constructor(config: TickerConfig) {
        this.config = config;
    }
}

abstract class ValueRetrieverHTMLBase extends ValueRetrieverBase {
    protected fetchUrl(url: string): Promise<string> {
        return fetch(url).then(response => response.text());
    }

    protected retrieveXPaths(html: string, xpaths: string[]): string[] {
        const dom = new JSDOM(html);
        const document = dom.window.document;

        const results: string[] = [];

        for (const xpath of xpaths) {
            const result = document.evaluate(xpath, document, null, 9, null);
            const cellContent = result.singleNodeValue?.textContent?.trim();
            if (!cellContent) {
                throw new Error(`Cell content not found for xpath ${xpath}`);
            }
            results.push(cellContent);
        }

        return results;
    }
}

class ValueRetrieverYahoo extends ValueRetrieverBase {
    async getLatestValue(): Promise<TickerValue> {
        const yf = new YahooFinance(
            { suppressNotices: ['yahooSurvey'] }
        );
        const result = await yf.quoteCombine(this.config.ticker, { fields: ["regularMarketPrice", "regularMarketTime"] });

        if (!result.regularMarketPrice || !result.regularMarketTime) {
            throw new Error('Price not found');
        }

        return {
            value: result.regularMarketPrice,
            date: result.regularMarketTime,
        }
    }
}









export class StockValueRetrieverMIB extends ValueRetrieverHTMLBase {

    async getLatestValue(): Promise<TickerValue> {

        if (!this.config.isinCode) {
            throw new Error('ISIN code not provided');
        }

        const url = this.config.url || `https://www.borsaitaliana.it/borsa/etf/dettaglio.html?isin=${this.config.isinCode}&lang=en`;
        const html = await this.fetchUrl(url);

        // Extract value using XPath
        const xpath = "//td[.//strong[text()='Reference Close']]/following-sibling::td/span";

        const [cellContent] = this.retrieveXPaths(html, [xpath]);
        const [valueString, dateString] = cellContent.split('-');

        const value = parseFloat(valueString.trim())

        const [year, month, day] = dateString.trim().split(/\s+/)[0].split('/')
        const date = new Date(parseInt(`20${year}`), parseInt(month) - 1, parseInt(day))

        return { value, date };
    }
}

export class BondValueRetrieverMIB extends ValueRetrieverHTMLBase {
    async getLatestValue(): Promise<TickerValue> {

        const url = this.config.url;
        const html = await this.fetchUrl(url!);

        const xpaths = [
            "//td[.//strong[text()='Reference price']]/following-sibling::td/span",
            "//td[.//strong[text()='Reference price date']]/following-sibling::td/span",
        ]

        const [valueString, dateString] = this.retrieveXPaths(html, xpaths);

        const value = parseFloat(valueString.trim())

        const [day, month, year] = dateString.trim().split(/\s+/)[0].split('/')
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))

        return { value, date };

    }
}
