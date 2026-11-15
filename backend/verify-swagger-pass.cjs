/*
 * Dev-only live verification harness for the itineraries module.
 *
 * Not part of the API and not shipped. It reads credentials from the
 * gitignored backend/.env and prints database names only, never a URI, a host
 * or an environment value.
 *
 *   node verify-swagger-pass.cjs --db=travel_planning_verify --seed=repo
 *   node verify-swagger-pass.cjs --db=travel_planning_verify --seed=existing --mirror
 *
 * Order matters and is load-bearing: @nestjs/config resolves the .env value
 * before consulting a later process.env change, and ConfigModule.forRoot runs
 * when ./dist/app.module is imported. So the retargeted URI is written to
 * process.env *before* that import, and the app's own connection is asserted
 * to have landed on the scratch database before a single check runs.
 *
 * Exit codes: 0 no failures, 1 a check failed, 2 a precondition is missing,
 * 3 the target guard refused (wrong database, or the app landed elsewhere).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRATCH_DB = 'travel_planning_verify';
/** Never written to. Refused by name so a typo cannot reach the team's data. */
const SHARED_DB = 'travel_planning';
/** Reference data plus the rows flights.airlineId resolves against. */
const MIRRORED_COLLECTIONS = [
  'countries',
  'cities',
  'airports',
  'attractions',
  'airlines',
  'flights',
];

/* ------------------------------------------------------------------ flags */

const argv = process.argv.slice(2);

function flagValue(name) {
  const prefix = `--${name}=`;
  const found = argv.find((value) => value.startsWith(prefix));

  return found === undefined ? undefined : found.slice(prefix.length);
}

function hasFlag(name) {
  return argv.includes(`--${name}`);
}

const requestedDb = flagValue('db') ?? SCRATCH_DB;
const seedMode = flagValue('seed') ?? 'repo';
const mirrorSource = hasFlag('mirror');
const keepDatabase = hasFlag('keep');

function refuseTarget(message) {
  console.error(`TARGET GUARD: ${message}`);
  console.error('Nothing was written and no connection was opened.');
  process.exit(3);
}

if (requestedDb === SHARED_DB) {
  refuseTarget(
    `--db=${SHARED_DB} is the team's database; this harness only ever writes to ${SCRATCH_DB}`,
  );
}

if (requestedDb !== SCRATCH_DB) {
  refuseTarget(
    `--db=${requestedDb} is not the scratch database; the only accepted name is ${SCRATCH_DB}`,
  );
}

if (seedMode !== 'repo' && seedMode !== 'existing') {
  console.error(`--seed=${seedMode} is not valid; use --seed=repo or --seed=existing`);
  process.exit(2);
}

/* -------------------------------------------------------------- URI tools */

/** The database name a URI points at; never called with a value that is printed. */
function databaseNameOf(uri) {
  const base = uri.split('?')[0];
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?#]+)/.exec(base);

  return match ? decodeURIComponent(match[1]) : '';
}

/** Same URI, same credentials and options, a different database. */
function withDatabase(uri, name) {
  const queryIndex = uri.indexOf('?');
  const base = queryIndex === -1 ? uri : uri.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : uri.slice(queryIndex);
  const match = /^(mongodb(?:\+srv)?:\/\/[^/]+\/)([^/?#]*)(.*)$/.exec(base);

  if (!match) {
    throw new Error('MONGODB_URI has no database path segment to retarget');
  }

  return `${match[1]}${encodeURIComponent(name)}${match[3]}${query}`;
}

/* ------------------------------------------------------------- bootstrap */

const envPath = path.join(__dirname, '.env');

if (!fs.existsSync(envPath)) {
  console.error('backend/.env is missing; MONGODB_URI cannot be read');
  process.exit(2);
}

// 1. The .env file fills process.env. dotenv does not overwrite a value that
//    is already set, so an explicit MONGODB_URI in the environment still wins.
require('dotenv').config({ path: envPath });

const sourceUri = process.env.MONGODB_URI;

if (!sourceUri) {
  console.error('MONGODB_URI is missing from backend/.env');
  process.exit(2);
}

// 2. Capture where the data lives before the rewrite. Mirrors read from here.
const sourceDb = databaseNameOf(sourceUri);

if (!sourceDb) {
  console.error('MONGODB_URI has no database path segment');
  process.exit(2);
}

if (sourceDb === SCRATCH_DB) {
  refuseTarget(
    `the configured URI already names ${SCRATCH_DB}; the source of a mirror must be another database`,
  );
}

// 3. Retarget, then assert the rewritten string before anything is imported.
try {
  process.env.MONGODB_URI = withDatabase(sourceUri, SCRATCH_DB);
} catch (error) {
  console.error(`MONGODB_URI cannot be retargeted: ${error.message}`);
  process.exit(2);
}

function assertUriTarget(label) {
  const actual = databaseNameOf(process.env.MONGODB_URI);

  if (actual !== SCRATCH_DB) {
    refuseTarget(`${label}: the URI names "${actual}", expected "${SCRATCH_DB}"`);
  }

  return actual;
}

assertUriTarget('rewritten URI, before the app import');

// 4. Only now may the Nest application be loaded: ConfigModule.forRoot reads
//    the environment during this import.
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { getConnectionToken } = require('@nestjs/mongoose');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { parse } = require('csv-parse/sync');
const { AppModule } = require('./dist/app.module');
const {
  HttpExceptionFilter,
} = require('./dist/common/filters/http-exception.filter');

/* -------------------------------------------------------------- reporting */

let passed = 0;
let failed = 0;
let skipped = 0;
const skipLines = [];
const findings = [];
const notes = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
  }

  const mark = condition ? 'PASS' : 'FAIL';
  const extra = detail === undefined ? '' : `  ${detail}`;

  console.log(`${mark}  ${name}${extra}`);
}

