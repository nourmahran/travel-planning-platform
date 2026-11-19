export function supportedCurrencies(
  configured = process.env.SUPPORTED_CURRENCIES,
  platform = process.env.PLATFORM_CURRENCY ?? 'USD',
) {
  const codes = new Set(
    [platform, ...(configured?.split(',') ?? [])]
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
  const recognized = new Set(Intl.supportedValuesOf('currency'));
  const invalid = [...codes].filter((code) => !recognized.has(code));
  if (invalid.length) {
    throw new Error(`Unsupported currency code: ${invalid.join(', ')}`);
  }
  const names = new Intl.DisplayNames(['en'], { type: 'currency' });
  return [...codes].sort().map((code) => ({
    code,
    name: names.of(code) ?? code,
  }));
}
