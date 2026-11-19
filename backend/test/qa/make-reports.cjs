/* eslint-disable */
// Builds the QA reports in docs/qa/ from test/qa/results.json (harness output),
// test/qa/requirements-index.json (from the official workbook) and the
// recorded jest/build results passed on the command line.
//
// Usage: node test/qa/make-reports.cjs '<json with jest/build/lint summary>'
'use strict';
const fs = require('fs');
const path = require('path');

const here = __dirname;
const out = path.resolve(here, '..', '..', '..', 'docs', 'qa');
fs.mkdirSync(out, { recursive: true });
const run = JSON.parse(fs.readFileSync(path.join(here, 'results.json'), 'utf8'));
const reqs = JSON.parse(fs.readFileSync(path.join(here, 'requirements-index.json'), 'utf8'));
const extra = JSON.parse(process.argv[2] || '{}');
const results = run.results;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

// Requirements whose acceptance criteria are user-interface behaviour (Milestone 2).
const FRONTEND = {
  'ACC-10': 'Redirect to login and back is a frontend flow; backend returns 401 for guests on restricted actions (verified).',
  'GEN-02': 'Field-level messages are frontend; backend returns per-field validation messages (verified 400 responses).',
  'GEN-03': 'Confirmation dialogs are frontend; backend requires confirm:true on deletes (verified).',
  'GEN-04': 'Empty states are frontend; backend returns empty lists (verified).',
  'GEN-14': 'User interface (Milestone 2).', 'GEN-15': 'User interface (Milestone 2).',
  'GEN-16': 'User interface (Milestone 2).', 'GEN-17': 'User interface (Milestone 2).',
};
// Verified gaps and deviations that remain (honest status, not hidden).
const PARTIAL = {
  'GEN-11': 'Lifecycle is enforced, but hotel reservations name the states HELD/CONFIRMED/COMPLETED/EXPIRED/CANCELLED instead of "Pending Payment" etc., and both modules also allow cancelling an unpaid hold (an extra Pending -> Cancelled transition).',
  'HTL-04': 'Rooms are bookable by default and moderators block date ranges (HTL-06); explicit "bookable date ranges" are not modelled as such.',
  'ACC-19': 'Cookies are httpOnly and SameSite=Lax; the Secure flag is set only when NODE_ENV=production (local http testing).',
  'HTL-01': 'Hotel city/country are free text; they are not validated against the seeded city list (GEN-12).',
};
const BONUS_NOTES = {
  'ACC-02': 'Verification link on registration (hashed, single-use, 24 h); booking (flight hold/booking, hotel reservation) blocked until verified; resend endpoint. Real SMTP delivery not tested here (no SMTP server configured); emails captured in tests.',
  'ACC-07': 'Reset link + code by email, 30 min, single-use, invalidated by a newer request, same reply for unknown emails, clears lockout and revokes sessions.',
  'GEN-01-B': 'Outbox job emails each new in-app notification once (per-user opt-out) and moderator invitations (temporary password never emailed). Uses the SMTP server from .env; a development test inbox (Ethereal/Mailtrap) must be configured to see real emails.',
  'FLT-27': 'Same-route change with Stripe payment of a higher fare (bookingType flight_change) or refund of a lower fare; verified end to end with Stripe test mode.',
  'FLT-28': 'Numbered seat map and PATCH seat; concurrent picks serialised.',
  'HTL-26': 'Hotel moderator reply on reviews of their own hotel.',
  'ITN-27': 'Link confirmed flight/hotel bookings to itinerary days; amounts feed the budget.',
  'ITN-28': 'PDF export of an itinerary.',
  'BLG-13': 'Attach / detach an own public itinerary to a post.',
  'BON-01': 'Admin analytics of bookings and verified revenue per provider for a period.',
  'BON-02': 'Favourites for active hotels and public itineraries.',
};

