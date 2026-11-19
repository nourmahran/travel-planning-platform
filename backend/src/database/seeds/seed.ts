import 'dotenv/config';
import * as dns from 'node:dns';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';
import { supportedCurrencies } from './supported-currencies';

dns.setServers(['8.8.8.8']);

const datasets = [
  { file: 'Countries.csv', collection: 'countries', key: 'code' },
  { file: 'Cities.csv', collection: 'cities', key: 'city_id' },
  { file: 'Airports.csv', collection: 'airports', key: 'iata_code' },
  { file: 'Attractions.csv', collection: 'attractions', key: 'attraction_id' },
];

async function seedDatabase() {
  const mongoUri = process.env.MONGODB_URI;
  const currencies = supportedCurrencies();

  if (!mongoUri) {
    throw new Error('MONGODB_URI is missing');
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB Atlas');

  try {
    for (const dataset of datasets) {
      const filePath = path.resolve(__dirname, '../data', dataset.file);

      const content = fs.readFileSync(filePath, 'utf8');

      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        trim: true,
      }) as Record<string, string>[];

      const collection = mongoose.connection.db!.collection(dataset.collection);

      if (records.some((record) => !record[dataset.key])) {
        throw new Error(`Missing identifier in ${dataset.file}`);
      }

      const identifiers = records.map((record) => record[dataset.key]);

      if (new Set(identifiers).size !== identifiers.length) {
        throw new Error(`Duplicate identifiers in ${dataset.file}`);
      }

      await collection.createIndex({ [dataset.key]: 1 }, { unique: true });

      if (records.length > 0) {
        await collection.bulkWrite(
          records.map((record) => ({
            updateOne: {
              filter: { [dataset.key]: record[dataset.key] },
              update: { $setOnInsert: record },
              upsert: true,
            },
          })),
          { ordered: true },
        );
      }

      console.log(`${dataset.collection}: processed ${records.length} records`);
    }

    const currencyCollection = mongoose.connection.db!.collection('currencies');
    await currencyCollection.createIndex({ code: 1 }, { unique: true });
    await currencyCollection.bulkWrite(
      currencies.map((currency) => ({
        updateOne: {
          filter: { code: currency.code },
          update: { $setOnInsert: currency },
          upsert: true,
        },
      })),
      { ordered: true },
    );
    console.log(`currencies: processed ${currencies.length} records`);
    await seedInitialAdmin();

    console.log('Database seeding completed successfully');
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed');
  }
}

/**
 * ACC-18 — seed the initial administrator account.
 * Admin self-registration remains forbidden on POST /auth/register.
 */
async function seedInitialAdmin(): Promise<void> {
  const email = (
    process.env.ADMIN_EMAIL ?? 'admin@travel.local'
  )
    .trim()
    .toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? 'Platform Admin';

  if (!password || password.length < 8) {
    console.log(
      'Skipping admin seed: set ADMIN_PASSWORD (min 8 chars) in backend/.env',
    );
    return;
  }

  const users = mongoose.connection.db!.collection('users');
  await users.createIndex({ email: 1 }, { unique: true });

  const existing = await users.findOne({ email });
  if (existing) {
    console.log(`Admin account already exists: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await users.insertOne({
    name,
    email,
    passwordHash,
    role: 'admin',
    status: 'active',
    acceptedTerms: true,
    acceptedPrivacyPolicy: true,
    mustChangePassword: false,
    failedLoginAttempts: 0,
    lockUntil: null,
    phone: null,
    preferredCurrency: 'USD',
    providerType: null,
    providerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`Seeded initial admin account: ${email}`);
}

seedDatabase().catch((error: unknown) => {
  console.error('Database seeding failed:', error);
  process.exitCode = 1;
});
