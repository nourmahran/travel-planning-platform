import 'dotenv/config';
import * as dns from 'node:dns';
import * as fs from 'node:fs';
import * as path from 'node:path';
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

    console.log('Database seeding completed successfully');
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed');
  }
}

seedDatabase().catch((error: unknown) => {
  console.error('Database seeding failed:', error);
  process.exitCode = 1;
});
