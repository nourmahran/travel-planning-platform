import type { ConfigService } from '@nestjs/config';

import { FxRatesClient, FxRatesError } from './fxrates.client';

const config = {
  get: (key: string) =>
    ({
      FX_RATES_API_BASE_URL: 'https://fx.test',
      FX_RATES_TIMEOUT_MS: '100',
    })[key],
} as unknown as ConfigService;

const response = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

describe('FxRatesClient', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('parses the rates map and sends base=USD', async () => {
    fetchMock.mockResolvedValue(
      response({ success: true, date: '2026-11-15', base: 'USD', rates: { EGP: 50 } }),
    );

    const result = await new FxRatesClient(config).fetchLatest();

    expect(result).toEqual({ base: 'USD', rates: { EGP: 50 } });
    const requested = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requested.origin).toBe('https://fx.test');
    expect(requested.pathname).toBe('/latest');
    expect(requested.searchParams.get('base')).toBe('USD');
  });

  it('retries once before giving up', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(response({ success: true, rates: { EGP: 50 } }));

    const result = await new FxRatesClient(config).fetchLatest();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.rates.EGP).toBe(50);
  });

  it('throws a typed error after two failures', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await expect(new FxRatesClient(config).fetchLatest()).rejects.toBeInstanceOf(
      FxRatesError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a typed error on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(response({}, false, 502));

    await expect(new FxRatesClient(config).fetchLatest()).rejects.toBeInstanceOf(
      FxRatesError,
    );
  });

  it('throws a typed error on a malformed payload', async () => {
    fetchMock.mockResolvedValue(response({ success: false, rates: {} }));

    await expect(new FxRatesClient(config).fetchLatest()).rejects.toBeInstanceOf(
      FxRatesError,
    );
  });

  it('throws a typed error when rates are missing', async () => {
    fetchMock.mockResolvedValue(response({ success: true }));

    await expect(new FxRatesClient(config).fetchLatest()).rejects.toBeInstanceOf(
      FxRatesError,
    );
  });
});