function skip(name, reason) {
  skipped += 1;
  skipLines.push(`${name} — ${reason}`);
  console.log(`SKIP  ${name}  ${reason}`);
}

function finding(owner, title, detail) {
  findings.push({ owner, title, detail });
  console.log(`FINDING [${owner}] ${title}`);
}

function note(text) {
  notes.push(text);
  console.log(`note  ${text}`);
}

function show(result) {
  return `-> ${result.status} ${JSON.stringify(result.body).slice(0, 240)}`;
}

/* ----------------------------------------------------------- data helpers */

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);

  return value.toISOString().slice(0, 10);
}

/** The calendar date of an instant in the airport's zone. */
function localDate(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type) => parts.find((entry) => entry.type === type)?.value;

  return `${part('year')}-${part('month')}-${part('day')}`;
}

/* ------------------------------------------------------------------ mirror */

/**
 * Copies the reference collections from the configured database into the
 * scratch database. Read-only on the source: find() only. _id is preserved so
 * flights.airlineId still resolves. Nothing here touches users, bookings or
 * refresh sessions.
 */
async function mirrorReferenceData() {
  const source = await mongoose
    .createConnection(sourceUri, { serverSelectionTimeoutMS: 15000 })
    .asPromise();
  const target = await mongoose
    .createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
    .asPromise();

  console.log(`\nmirror  source database: ${sourceDb}`);
  console.log(`mirror  target database: ${SCRATCH_DB}`);

  try {
    for (const name of MIRRORED_COLLECTIONS) {
      const documents = await source.db.collection(name).find({}).toArray();
      const existing = await target.db.collection(name).countDocuments();

      if (existing > 0) {
        console.log(`mirror  ${name}: ${existing} documents already in the scratch database, left alone`);
        continue;
      }

      if (documents.length > 0) {
        await target.db.collection(name).insertMany(documents);
      }

      console.log(`mirror  ${name}: ${documents.length} documents copied`);
    }
  } finally {
    await source.close();
    await target.close();
  }
}

/* -------------------------------------------------------------------- seed */

/**
 * Runs the repository seed with the retargeted URI in the child environment.
 * The inherited value is never passed through: seed.ts loads dotenv itself and
 * a wrong URI there would write to the team's database.
 */
function seedThroughRepository() {
  if (databaseNameOf(process.env.MONGODB_URI) !== SCRATCH_DB) {
    refuseTarget('seed: the URI changed since the guard ran');
  }

  console.log(`\nseed    npm run seed against ${SCRATCH_DB}`);

  const result = spawnSync('npm run seed', {
    cwd: __dirname,
    shell: true,
    timeout: 180000,
    encoding: 'utf8',
    env: { ...process.env, MONGODB_URI: process.env.MONGODB_URI },
  });

  if (result.status === 0) {
    note('repo seed completed through npm run seed');
    return true;
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const tail = output.split('\n').slice(-6).join('\n');

  finding(
    'member 2',
    `npm run seed exited ${result.status ?? 'without a status'}`,
    `The harness fell back to its own CSV insert, which writes the four reference collections and no admin account. Seed output, last lines:\n${tail}`,
  );

  return false;
}

/** Fallback: the four reference CSVs, inserted only when a collection is empty. */
async function insertReferenceCsvs() {
  const connection = await mongoose
    .createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
    .asPromise();
  const files = [
    { file: 'Countries.csv', collection: 'countries' },
    { file: 'Cities.csv', collection: 'cities' },
    { file: 'Airports.csv', collection: 'airports' },
    { file: 'Attractions.csv', collection: 'attractions' },
  ];

  try {
    for (const { file, collection } of files) {
      const rows = parse(
        fs.readFileSync(path.join(__dirname, 'src', 'database', 'data', file), 'utf8'),
        { columns: true, skip_empty_lines: true, trim: true },
      );
      const existing = await connection.db.collection(collection).countDocuments();

      if (existing > 0) {
        console.log(`fallback  ${collection}: ${existing} documents already there`);
        continue;
      }

      await connection.db.collection(collection).insertMany(rows);
      console.log(`fallback  ${collection}: ${rows.length} documents inserted`);
    }
  } finally {
    await connection.close();
  }
}

/* --------------------------------------------------------------- requests */

const SESSION = { a: { jar: {} }, b: { jar: {} } };
const stamp = Date.now();
const ACCOUNTS = {
  a: {
    name: 'Itinerary Owner',
    email: `m5-owner-${stamp}@example.test`,
    password: 'Passw0rd!23',
  },
  b: {
    name: 'Second Traveller',
    email: `m5-second-${stamp}@example.test`,
    password: 'Passw0rd!23',
  },
};

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function rememberCookies(response, jar) {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');

    if (index > 0) {
      jar[pair.slice(0, index)] = pair.slice(index + 1);
    }
  }
}

/* -------------------------------------------------------------------- main */

