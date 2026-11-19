/* eslint-disable */
// Milestone 1 black-box API verification harness.
//
// Starts the BUILT backend (dist/main.js) against a private in-memory MongoDB
// replica set, seeds the official reference data, and exercises the REST API
// over HTTP exactly as Swagger UI would. Real Stripe TEST-mode PaymentIntents
// and refunds are used; Stripe webhooks are delivered to the backend signed
// with a harness-only secret. Nothing touches the shared Atlas database.
//
// Usage (from backend/): npm run build && node test/qa/harness.cjs
// Needs STRIPE_SECRET_KEY (sk_test_...) in backend/.env. Writes
// test/qa/results.json.
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const Stripe = require('stripe');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 3100;
const BASE = `http://localhost:${PORT}/api`;
const WEBHOOK_SECRET = 'whsec_harness_' + crypto.randomBytes(12).toString('hex');
const ADMIN = { email: 'qa-admin@travel.test', password: 'AdminPass123!' };

const dotenv = Object.fromEntries(
  (fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '')
    .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || dotenv.STRIPE_SECRET_KEY;
if (!/^(sk|rk)_test_/.test(STRIPE_KEY || '')) {
  console.error('A Stripe TEST key (sk_test_...) is required in backend/.env');
  process.exit(2);
}
const stripe = new Stripe(STRIPE_KEY);

// ---------------------------------------------------------------- results
const results = [];
let section = 'setup';
function check(req, endpoint, test, expected, actual, pass, note = '') {
  results.push({ section, req, endpoint, test, expected: String(expected), actual: String(actual), pass: !!pass, note });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`${mark} [${req}] ${endpoint} - ${test} (expected ${expected}, got ${actual})${pass ? '' : note ? ' :: ' + note : ''}`);
  return !!pass;
}
const expectStatus = (req, method, url, test, res, expected) => {
  const ok = Array.isArray(expected) ? expected.includes(res.status) : res.status === expected;
  return check(req, `${method} ${url.replace(/[0-9a-f]{24}/g, ':id')}`, test, expected, res.status, ok,
    ok ? '' : JSON.stringify(res.body).slice(0, 300));
};

// ---------------------------------------------------------------- http client
class Client {
  constructor(name) { this.name = name; this.jar = {}; }
  get csrf() { return this.jar.csrf_token; }
  async raw(method, url, body, { headers = {}, rawBody } = {}) {
    const h = { ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    if (this.csrf && method !== 'GET' && !('x-csrf-token' in h)) h['x-csrf-token'] = this.csrf;
    let payload = rawBody;
    if (body !== undefined && rawBody === undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers: h, body: payload });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(';'); const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(attrs.join(';')) || value === '') delete this.jar[name];
      else this.jar[name] = value;
      this.lastSetCookie = (this.lastSetCookie || []).concat(c);
    }
    const ct = res.headers.get('content-type') || '';
    let data;
    if (ct.includes('json')) { try { data = await res.json(); } catch { data = null; } }
    else { const buf = Buffer.from(await res.arrayBuffer()); data = ct.includes('text') ? buf.toString('utf8') : buf; }
    return { status: res.status, body: data, headers: res.headers, contentType: ct };
  }
  get(u) { return this.raw('GET', u); }
  post(u, b) { return this.raw('POST', u, b ?? {}); }
  patch(u, b) { return this.raw('PATCH', u, b ?? {}); }
  put(u, b) { return this.raw('PUT', u, b ?? {}); }
  del(u, b) { return this.raw('DELETE', u, b); }
}
const guest = new Client('guest');

function idOf(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (typeof body._id === 'string') return body._id;
  if (typeof body.id === 'string') return body.id;
  for (const k of ['data', 'booking', 'user', 'hotel', 'room', 'itinerary', 'post', 'comment', 'review', 'day', 'activity', 'budget', 'cost', 'transportCost', 'flight', 'airline', 'report', 'reservation', 'item']) {
    const v = idOf(body[k]);
    if (v) return v;
  }
  return undefined;
}
const items = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? b?.results ?? b?.bookings ?? b?.flights ?? b?.hotels ?? b?.posts ?? b?.accounts ?? b?.users ?? b?.notifications ?? []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoDate = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d; };

