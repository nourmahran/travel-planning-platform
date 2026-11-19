/** Reads configuration lazily so .env loading order never matters. */

export function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}
