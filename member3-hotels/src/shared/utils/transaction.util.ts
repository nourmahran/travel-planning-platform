import { Connection, ClientSession } from 'mongoose';

/**
 * Runs `work` inside a MongoDB transaction (Atlas replica set).
 *
 * Used for the all-or-nothing parts of HTL-16/HTL-18: insert the reservation,
 * insert the per-night locks, and update the block document together.
 */
export async function runInTransaction<T>(
  connection: Connection,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}