async function register(name, email, password = 'Start123!') {
  return guest.post('/auth/register', { name, email, password, acceptedTerms: true, acceptedPrivacyPolicy: true });
}
async function login(client, email, password) {
  client.jar = {};
  return client.post('/auth/login', { email, password });
}
async function newUser(db, label, { verified = true } = {}) {
  const email = `${label}-${crypto.randomBytes(3).toString('hex')}@travel.test`;
  await register(label, email);
  if (verified) await db.collection('users').updateOne({ email }, { $set: { emailVerified: true } });
  const c = new Client(label);
  const r = await login(c, email, 'Start123!');
  c.email = email; c.id = idOf(r.body?.user) || idOf(r.body);
  return c;
}

// ---------------------------------------------------------------- stripe
async function payWithTestCard(client, bookingType, bookingId, { card = 'pm_card_visa' } = {}) {
  const pay = await client.post('/payments', { bookingType, bookingId });
  if (pay.status !== 201) return { pay };
  const piId = pay.body.clientSecret.split('_secret_')[0];
  let pi;
  try {
    pi = await stripe.paymentIntents.confirm(piId, { payment_method: card, return_url: 'http://localhost/return' });
  } catch (e) { pi = await stripe.paymentIntents.retrieve(piId); }
  return { pay, pi };
}
function signedEvent(type, object, id = 'evt_qa_' + crypto.randomBytes(8).toString('hex')) {
  const payload = JSON.stringify({ id, object: 'event', type, api_version: '2024-06-20', created: Math.floor(Date.now() / 1000), data: { object }, livemode: false, pending_webhooks: 1, request: { id: null } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header, id };
}
async function deliver(type, object, id) {
  const e = signedEvent(type, object, id);
  const res = await guest.raw('POST', '/payments/webhook', undefined, { rawBody: e.payload, headers: { 'stripe-signature': e.header, 'content-type': 'application/json' } });
  return { res, id: e.id, payload: e.payload, header: e.header };
}
async function deliverPaymentSucceeded(pi) {
  const fresh = await stripe.paymentIntents.retrieve(pi.id);
  return deliver('payment_intent.succeeded', fresh);
}

// ---------------------------------------------------------------- boot
async function boot() {
  const mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1 } });
  const uri = mongo.getUri('qa_milestone1');
  const env = {
    ...process.env, MONGODB_URI: uri, PORT: String(PORT), NODE_ENV: 'test',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ADMIN_NAME: 'QA Admin',
    SUPPORTED_CURRENCIES: 'USD,EUR,EGP,GBP,AED', PLATFORM_CURRENCY: 'USD',
    ENABLE_DEV_PAYMENT_ENDPOINTS: 'false', SMTP_HOST: '',
    INTERNAL_API_KEY: 'qa-internal-key-0123456789',
  };
  // Same entry point as `npm run seed` (reads the CSVs next to src/database/seeds).
  const seed = spawn(process.execPath, ['-r', 'ts-node/register', path.join(ROOT, 'src/database/seeds/seed.ts')], { env: { ...env, TS_NODE_TRANSPILE_ONLY: 'true' }, cwd: ROOT });
  let seedOut = ''; seed.stdout.on('data', (d) => (seedOut += d)); seed.stderr.on('data', (d) => (seedOut += d));
  const seedCode = await new Promise((r) => seed.on('exit', r));
  if (seedCode !== 0) throw new Error('seed failed: ' + seedOut);
  const app = spawn(process.execPath, [path.join(ROOT, 'dist/main.js')], { env, cwd: ROOT });
  let appLog = ''; app.stdout.on('data', (d) => (appLog += d)); app.stderr.on('data', (d) => (appLog += d));
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/api-json`); if (r.ok) break; } catch {}
    if (app.exitCode !== null) throw new Error('app exited: ' + appLog.slice(-2000));
    await sleep(500);
  }
  const client = await MongoClient.connect(uri);
  return { mongo, app, db: client.db(), client, seedOut, appLogRef: () => appLog };
}

module.exports = {
  ROOT, BASE, ADMIN, Client, guest, check, expectStatus, idOf, items, sleep, isoDate, daysFromNow,
  register, login, newUser, payWithTestCard, deliver, deliverPaymentSucceeded, signedEvent, stripe, ObjectId,
  setSection: (s) => { section = s; console.log(`\n=== ${s} ===`); }, results, boot,
};
