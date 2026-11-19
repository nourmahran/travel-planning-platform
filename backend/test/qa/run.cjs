/* eslint-disable */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./harness.cjs');
const { Client, guest, check, expectStatus: st, idOf, items, sleep, isoDate, daysFromNow, newUser, login, register, ADMIN, ObjectId } = H;

const ctx = {};
const sections = [
  require('./sections/01-accounts.cjs'),
  require('./sections/02-admin-airlines-flights.cjs'),
  require('./sections/03-flight-bookings-payments.cjs'),
  require('./sections/04-hotels.cjs'),
  require('./sections/05-itineraries.cjs'),
  require('./sections/06-blog-community.cjs'),
  require('./sections/07-concurrency.cjs'),
  require('./sections/08-swagger.cjs'),
];
const only = process.argv.slice(2);

(async () => {
  const env = await H.boot();
  ctx.db = env.db;
  ctx.appLog = env.appLogRef;
  console.log('backend started on isolated MongoDB');
  try {
    for (const s of sections) {
      if (only.length && !only.some((o) => s.name.includes(o))) continue;
      H.setSection(s.name);
      try { await s.run(ctx, H); }
      catch (e) { check('-', s.name, 'section crashed', 'no crash', e.message, false, e.stack?.split('\n').slice(0, 4).join(' | ')); }
    }
  } finally {
    const pass = H.results.filter((r) => r.pass).length;
    const out = path.join(__dirname, 'results.json');
    fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), total: H.results.length, pass, fail: H.results.length - pass, results: H.results }, null, 1));
    fs.writeFileSync(path.join(__dirname, 'app.log'), env.appLogRef().replace(/\x1b\[[0-9;]*m/g, ''));
    console.log(`\nTOTAL ${H.results.length}  PASS ${pass}  FAIL ${H.results.length - pass}`);
    env.app.kill(); await env.client.close(); await env.mongo.stop();
    process.exit(0);
  }
})();
