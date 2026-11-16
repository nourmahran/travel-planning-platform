import { MongoMemoryReplSet } from 'mongodb-memory-server';

export function createTestDatabase() {
  const args = ['--setParameter', 'diagnosticDataCollectionEnabled=false'];
  if (process.platform !== 'win32') args.unshift('--nounixsocket');
  return MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION ?? '7.0.24' },
    replSet: { count: 1, args },
  });
}
