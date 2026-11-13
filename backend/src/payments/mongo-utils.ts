import { Types } from 'mongoose';

/** MongoDB duplicate-key error (unique index violation). */
export function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 11000
  );
}

export function toObjectId(id: string | Types.ObjectId): Types.ObjectId {
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

/** Keeps stored Stripe messages short (they never contain card numbers). */
export function shortMessage(
  message: string | null | undefined,
  fallback: string,
): string {
  const text = (message ?? '').trim() || fallback;
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}