const byReq = {};
for (const r of results) for (const id of String(r.req).split(/[ ,/]+/)) (byReq[id] ??= []).push(r);
const statusOf = (q) => {
  const checks = byReq[q.id] || [];
  const pass = checks.filter((c) => c.pass).length, fail = checks.length - pass;
  if (FRONTEND[q.id]) return { status: 'Frontend (Milestone 2)', pass, fail, note: FRONTEND[q.id] };
  if (fail) return { status: 'FAILING', pass, fail, note: checks.filter((c) => !c.pass).map((c) => c.test).join('; ') };
  if (PARTIAL[q.id]) return { status: 'Partial', pass, fail, note: PARTIAL[q.id] };
  if (!checks.length) return { status: 'Not black-box tested', pass, fail, note: '' };
  return { status: 'Verified', pass, fail, note: BONUS_NOTES[q.id] || '' };
};
const rows = reqs.map((q) => ({ ...q, ...statusOf(q) }));
const count = (kind, st) => rows.filter((r) => r.kind === kind && (st ? r.status === st : true)).length;
const passTotal = results.filter((r) => r.pass).length;
const now = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// ---------------------------------------------------------------- 1
let md = `# Requirements audit\n\nGenerated ${now} from the official workbook (\`Final_ SP1_Reviewed_Requirements.xlsx\`, ${count('Mandatory')} mandatory + ${count('Bonus')} bonus rows) and the black-box API run in \`backend/test/qa\` (${run.total} checks, ${passTotal} passed).\n\n`;
md += `**Status meanings.** *Verified*: every black-box check for the requirement passed against the running backend. *Partial*: works, with the documented gap. *Frontend (Milestone 2)*: user-interface behaviour; the backend part is noted. *Not black-box tested*: implemented, covered only by unit tests or not exercised over HTTP.\n\n`;
for (const kind of ['Mandatory', 'Bonus']) {
  md += `## ${kind} (${count(kind)})\n\n| ID | Module | Requirement (first sentence) | Status | Checks passed | Notes |\n|---|---|---|---|---|---|\n`;
  for (const r of rows.filter((x) => x.kind === kind)) md += `| ${r.id} | ${esc(r.module)} | ${esc(r.summary)} | ${r.status} | ${r.pass}/${r.pass + r.fail} | ${esc(r.note)} |\n`;
  md += '\n';
}
fs.writeFileSync(path.join(out, 'REQUIREMENTS_AUDIT.md'), md);

// ---------------------------------------------------------------- 2
md = `# Swagger / API test report\n\nGenerated ${now}. Every row is a real HTTP request against the built backend (\`node dist/main.js\`) on an isolated in-memory MongoDB replica set seeded with the repository's reference data, using Stripe **test mode** (real PaymentIntents and refunds; webhooks delivered with a valid Stripe signature). Reproduce with:\n\n\`\`\`bash\ncd backend\nnpm run build\nnode test/qa/run.cjs\n\`\`\`\n\n**Result: ${passTotal} / ${run.total} checks passed.**\n\n`;
const sections = [...new Set(results.map((r) => r.section))];
md += '| Section | Passed | Total |\n|---|---|---|\n' + sections.map((s) => { const x = results.filter((r) => r.section === s); return `| ${s} | ${x.filter((r) => r.pass).length} | ${x.length} |`; }).join('\n') + '\n\n';
for (const s of sections) {
  md += `## ${s}\n\n| Endpoint | Requirement | Test | Expected | Actual | Result |\n|---|---|---|---|---|---|\n`;
  for (const r of results.filter((x) => x.section === s)) md += `| ${esc(r.endpoint)} | ${esc(r.req)} | ${esc(r.test)} | ${esc(r.expected)} | ${esc(r.actual).slice(0, 80)} | ${r.pass ? 'PASS' : '**FAIL**'} |\n`;
  md += '\n';
}
fs.writeFileSync(path.join(out, 'SWAGGER_TEST_REPORT.md'), md);

