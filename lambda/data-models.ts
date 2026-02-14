export interface TickerConfig {
    readonly ticker: string;
    readonly isinCode?: string;
    readonly url?: string;
}

export interface TickerValue {
    readonly value: number;
    readonly date: Date;
}
