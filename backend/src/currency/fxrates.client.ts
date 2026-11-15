import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type FxRatesPayload = {
  base: string;
  rates: Record<string, number>;
};

/** A failure of the external FX API or of its payload, never a client error. */
export class FxRatesError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FxRatesError';
  }
}

const DEFAULT_BASE_URL = 'https://api.fxratesapi.com';
const DEFAULT_TIMEOUT_MS = 5000;
const ATTEMPTS = 2;

@Injectable()
export class FxRatesClient {
  constructor(private readonly config: ConfigService) {}

  /** GET /latest?base=USD with a timeout and one retry (ITN-18). */
  async fetchLatest(): Promise<FxRatesPayload> {
    const url = this.buildUrl();
    const timeoutMs = this.timeoutMs();
    let lastError: unknown;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        const payload = await this.request(url, timeoutMs);

        return this.parse(payload);
      } catch (error) {
        lastError = error;
      }
    }

    throw new FxRatesError('The exchange-rate API is unavailable', {
      cause: lastError,
    });
  }

  private buildUrl(): URL {
    const base =
      this.config.get<string>('FX_RATES_API_BASE_URL') ?? DEFAULT_BASE_URL;
    const url = new URL('/latest', base);

    url.searchParams.set('base', 'USD');

    const key = this.config.get<string>('FX_RATES_API_KEY');

    if (key) {
      url.searchParams.set('api_key', key);
    }

    return url;
  }

  private timeoutMs(): number {
    const configured = Number(
      this.config.get<string>('FX_RATES_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS,
    );

    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_TIMEOUT_MS;
  }

  private async request(url: URL, timeoutMs: number): Promise<unknown> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new FxRatesError(
        `The exchange-rate API responded ${response.status}`,
      );
    }

    return response.json() as Promise<unknown>;
  }

  private parse(payload: unknown): FxRatesPayload {
    if (!payload || typeof payload !== 'object') {
      throw new FxRatesError('The exchange-rate payload is not an object');
    }

    const record = payload as Record<string, unknown>;

    if (record.success === false) {
      throw new FxRatesError('The exchange-rate API returned success=false');
    }

    if (!record.rates || typeof record.rates !== 'object') {
      throw new FxRatesError('The exchange-rate payload has no rates map');
    }

    const rates: Record<string, number> = {};

    for (const [code, value] of Object.entries(
      record.rates as Record<string, unknown>,
    )) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        rates[code.toUpperCase()] = value;
      }
    }

    if (Object.keys(rates).length === 0) {
      throw new FxRatesError('The exchange-rate payload has no usable rates');
    }

    const base =
      typeof record.base === 'string' ? record.base.toUpperCase() : 'USD';

    return { base, rates };
  }
}