// ---------------------------------------------------------------- 3
md = `# Bonus completion report\n\nGenerated ${now}.\n\n| ID | Bonus | Status | Checks passed | Implementation and evidence |\n|---|---|---|---|---|\n`;
for (const r of rows.filter((x) => x.kind === 'Bonus')) md += `| ${r.id} | ${esc(r.summary)} | ${r.status} | ${r.pass}/${r.pass + r.fail} | ${esc(BONUS_NOTES[r.id] || r.note)} |\n`;
md += `| Cloud deployment | Deploy frontend and backend to a cloud platform | **Not done** | - | Requires the Milestone 2 frontend; the PDF evaluates this bonus only on a fully working deployed frontend + backend. |\n\n`;
md += `## Remaining blockers\n\n- **Email delivery**: the email bonuses are implemented and tested with a captured mail transport. To demonstrate real delivery, set \`SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM\` in \`backend/.env\` to a development test inbox (e.g. Ethereal or Mailtrap). Without SMTP the email text is printed in the server log (development only).\n- **Cloud deployment**: needs the frontend (Milestone 2).\n`;
fs.writeFileSync(path.join(out, 'BONUS_COMPLETION_REPORT.md'), md);

// ---------------------------------------------------------------- 4
const sec = results.filter((r) => /GEN-13|ACC-19|ACC-05|ACC-06|ACC-11|GEN-08/.test(r.req));
md = `# Security audit\n\nGenerated ${now}. Black-box checks (${sec.filter((r) => r.pass).length}/${sec.length} passed) plus code review.\n\n## Findings fixed in this pass\n\n| Area | Finding | Fix |\n|---|---|---|\n`;
md += [
  ['Authorization (ACC-15)', 'Flights of a deactivated airline could still be booked through the hold endpoint (search hid them).', 'Booking creation now rejects outbound and return flights of inactive airlines.'],
  ['Audit (GEN-07)', 'Admin suspensions, reactivations, provider (de)activation, moderator creation and password resets were not audited.', 'Each admin action is written to the shared audit log.'],
  ['Injection', 'Admin account search passed user input into a MongoDB $regex unescaped (regex injection / ReDoS).', 'Input escaped with the shared escapeRegex helper; verified with ".", "(a+)+$".'],
  ['Booking gate (ACC-02)', 'Unverified accounts could book.', 'Global guard blocks booking routes until the email is verified.'],
  ['Error responses', 'Some date-validation errors returned 409 instead of 400.', 'Hotel calendar/block date validation returns 400.'],
].map((r) => `| ${r.join(' | ')} |`).join('\n') + '\n\n';
md += `## Verified controls\n\n| Control | Evidence |\n|---|---|\n` + [
  ['Password storage', 'bcrypt (12 rounds); hash never returned; checked in DB.'],
  ['Session cookies', 'Access/refresh tokens only in httpOnly, SameSite=Lax cookies; never in JSON bodies. Secure flag in production.'],
  ['CSRF', 'Double-submit token (csrf_token cookie + x-csrf-token header) required on every authenticated write; wrong header rejected.'],
  ['Session lifetime', '15-minute access token, refresh rotation, revocation on logout, 30-minute inactivity expiry, 5-attempt / 15-minute lockout.'],
  ['Roles and ownership', 'Guards verified for user, airline moderator, hotel moderator and admin on every module; cross-owner reads return 403/404.'],
  ['Input validation', 'Global ValidationPipe with whitelist + forbidNonWhitelisted; operator objects ({"$gt":""}) and unknown fields rejected; malformed JSON -> 400.'],
  ['Error leakage', 'Uniform error body {statusCode, message, timestamp, path}; no stack traces in responses.'],
  ['Uploads (GEN-08)', 'JPG/PNG only, checked by file signature (fake PNG rejected), 5 MB per image, 5 per post/activity; private itinerary images not served to others.'],
  ['Payments', 'Card data never reaches the backend (Stripe PaymentIntents); only payment id, amount, currency, status stored; webhook signature verified; duplicate and concurrent events processed once; test-mode key enforced (live keys refused).'],
  ['Internal endpoint', 'Hotel maintenance endpoint requires x-internal-api-key (constant-time compare).'],
  ['Secrets', '.env git-ignored; git history checked: no Stripe secret, webhook secret or MongoDB password was ever committed; .env.example lists every variable without values.'],
].map((r) => `| ${r.join(' | ')} |`).join('\n') + '\n\n';
md += `## Open items (not fixed)\n\n- No HTTP security headers middleware (e.g. helmet) and no global rate limiter; login is protected by the per-account lockout only.\n- Secure cookie flag depends on NODE_ENV=production.\n- The MongoDB connection string with password was shared in a public ChatGPT link earlier; rotating the database user's password is recommended.\n- Reference datasets: the repository's Countries/Cities/Airports/Attractions CSVs were seeded and used, but could not be compared with the official dataset link (not available offline).\n`;
fs.writeFileSync(path.join(out, 'SECURITY_AUDIT.md'), md);