async function main() {
  const startedAt = new Date().toISOString();
  const B = addDays(utcToday(), 3);
  let completed = false;

  console.log(`run     ${startedAt}`);
  console.log(`target  database: ${SCRATCH_DB}`);
  console.log(`source  database: ${sourceDb}${mirrorSource ? ' (mirrored)' : ''}`);
  console.log(`seed    mode: ${seedMode}`);
  console.log(`dates   B = ${B} (today + 3, UTC)`);

  if (mirrorSource) {
    await mirrorReferenceData();
  }

  if (seedMode === 'repo') {
    const seeded = seedThroughRepository();

    if (!seeded) {
      await insertReferenceCsvs();
    }
  } else {
    console.log('\nseed    skipped: --seed=existing leaves the scratch database as it is');
  }

  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Second assertion, against the connection the app actually opened. Nothing
  // has been written yet: a mismatch here is still free.
  const connection = app.get(getConnectionToken());
  const connectionDb = connection.db?.databaseName;

  if (connectionDb !== SCRATCH_DB) {
    await app.close();
    refuseTarget(
      `the app connected to "${connectionDb}", expected "${SCRATCH_DB}"`,
    );
  }

  note(`the app's connection reports databaseName ${connectionDb}`);

  await app.listen(0);
  const { port } = app.getHttpServer().address();
  const base = `http://127.0.0.1:${port}`;
  console.log(`\nlistening on ${base}\n`);

  const call = async (method, url, { body, as, csrf = true } = {}) => {
    const jar = as ? SESSION[as].jar : undefined;
    const hasCookies = jar && Object.keys(jar).length > 0;
    const isWrite = method !== 'GET';

    const response = await fetch(base + url, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(hasCookies ? { cookie: cookieHeader(jar) } : {}),
        ...(hasCookies && isWrite && csrf && jar.csrf_token
          ? { 'x-csrf-token': jar.csrf_token }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (jar) {
      rememberCookies(response, jar);
    }

    const text = await response.text();
    let parsed = null;

    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    return { status: response.status, body: parsed };
  };

  /** FX-dependent checks skip, they never pass, when no rate can be had. */
  const fxUnavailable = (result) =>
    result.status === 503 ||
    (result.body && result.body.rateSource === 'stale');
  const FX_REASON = 'no cache and API unreachable';

  try {
    /* ------------------------------------------------ accounts and session */
    for (const [key, account] of Object.entries(ACCOUNTS)) {
      const registered = await call('POST', '/auth/register', {
        body: {
          name: account.name,
          email: account.email,
          password: account.password,
          acceptedTerms: true,
          acceptedPrivacyPolicy: true,
        },
      });
      check(
        `POST /auth/register (${key}) -> 201`,
        registered.status === 201,
        show(registered),
      );

      const loggedIn = await call('POST', '/auth/login', {
        as: key,
        body: { email: account.email, password: account.password },
      });
      const jar = SESSION[key].jar;
      check(
        `POST /auth/login (${key}) sets access_token and csrf_token`,
        loggedIn.status === 200 &&
          Boolean(jar.access_token) &&
          Boolean(jar.csrf_token),
        `-> ${loggedIn.status} cookies: ${Object.keys(jar).join(', ')}`,
      );
    }

    /* ----------------------------------------------------------- preflight */
    const egCities = await call('GET', '/cities?country=EG&limit=3');
    const aeCities = await call('GET', '/cities?country=AE&limit=3');
    const egCity = egCities.body?.items?.[0];
    const aeCity = aeCities.body?.items?.[0];

    check(
      'GET /cities (guest) resolves EG and AE',
      egCities.status === 200 &&
        (egCities.body?.items?.length ?? 0) > 0 &&
        aeCities.status === 200 &&
        (aeCities.body?.items?.length ?? 0) > 0,
      `-> EG ${egCities.status}, AE ${aeCities.status}`,
    );

    const attraction = await connection.db
      .collection('attractions')
      .findOne({}, { projection: { attraction_id: 1 } });
    const foreignCity = await connection.db
      .collection('cities')
      .findOne(
        { country_code: { $nin: ['EG', 'AE'] } },
        { projection: { city_id: 1 } },
      );

    const fixturesReady = Boolean(egCity && aeCity && foreignCity);
    const attractionId = attraction?.attraction_id;

    if (attractionId) {
      console.log(`preflight  attraction: ${attractionId}`);
    }

    if (!fixturesReady) {
      skip(
        'the itinerary checks that need two countries and a third city',
        `missing fixture: ${!egCity ? 'no EG city' : ''}${!aeCity ? ' no AE city' : ''}${!foreignCity ? ' no city outside EG/AE' : ''}`.trim(),
      );
    }

    /* ------------------------------------------------------- itinerary CRUD */
    const unauth = await call('GET', '/itineraries');
    check('GET /itineraries without a session -> 401', unauth.status === 401, show(unauth));

    const badTitle = await call('POST', '/itineraries', {
      as: 'a',
      body: { title: '   ', countries: ['EG'], startDate: B },
    });
    check('POST /itineraries with a blank title -> 400', badTitle.status === 400, show(badTitle));

    const badCountry = await call('POST', '/itineraries', {
      as: 'a',
      body: { title: 'Nowhere', countries: ['ZZ'], startDate: B },
    });
    check('POST /itineraries with an unknown country -> 400', badCountry.status === 400, show(badCountry));

    if (!fixturesReady) {
      skip('the whole CRUD walk', 'reference fixtures are missing');

      return;
    }

    const created = await call('POST', '/itineraries', {
      as: 'a',
      body: {
        title: `Live check: ${egCity.name} and ${aeCity.name}`,
        countries: ['EG', 'AE'],
        startDate: B,
        currency: 'EGP',
      },
    });
    const itineraryId = created.body && created.body.id;
    check('POST /itineraries -> 201', created.status === 201 && Boolean(itineraryId), show(created));

    if (!itineraryId) {
      skip('the rest of the walk', 'the itinerary could not be created');

      return;
    }

    const list = await call('GET', '/itineraries?page=1&limit=10', { as: 'a' });
    check(
      'GET /itineraries',
      list.status === 200 && list.body.items.some((item) => item.id === itineraryId),
      show({ status: list.status, body: { total: list.body && list.body.total } }),
    );

    const detail = await call('GET', `/itineraries/${itineraryId}`, { as: 'a' });
    check('GET /itineraries/:id', detail.status === 200 && detail.body.dayCount === 0, show(detail));

    const edited = await call('PATCH', `/itineraries/${itineraryId}`, {
      as: 'a',
      body: { title: 'Live check (edited)' },
    });
    check(
      'PATCH /itineraries/:id',
      edited.status === 200 && edited.body.title.includes('(edited)'),
      show(edited),
    );

    /* ---------------------------------------------------------------- days */
    const day1 = await call('POST', `/itineraries/${itineraryId}/days`, {
      as: 'a',
      body: { cityId: egCity.city_id },
    });
    const day2 = await call('POST', `/itineraries/${itineraryId}/days`, {
      as: 'a',
      body: { cityId: egCity.city_id },
    });
    const day3 = await call('POST', `/itineraries/${itineraryId}/days`, {
      as: 'a',
      body: { cityId: aeCity.city_id },
    });
    check(
      `POST days ${egCity.city_id}, ${egCity.city_id}, ${aeCity.city_id} -> 201 with dates B, B+1, B+2`,
      day1.status === 201 &&
        day3.status === 201 &&
        day1.body.day.date === B &&
        day2.body.day.date === addDays(B, 1) &&
        day3.body.day.date === addDays(B, 2),
      show(day3),
    );

    const foreignCityEdit = await call(
      'PATCH',
      `/itineraries/${itineraryId}/days/${day3.body.day.id}`,
      { as: 'a', body: { cityId: foreignCity.city_id } },
    );
    check(
      'PATCH day to a city outside the countries -> 400',
      foreignCityEdit.status === 400,
      show(foreignCityEdit),
    );

    const noted = await call('PATCH', `/itineraries/${itineraryId}/days/${day1.body.day.id}`, {
      as: 'a',
      body: { notes: 'Early start' },
    });
    check(
      'PATCH day notes -> 200 and the note comes back',
      noted.status === 200 && noted.body.notes === 'Early start',
      show(noted),
    );

    const notedDetail = await call('GET', `/itineraries/${itineraryId}`, { as: 'a' });
    check(
      'GET detail keeps the day note',
      notedDetail.status === 200 &&
        notedDetail.body.days.some((day) => day.notes === 'Early start'),
      show({ status: notedDetail.status, body: { notes: notedDetail.body?.days?.map((day) => day.notes) } }),
    );

    const emptyDayPatch = await call(
      'PATCH',
      `/itineraries/${itineraryId}/days/${day1.body.day.id}`,
      { as: 'a', body: {} },
    );
    check('PATCH a day with an empty body -> 400', emptyDayPatch.status === 400, show(emptyDayPatch));

    const reordered = await call('PATCH', `/itineraries/${itineraryId}/days/reorder`, {
      as: 'a',
      body: { dayIds: [day3.body.day.id, day1.body.day.id, day2.body.day.id] },
    });
    check(
      'PATCH days/reorder recalculates dates',
      reordered.status === 200 &&
        reordered.body[0].date === B &&
        reordered.body[2].date === addDays(B, 2),
      show(reordered),
    );
    const orderedIds = (reordered.body ?? []).map((day) => day.id);
    const orderedFirst = reordered.body?.[0];

    /* ---------------------------------------------- activities and images */
    const activity = await call('POST', `/itineraries/${itineraryId}/days/${orderedIds[0]}/activities`, {
      as: 'a',
      body: {
        title: 'Observation deck',
        ...(attractionId ? { attractionId } : {}),
        startTime: '09:00',
        durationMinutes: 180,
        notes: 'Tickets online',
        cost: 450,
      },
    });
    check('POST activity -> 201', activity.status === 201, show(activity));

    const badTime = await call('POST', `/itineraries/${itineraryId}/days/${orderedIds[0]}/activities`, {
      as: 'a',
      body: { title: 'Late', startTime: '25:00' },
    });
    check('POST activity with startTime 25:00 -> 400', badTime.status === 400, show(badTime));

    const badMoney = await call('POST', `/itineraries/${itineraryId}/days/${orderedIds[0]}/activities`, {
      as: 'a',
      body: { title: 'Exact', cost: 10.005 },
    });
    check('POST activity with 3 decimals -> 400', badMoney.status === 400, show(badMoney));

    const editedActivity = await call('PATCH', `/activities/${activity.body?.id}`, {
      as: 'a',
      body: { durationMinutes: 240 },
    });
    check(
      'PATCH activity',
      editedActivity.status === 200 && editedActivity.body.durationMinutes === 240,
      show(editedActivity),
    );

    const image = await call('POST', `/activities/${activity.body?.id}/images`, {
      as: 'a',
      body: { url: 'https://cdn.example.com/photo.png', mimeType: 'image/png', sizeBytes: 204800 },
    });
    check('POST activity image -> 201', image.status === 201, show(image));

    const removedImage = await call(
      'DELETE',
      `/activities/${activity.body?.id}/images/${image.body?.id}`,
      { as: 'a' },
    );
    check(
      'DELETE activity image -> 200 with the removed id',
      removedImage.status === 200 && removedImage.body.removedImageId === image.body?.id,
      show(removedImage),
    );

    /* ------------------------------------------------------------- budgets */
    const budget = await call('POST', `/itineraries/${itineraryId}/days/${orderedIds[0]}/budgets`, {
      as: 'a',
      body: { category: 'food', amount: 200, note: 'Lunch' },
    });
    check('POST budget -> 201', budget.status === 201, show(budget));

    check(
      'POST budget echoes the itinerary currency by default',
      budget.status === 201 && budget.body.currency === 'EGP',
      show(budget),
    );

    const badCategory = await call('POST', `/itineraries/${itineraryId}/days/${orderedIds[0]}/budgets`, {
      as: 'a',
      body: { category: 'souvenirs', amount: 10 },
    });
    check('POST budget with an unknown category -> 400', badCategory.status === 400, show(badCategory));

    const editedBudget = await call('PATCH', `/budgets/${budget.body?.id}`, {
      as: 'a',
      body: { amount: 250 },
    });
    check(
      'PATCH budget',
      editedBudget.status === 200 && editedBudget.body.amount === 250,
      show(editedBudget),
    );

    /* ----------------------------------------------------- transport costs */
    const transport = await call('POST', `/itineraries/${itineraryId}/transport-costs`, {
      as: 'a',
      body: {
        mode: 'flight',
        fromCityId: egCity.city_id,
        toCityId: aeCity.city_id,
        amount: 300,
        date: addDays(B, 2),
        note: 'Flight',
      },
    });
    check('POST transport cost -> 201', transport.status === 201, show(transport));

    const unusedCity = await call('POST', `/itineraries/${itineraryId}/transport-costs`, {
      as: 'a',
      body: {
        mode: 'train',
        fromCityId: egCity.city_id,
        toCityId: foreignCity.city_id,
        amount: 300,
      },
    });
    check('POST transport cost to an unused city -> 400', unusedCity.status === 400, show(unusedCity));

    /* ------------------------------------------------------ budget summary */
    const summary = await call(
      'GET',
      `/itineraries/${itineraryId}/budget-summary?currency=EGP`,
      { as: 'a' },
    );
    const totals = summary.body && summary.body.totals;
    check(
      'GET budget-summary: activity cost + food + transport in the source currency',
      summary.status === 200 &&
        totals.categories.activities === 450 &&
        totals.categories.food === 250 &&
        totals.transport === 300 &&
        totals.grandTotal === 1000,
      show(summary),
    );

    const converted = await call(
      'GET',
      `/itineraries/${itineraryId}/budget-summary?currency=USD`,
      { as: 'a' },
    );

    if (fxUnavailable(converted)) {
      skip('GET budget-summary?currency=USD converts once', FX_REASON);
    } else {
      check(
        'GET budget-summary?currency=USD converts once',
        converted.status === 200 && typeof converted.body.totals.grandTotal === 'number',
        show({
          status: converted.status,
          body: { currency: converted.body?.currency, rateSource: converted.body?.rateSource },
        }),
      );
    }

    const badCurrency = await call(
      'GET',
      `/itineraries/${itineraryId}/budget-summary?currency=XYZ`,
      { as: 'a' },
    );
    check('GET budget-summary with an unsupported currency -> 400', badCurrency.status === 400, show(badCurrency));

    /* ------------------------------------------------------ per-entry currency */
    const usdBudget = await call('POST', `/itineraries/${itineraryId}/days/${orderedIds[0]}/budgets`, {
      as: 'a',
      body: { category: 'food', amount: 10, currency: 'usd' },
    });
    check(
      'POST budget in USD stores the currency uppercased',
      usdBudget.status === 201 && usdBudget.body.currency === 'USD' && usdBudget.body.amount === 10,
      show(usdBudget),
    );

    const unsupportedEntryCurrency = await call(
      'POST',
      `/itineraries/${itineraryId}/days/${orderedIds[0]}/budgets`,
      { as: 'a', body: { category: 'food', amount: 10, currency: 'CHF' } },
    );
    check(
      'POST budget with a currency the dataset cannot serve -> 400',
      unsupportedEntryCurrency.status === 400,
      show(unsupportedEntryCurrency),
    );

    const usdTransport = await call('POST', `/itineraries/${itineraryId}/transport-costs`, {
      as: 'a',
      body: {
        mode: 'flight',
        fromCityId: egCity.city_id,
        toCityId: aeCity.city_id,
        amount: 5,
        currency: 'USD',
      },
    });
    check(
      'POST transport cost in USD stores the currency',
      usdTransport.status === 201 && usdTransport.body.currency === 'USD',
      show(usdTransport),
    );

    const mixedSummary = await call(
      'GET',
      `/itineraries/${itineraryId}/budget-summary?currency=EGP`,
      { as: 'a' },
    );
    const usdRow =
      mixedSummary.body?.transportCosts?.find((cost) => cost.currency === 'USD');

    if (fxUnavailable(mixedSummary)) {
      skip('GET budget-summary converts a foreign entry into the itinerary currency', FX_REASON);
    } else {
      check(
        'GET budget-summary converts a foreign entry into the itinerary currency',
        mixedSummary.status === 200 &&
          mixedSummary.body.totals.categories.food > 250 &&
          mixedSummary.body.totals.transport > 300 &&
          usdRow !== undefined &&
          usdRow.amount === 5 &&
          usdRow.convertedAmount > 5,
        show({
          status: mixedSummary.status,
          body: {
            food: mixedSummary.body?.totals?.categories?.food,
            transport: mixedSummary.body?.totals?.transport,
            usdRow,
          },
        }),
      );
    }

    /* ------------------------------- currencies the country list does not carry */
    // Phase C proof: a code that only SUPPORTED_CURRENCIES can supply.
    const cadSummary = await call(
      'GET',
      `/itineraries/${itineraryId}/budget-summary?currency=CAD`,
      { as: 'a' },
    );

    if (fxUnavailable(cadSummary)) {
      skip('GET budget-summary?currency=CAD', FX_REASON);
    } else {
      check(
        'GET budget-summary?currency=CAD answers 200 with a CAD total',
        cadSummary.status === 200 && cadSummary.body.currency === 'CAD',
        show(cadSummary),
      );
    }

    const cadProfile = await call('PATCH', '/users/me', {
      as: 'a',
      body: { preferredCurrency: 'CAD' },
    });
    check(
      'PATCH /users/me preferredCurrency=CAD -> 200',
      cadProfile.status === 200 &&
        cadProfile.body.user?.preferredCurrency === 'CAD',
      show(cadProfile),
    );

    const preferredSummary = await call(
      'GET',
      `/itineraries/${itineraryId}/budget-summary`,
      { as: 'a' },
    );

    if (fxUnavailable(preferredSummary)) {
      skip('a CAD profile preference produces a CAD summary', FX_REASON);
    } else {
      check(
        'a CAD profile preference produces a CAD summary, not a silent fallback',
        preferredSummary.status === 200 && preferredSummary.body.currency === 'CAD',
        show({
          status: preferredSummary.status,
          body: {
            currency: preferredSummary.body?.currency,
            grandTotal: preferredSummary.body?.totals?.grandTotal,
          },
        }),
      );
    }

    await call('PATCH', '/users/me', { as: 'a', body: { preferredCurrency: 'USD' } });

    /* ------------------------------------------------------------ currency */
    const conversion = await call('GET', '/currency/convert?amount=100&from=EGP&to=USD');

    if (conversion.status === 503) {
      skip('GET /currency/convert (guest)', FX_REASON);
    } else {
      check(
        'GET /currency/convert (guest)',
        conversion.status === 200 && typeof conversion.body.convertedAmount === 'number',
        show(conversion),
      );
    }

    /* -------------------------------------------------------------- hotels */
    const hotels = await call('GET', `/itineraries/${itineraryId}/hotels?guests=2`, {
      as: 'a',
    });
    check(
      'GET hotels: one stay per city group, honest availability',
      hotels.status === 200 &&
        hotels.body.groups.length === 2 &&
        hotels.body.groups[0].checkIn === B &&
        hotels.body.groups[0].checkOut === addDays(B, 1) &&
        hotels.body.groups[1].checkIn === addDays(B, 1) &&
        hotels.body.groups[1].checkOut === addDays(B, 3) &&
        typeof hotels.body.available === 'boolean',
      show(hotels),
    );

    if (hotels.status === 200 && hotels.body.available === false) {
      finding(
        'member 3',
        'hotel search returns no provider',
        `Every stay answers available=false with reason "${hotels.body.groups?.[0]?.reason ?? hotels.body.reason}". Expected until the hotel module lands.`,
      );
    }

    const twoRooms = await call('GET', `/itineraries/${itineraryId}/hotels?guests=2&rooms=2`, {
      as: 'a',
    });
    check(
      'GET hotels?rooms=2 echoes the room count per group and at the top level',
      twoRooms.status === 200 &&
        twoRooms.body.rooms === 2 &&
        twoRooms.body.groups.every((group) => group.rooms === 2),
      show(twoRooms),
    );

    const tooManyRooms = await call(
      'GET',
      `/itineraries/${itineraryId}/hotels?guests=2&rooms=11`,
      { as: 'a' },
    );
    check('GET hotels?rooms=11 -> 400', tooManyRooms.status === 400, show(tooManyRooms));

    /* ------------------------------------------------------------- flights */
    const flightsLegs = await call(
      'GET',
      `/itineraries/${itineraryId}/flights?passengers=2`,
      { as: 'a' },
    );
    check(
      'GET flights (legs): one leg from the first city to the second',
      flightsLegs.status === 200 &&
        flightsLegs.body.mode === 'legs' &&
        flightsLegs.body.legs.length === 1 &&
        flightsLegs.body.legs[0].fromCity.id === aeCity.city_id &&
        flightsLegs.body.legs[0].toCity.id === egCity.city_id &&
        Array.isArray(flightsLegs.body.legs[0].options),
      show(flightsLegs),
    );

    // ITN-26: the flight date comes from the data, never from a literal.
    const days = (await call('GET', `/itineraries/${itineraryId}`, { as: 'a' })).body?.days ?? [];
    const firstDayCity = days[0]?.cityId;
    const cityIds = [...new Set(days.map((day) => day.cityId))].filter(
      (cityId) => cityId !== firstDayCity,
    );
    const arrivalAirports = (
      await connection.db
        .collection('airports')
        .find({ city_id: firstDayCity }, { projection: { iata_code: 1, time_zone: 1 } })
        .toArray()
    ).map((airport) => airport.iata_code);
    const departureAirports = (
      await connection.db
        .collection('airports')
        .find({ city_id: { $in: cityIds } }, { projection: { iata_code: 1, time_zone: 1 } })
        .toArray()
    );
    const now = new Date();
    const candidates = (
      await connection.db
        .collection('flights')
        .find({
          status: 'Scheduled',
          departureAirport: { $in: departureAirports.map((airport) => airport.iata_code) },
          arrivalAirport: { $in: arrivalAirports },
          departureTimeUtc: { $gte: now },
        })
        .toArray()
    ).sort((left, right) => left.departureTimeUtc - right.departureTimeUtc);

    const allFlights = await connection.db.collection('flights').find({}).toArray();
    const flightById = new Map(allFlights.map((flight) => [String(flight._id), flight]));

    if (candidates.length === 0) {
      skip(
        'the five flight checks anchored on a real departure date',
        'no Scheduled flight on or after today from the itinerary cities to the first-day city',
      );
    } else {
      const chosen = candidates[0];
      const originAirport = chosen.departureAirport;
      const originZone = departureAirports.find(
        (airport) => airport.iata_code === originAirport,
      )?.time_zone;
      const F = localDate(chosen.departureTimeUtc, originZone);

      console.log(
        `flights  anchor ${originAirport} -> ${arrivalAirports.join('/')} on ${F} (${chosen.flightNumber})`,
      );

      const moved = await call('PATCH', `/itineraries/${itineraryId}`, {
        as: 'a',
        body: { startDate: F },
      });
      check(
        `PATCH the start date to the flight date ${F}`,
        moved.status === 200 && moved.body.startDate === F,
        show(moved),
      );

      const movedDetail = await call('GET', `/itineraries/${itineraryId}`, { as: 'a' });
      check(
        'every day date follows the new start date',
        movedDetail.status === 200 &&
          movedDetail.body.days[0].date === F &&
          movedDetail.body.days[2].date === addDays(F, 2),
        show({ status: movedDetail.status, body: { dates: movedDetail.body?.days?.map((day) => day.date) } }),
      );

      const oneWay = await call(
        'GET',
        `/itineraries/${itineraryId}/flights?passengers=2&originAirport=${originAirport}&tripType=one-way`,
        { as: 'a' },
      );
      const oneWayOptions = oneWay.body?.outbound ?? [];

      console.log(
        `flights  one-way ${originAirport}: ${oneWayOptions
          .map((option) => `${option.flightNumber}@${option.departureTimeUtc}`)
          .join(', ') || 'nothing'}`,
      );

      check(
        'GET flights?originAirport&tripType=one-way is structurally sound',
        oneWay.status === 200 &&
          oneWay.body.mode === 'origin' &&
          oneWay.body.tripType === 'one-way' &&
          oneWay.body.departureDate === F &&
          oneWay.body.returnDate === null &&
          Array.isArray(oneWay.body.destination?.airports) &&
          oneWay.body.available === (oneWayOptions.length > 0) &&
          oneWayOptions.every(
            (option) =>
              option.flightNumber &&
              option.price > 0 &&
              option.totalPrice === option.price * 2,
          ),
        show(oneWay),
      );

      // Anything off-date or not Scheduled is Member 2's filter, not a red check.
      for (const option of oneWayOptions) {
        const flight = flightById.get(option.flightId);

        if (!flight) {
          finding(
            'member 2',
            'the origin search returned a flight id that is not in the database',
            JSON.stringify(option),
          );
          continue;
        }

        const departure = localDate(
          flight.departureTimeUtc,
          departureAirports.find((airport) => airport.iata_code === flight.departureAirport)
            ?.time_zone,
        );

        if (flight.status !== 'Scheduled' || departure !== F) {
          finding(
            'member 2',
            `the origin search for ${F} returned ${flight.flightNumber} (${flight.status}) departing ${departure}`,
            JSON.stringify({
              request: `${originAirport}->${arrivalAirports.join('/')} on ${F}`,
              response: option,
            }),
          );
        }
      }

      const badAirport = await call(
        'GET',
        `/itineraries/${itineraryId}/flights?originAirport=ZZZ`,
        { as: 'a' },
      );
      check('GET flights?originAirport=ZZZ -> 400', badAirport.status === 400, show(badAirport));

      const roundTrip = await call(
        'GET',
        `/itineraries/${itineraryId}/flights?passengers=2&originAirport=${originAirport}&tripType=round-trip&returnDate=${addDays(F, 2)}`,
        { as: 'a' },
      );
      const outbound = roundTrip.body?.outbound ?? [];
      const inbound = roundTrip.body?.inbound ?? [];

      check(
        'GET flights round-trip reports partial availability honestly',
        roundTrip.status === 200 &&
          roundTrip.body.tripType === 'round-trip' &&
          roundTrip.body.returnDate === addDays(F, 2) &&
          roundTrip.body.available === (outbound.length > 0 && inbound.length > 0) &&
          (roundTrip.body.available || typeof roundTrip.body.reason === 'string'),
        show({
          status: roundTrip.status,
          body: {
            available: roundTrip.body?.available,
            reason: roundTrip.body?.reason,
            outbound: outbound.length,
            inbound: inbound.length,
          },
        }),
      );
    }

    /* ----------------------------------------------------------- ownership */
    const foreignDetail = await call('GET', `/itineraries/${itineraryId}`, { as: 'b' });
    check('GET another user itinerary -> 403', foreignDetail.status === 403, show(foreignDetail));

    const foreignEdit = await call('PATCH', `/itineraries/${itineraryId}`, {
      as: 'b',
      body: { title: 'stolen' },
    });
    check('PATCH another user itinerary -> 403', foreignEdit.status === 403, show(foreignEdit));

    const foreignBudgetDelete = await call('DELETE', `/budgets/${budget.body?.id}`, {
      as: 'b',
    });
    check('DELETE budget of another user -> 403', foreignBudgetDelete.status === 403, show(foreignBudgetDelete));

    /* --------------------------------------------- public search and detail */
    const published = await call('PATCH', `/itineraries/${itineraryId}`, {
      as: 'a',
      body: { visibility: 'public' },
    });
    check(
      'PATCH visibility public',
      published.status === 200 && published.body.visibility === 'public',
      show(published),
    );

    const search = await call(
      'GET',
      `/itineraries/public/search?country=EG&q=${encodeURIComponent(egCity.name)}&sort=popular`,
    );
    check(
      'GET public search finds it as a guest',
      search.status === 200 && search.body.items.some((item) => item.id === itineraryId),
      show({ status: search.status, body: { total: search.body && search.body.total } }),
    );

    const publicDetail = await call('GET', `/itineraries/public/${itineraryId}`);
    check(
      'GET public detail as a guest, with its budget',
      publicDetail.status === 200 &&
        publicDetail.body.days.length === 3 &&
        publicDetail.body.author !== undefined &&
        publicDetail.body.budget !== undefined &&
        publicDetail.body.budget.grandTotal >= 0 &&
        publicDetail.body.totals === undefined,
      show(publicDetail),
    );

    const clone = await call('POST', `/itineraries/${itineraryId}/clone`, {
      as: 'b',
      body: { title: 'B copy' },
    });
    check(
      'POST clone as the second user -> 201, private, new id',
      clone.status === 201 &&
        clone.body.id !== itineraryId &&
        clone.body.visibility === 'private' &&
        clone.body.clonedFrom !== undefined,
      show(clone),
    );

    const originalAfterClone = await call('GET', `/itineraries/${itineraryId}`, { as: 'a' });
    check(
      'source cloneCount incremented',
      originalAfterClone.status === 200 && originalAfterClone.body.cloneCount === 1,
      show({ status: originalAfterClone.status, body: { cloneCount: originalAfterClone.body?.cloneCount } }),
    );

    const cloneDetail = await call('GET', `/itineraries/${clone.body?.id}`, { as: 'b' });
    check(
      'clone is an independent copy with its own day ids',
      cloneDetail.status === 200 &&
        cloneDetail.body.days[0].id !== orderedFirst?.id &&
        cloneDetail.body.days.length === 3,
      show({ status: cloneDetail.status, body: { days: cloneDetail.body?.days?.length } }),
    );

    const privateDetail = await call('GET', `/itineraries/public/${clone.body?.id}`);
    check('GET public detail of a private copy -> 404', privateDetail.status === 404, show(privateDetail));

    /* ---------------------------------------------------------------- CSRF */
    const noCsrf = await call('POST', '/itineraries', {
      as: 'a',
      csrf: false,
      body: { title: 'No CSRF', countries: ['EG'], startDate: B },
    });
    check(
      'POST without x-csrf-token -> 401',
      noCsrf.status === 401,
      show(noCsrf),
    );

    /* ------------------------------------------------------------ deletion */
    const removedCost = await call('DELETE', `/transport-costs/${transport.body?.id}`, {
      as: 'a',
    });
    check('DELETE transport cost -> 200', removedCost.status === 200, show(removedCost));

    const removedClone = await call('DELETE', `/itineraries/${clone.body?.id}`, { as: 'b' });
    check('DELETE the clone -> 204', removedClone.status === 204, show(removedClone));

    const removedDay = await call(
      'DELETE',
      `/itineraries/${itineraryId}/days/${orderedIds[2]}`,
      { as: 'a' },
    );
    check('DELETE a day -> 200', removedDay.status === 200, show(removedDay));

    const afterDayDelete = await call('GET', `/itineraries/${itineraryId}`, { as: 'a' });
    check(
      'remaining days renumbered 1..n',
      afterDayDelete.status === 200 &&
        afterDayDelete.body.days.length === 2 &&
        afterDayDelete.body.days[1].dayNumber === 2,
      show({
        status: afterDayDelete.status,
        body: { days: afterDayDelete.body?.days?.map((day) => [day.dayNumber, day.date, day.cityId]) },
      }),
    );

    const removedItinerary = await call('DELETE', `/itineraries/${itineraryId}`, { as: 'a' });
    check('DELETE the itinerary -> 204', removedItinerary.status === 204, show(removedItinerary));

    const gone = await call('GET', `/itineraries/${itineraryId}`, { as: 'a' });
    check('GET a deleted itinerary -> 404', gone.status === 404, show(gone));

    completed = true;
  } finally {
    await app.close();

    // Third assertion, immediately before anything could be dropped.
    assertUriTarget('before the drop');

    if (completed && failed === 0 && !keepDatabase) {
      const dropped = await dropScratchDatabase();

      if (dropped === 'gone') {
        console.log(`\ndrop    ${SCRATCH_DB} dropped and confirmed gone on a fresh connection`);
      } else {
        console.log(`\ndrop    ${SCRATCH_DB} could not be confirmed gone: ${dropped}`);
      }
    } else {
      const why = !completed
        ? 'the run did not finish'
        : failed > 0
          ? `${failed} failed check(s)`
          : '--keep';

      console.log(`\nkeep    ${SCRATCH_DB} kept (${why})`);
      console.log(`keep    accounts: ${ACCOUNTS.a.email}, ${ACCOUNTS.b.email}`);
    }

    report();
  }
}

async function dropScratchDatabase() {
  const connection = await mongoose
    .createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
    .asPromise();

  try {
    await connection.db.dropDatabase();
  } finally {
    await connection.close();
  }

  const fresh = await mongoose
    .createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
    .asPromise();

  try {
    const remaining = await fresh.db.listCollections().toArray();

    return remaining.length === 0 ? 'gone' : `${remaining.length} collection(s) remain`;
  } finally {
    await fresh.close();
  }
}

/** One summary block: counts, then every skip with its reason, then findings. */
function report() {
  console.log(
    `\n${passed} passed, ${failed} failed, ${skipped} skipped (${passed + failed + skipped} checks)`,
  );

  if (skipLines.length > 0) {
    console.log('\nskips:');
    for (const line of skipLines) {
      console.log(`  ${line}`);
    }
  }

  if (findings.length > 0) {
    console.log('\nfindings:');
    for (const entry of findings) {
      console.log(`  [${entry.owner}] ${entry.title}`);
      if (entry.detail) {
        console.log(
          entry.detail
            .split('\n')
            .map((line) => `      ${line}`)
            .join('\n'),
        );
      }
    }
  }

  for (const note of notes) {
    console.log(`  note: ${note}`);
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\nverification aborted:', error);
  process.exitCode = 1;
});