// ---------------------------------------------------------------- 5
const mand = rows.filter((r) => r.kind === 'Mandatory');
const backendMand = mand.filter((r) => r.status !== 'Frontend (Milestone 2)');
const failing = rows.filter((r) => r.status === 'FAILING');
md = `# Final readiness report (Milestone 1 - Backend & API)\n\nGenerated ${now}.\n\n## Numbers\n\n| Item | Result |\n|---|---|\n`;
md += `| Mandatory requirements (workbook) | ${mand.length} |\n`;
md += `| - backend-verified | ${mand.filter((r) => r.status === 'Verified').length} |\n| - partial (documented gaps) | ${mand.filter((r) => r.status === 'Partial').length} |\n| - frontend only (Milestone 2) | ${mand.filter((r) => r.status.startsWith('Frontend')).length} |\n| - not black-box tested | ${mand.filter((r) => r.status === 'Not black-box tested').length} |\n| - failing | ${mand.filter((r) => r.status === 'FAILING').length} |\n`;
md += `| Bonus requirements verified | ${rows.filter((r) => r.kind === 'Bonus' && r.status === 'Verified').length} / ${count('Bonus')} (+ cloud deployment: not done) |\n`;
md += `| PDF section 8 endpoints documented in Swagger | ${results.filter((r) => r.test.startsWith('documented in Swagger') && r.pass).length} / ${results.filter((r) => r.test.startsWith('documented in Swagger')).length} |\n`;
md += `| Black-box API checks passed | ${passTotal} / ${run.total} |\n`;
for (const [k, v] of Object.entries(extra)) md += `| ${k} | ${v} |\n`;
md += `\n## Failing checks\n\n${results.filter((r) => !r.pass).map((r) => `- [${r.req}] ${r.endpoint} - ${r.test} (expected ${r.expected}, got ${r.actual})`).join('\n') || 'None.'}\n`;
md += `\n## Partial / unverified requirements\n\n${rows.filter((r) => ['Partial', 'Not black-box tested'].includes(r.status)).map((r) => `- **${r.id}** (${r.status}): ${r.note || 'implemented; no HTTP-level check in this run'}`).join('\n')}\n`;
md += `\n## Bugs found and fixed in this verification\n\n${(extra.__fixes || []).map((f) => `- ${f}`).join('\n')}\n`;
md += `\n## Verdict\n\n${failing.length === 0 ? 'All backend acceptance checks executed in this run pass. The remaining items are documented partial deviations, user-interface requirements that belong to Milestone 2, and bonuses that need external setup (SMTP inbox, cloud deployment).' : 'There are failing checks; see above.'}\n\n**${failing.length === 0 && passTotal === run.total ? 'READY FOR MILESTONE 1 SUBMISSION (backend)' : 'NOT READY'}** - the frontend and integration requirements are Milestone 2.\n`;
delete extra.__fixes;
fs.writeFileSync(path.join(out, 'FINAL_READINESS_REPORT.md'), md);
console.log('reports written to', out);
