/* eslint-disable */
'use strict';
module.exports = {
  name: '1. Authentication and accounts',
  async run(ctx, H) {
    const { Client, guest, check, expectStatus: st, idOf, login, register, ADMIN } = H;
    const db = ctx.db;
    const email = `traveler-${Date.now()}@travel.test`;

    // GEN-12 reference data seeded at setup
    for (const [coll, min] of [['countries', 8], ['cities', 8], ['airports', 8], ['attractions', 8]]) {
      const n = await db.collection(coll).countDocuments();
      check('GEN-12', `seed ${coll}`, `${coll} seeded from the reference CSV`, `>=${min}`, n, n >= min);
    }
    const cur = await db.collection('currencies').countDocuments() + await db.collection('supportedcurrencies').countDocuments() + await db.collection('supported_currencies').countDocuments();
    check('GEN-12', 'seed currencies', 'supported currencies seeded', '>=1', cur, cur >= 1);
    const cai = await db.collection('airports').findOne({ $or: [{ iata_code: 'CAI' }, { code: 'CAI' }, { iataCode: 'CAI' }] });
    check('GEN-12', 'seed airports', 'official identifiers kept (CAI, Africa/Cairo)', 'Africa/Cairo', cai?.time_zone ?? cai?.timeZone, (cai?.time_zone ?? cai?.timeZone) === 'Africa/Cairo');

    // ACC-01 register
    let r = await register('Traveler One', email);
    st('ACC-01', 'POST', '/auth/register', 'valid registration', r, 201);
    const u = await db.collection('users').findOne({ email });
    check('ACC-01', 'POST /auth/register', 'DB: user stored with role user', 'user', u?.role, u?.role === 'user');
    check('GEN-13', 'POST /auth/register', 'DB: password stored only as bcrypt hash', 'bcrypt hash, no plain field', u?.passwordHash?.slice(0, 4), /^\$2[aby]\$/.test(u?.passwordHash || '') && !('password' in (u || {})));
    check('ACC-01', 'POST /auth/register', 'response never contains password hash', 'absent', JSON.stringify(r.body).includes('passwordHash') ? 'present' : 'absent', !JSON.stringify(r.body).includes('passwordHash'));
    r = await register('Dup', email); st('ACC-01', 'POST', '/auth/register', 'duplicate email rejected', r, 409);
    r = await register('Dup', email.toUpperCase()); st('ACC-01', 'POST', '/auth/register', 'duplicate email, different case', r, 409);
    r = await guest.post('/auth/register', { name: 'X', email: 'bad-email', password: 'Start123!', acceptedTerms: true, acceptedPrivacyPolicy: true });
    st('ACC-01', 'POST', '/auth/register', 'invalid email', r, 400);
    for (const [pw, why] of [['short1', '< 8 chars'], ['allletters', 'no digit'], ['12345678', 'no letter']]) {
      r = await guest.post('/auth/register', { name: 'X', email: `pw-${why.length}${Date.now()}@travel.test`, password: pw, acceptedTerms: true, acceptedPrivacyPolicy: true });
      st('ACC-01', 'POST', '/auth/register', `weak password (${why})`, r, 400);
    }
    r = await guest.post('/auth/register', { name: 'X', email: `nc-${Date.now()}@travel.test`, password: 'Start123!', acceptedTerms: false, acceptedPrivacyPolicy: true });
    st('ACC-01', 'POST', '/auth/register', 'consent not given', r, 400);
    r = await guest.post('/auth/register', { email: `mf-${Date.now()}@travel.test`, password: 'Start123!' });
    st('ACC-01', 'POST', '/auth/register', 'missing required fields', r, 400);
    r = await guest.post('/auth/register', { name: 'X', email: `ex-${Date.now()}@travel.test`, password: 'Start123!', acceptedTerms: true, acceptedPrivacyPolicy: true, role: 'admin' });
    st('ACC-18', 'POST', '/auth/register', 'cannot self-register with role=admin (extra field rejected)', r, 400);
    r = await guest.post('/auth/register', { name: { $gt: '' }, email: { $ne: null }, password: 'Start123!', acceptedTerms: true, acceptedPrivacyPolicy: true });
    st('GEN-13', 'POST', '/auth/register', 'NoSQL operator objects rejected', r, 400);

    r = await guest.raw('POST', '/auth/register', undefined, { rawBody: '{"name": broken json', headers: { 'content-type': 'application/json' } });
    st('GEN-13', 'POST', '/auth/register', 'malformed JSON -> 400', r, 400);
    check('GEN-13', 'POST /auth/register', 'error response has no stack trace', 'no stack', /at \w+ \(|node_modules|\.ts:\d+/.test(JSON.stringify(r.body)) ? 'stack leaked' : 'no stack', !/at \w+ \(|node_modules|\.ts:\d+/.test(JSON.stringify(r.body)));
    check('GEN-13', 'POST /auth/register', 'consistent error shape (statusCode, message, path)', 'statusCode,message,path', Object.keys(r.body || {}).join(','), ['statusCode', 'message', 'path'].every((k) => k in (r.body || {})));
    // ACC-04 login
    const c = new Client('traveler');
    r = await login(c, email, 'Start123!');
    st('ACC-04', 'POST', '/auth/login', 'valid login', r, 200);
    const cookies = (c.lastSetCookie || []).join(' || ');
    check('ACC-19', 'POST /auth/login', 'access token cookie is HttpOnly', 'HttpOnly', /access_token=[^|]*HttpOnly/i.test(cookies) ? 'HttpOnly' : 'missing', /access_token=[^|]*HttpOnly/i.test(cookies));
    check('ACC-19', 'POST /auth/login', 'refresh token cookie is HttpOnly', 'HttpOnly', /refresh_token=[^|]*HttpOnly/i.test(cookies) ? 'HttpOnly' : 'missing', /refresh_token=[^|]*HttpOnly/i.test(cookies));
    check('ACC-19', 'POST /auth/login', 'auth cookies are SameSite', 'SameSite', /access_token=[^|]*SameSite/i.test(cookies) ? 'SameSite' : 'missing', /access_token=[^|]*SameSite/i.test(cookies));
    check('ACC-19', 'POST /auth/login', 'tokens not returned in JSON body', 'absent', /eyJ|refresh_token|accessToken/.test(JSON.stringify(r.body)) ? 'present' : 'absent', !/eyJ|refresh_token|accessToken/.test(JSON.stringify(r.body)));
    r = await c.get('/auth/me'); st('ACC-19', 'GET', '/auth/me', 'current user from cookie', r, 200);
    check('ACC-19', 'GET /auth/me', 'returns own email', email, r.body?.user?.email, r.body?.user?.email === email);
    r = await guest.get('/auth/me'); st('ACC-19', 'GET', '/auth/me', 'no cookie -> 401', r, 401);
    const bad = new Client('bad');
    r = await login(bad, email, 'Wrong123!'); st('ACC-04', 'POST', '/auth/login', 'wrong password', r, 401);
    const msgWrong = r.body?.message;
    r = await login(bad, 'nobody@travel.test', 'Wrong123!');
    check('ACC-04', 'POST /auth/login', 'generic message for unknown email vs wrong password', msgWrong, r.body?.message, r.status === 401 && r.body?.message === msgWrong);

    // ACC-05 lockout
    const lockEmail = `lock-${Date.now()}@travel.test`;
    await register('Lock', lockEmail);
    for (let i = 0; i < 4; i++) await login(bad, lockEmail, 'Wrong123!');
    r = await login(bad, lockEmail, 'Start123!');
    st('ACC-05', 'POST', '/auth/login', 'success after 4 failures resets counter', r, 200);
    for (let i = 0; i < 5; i++) await login(bad, lockEmail, 'Wrong123!');
    r = await login(bad, lockEmail, 'Start123!');
    st('ACC-05', 'POST', '/auth/login', 'locked after 5 consecutive failures (even correct password)', r, 401);
    check('ACC-05', 'POST /auth/login', 'lockout message shown', /lock/i, r.body?.message, /lock/i.test(r.body?.message || ''));
    const locked = await db.collection('users').findOne({ email: lockEmail });
    const mins = locked?.lockUntil ? Math.round((new Date(locked.lockUntil) - Date.now()) / 60000) : null;
    check('ACC-05', 'POST /auth/login', 'DB: locked for ~15 minutes', '14-15', mins, mins >= 14 && mins <= 15);

    // CSRF
    r = await c.raw('PATCH', '/users/me', { name: 'No Csrf' }, { headers: { 'x-csrf-token': 'wrong' } });
    st('GEN-13', 'PATCH', '/users/me', 'mutating request with wrong CSRF header rejected', r, [401, 403]);

    // ACC-09 profile
    r = await c.get('/users/me'); st('ACC-11', 'GET', '/users/me', 'own profile', r, 200);
    r = await c.patch('/users/me', { name: 'Traveler Renamed', phone: '+201001234567', preferredCurrency: 'eur' });
    st('ACC-09', 'PATCH', '/users/me', 'valid profile edit', r, 200);
    const u2 = await db.collection('users').findOne({ email });
    check('ACC-09', 'PATCH /users/me', 'DB: name/phone/currency saved (currency upper-cased)', 'EUR', u2?.preferredCurrency, u2?.name === 'Traveler Renamed' && u2?.preferredCurrency === 'EUR');
    r = await c.patch('/users/me', { name: 'Valid Name', phone: 'not-a-phone' });
    st('ACC-09', 'PATCH', '/users/me', 'invalid phone rejected', r, 400);
    const u3 = await db.collection('users').findOne({ email });
    check('ACC-09', 'PATCH /users/me', 'DB: nothing saved when one field invalid', 'Traveler Renamed', u3?.name, u3?.name === 'Traveler Renamed');
    r = await c.patch('/users/me', { preferredCurrency: 'EURO' }); st('ACC-09', 'PATCH', '/users/me', 'invalid currency code', r, 400);
    r = await c.patch('/users/me', { role: 'admin' }); st('GEN-13', 'PATCH', '/users/me', 'cannot change own role', r, 400);

    // ACC-08 change password
    r = await c.patch('/auth/change-password', { currentPassword: 'Wrong999!', newPassword: 'Newpass123' });
    st('ACC-08', 'PATCH', '/auth/change-password', 'wrong current password', r, 401);
    r = await c.patch('/auth/change-password', { currentPassword: 'Start123!', newPassword: 'short' });
    st('ACC-08', 'PATCH', '/auth/change-password', 'new password breaks rules', r, 400);
    r = await c.patch('/auth/change-password', { currentPassword: 'Start123!', newPassword: 'Newpass123' });
    st('ACC-08', 'PATCH', '/auth/change-password', 'valid change', r, 200);
    r = await login(new Client('x'), email, 'Newpass123'); st('ACC-08', 'POST', '/auth/login', 'login with new password', r, 200);
    r = await login(new Client('x'), email, 'Start123!'); st('ACC-08', 'POST', '/auth/login', 'old password no longer works', r, 401);

    // ACC-06 logout + refresh revocation
    const lo = new Client('logout');
    await login(lo, email, 'Newpass123');
    const savedJar = { ...lo.jar };
    r = await lo.post('/auth/logout'); st('ACC-06', 'POST', '/auth/logout', 'logout', r, 200);
    check('ACC-06', 'POST /auth/logout', 'auth cookies cleared', 'no access_token', lo.jar.access_token ? 'present' : 'cleared', !lo.jar.access_token);
    const replay = new Client('replay'); replay.jar = savedJar;
    r = await replay.post('/auth/refresh'); st('ACC-06', 'POST', '/auth/refresh', 'revoked refresh token cannot be reused', r, 401);
    r = await replay.get('/auth/me'); st('ACC-06', 'GET', '/auth/me', 'old access token rejected after logout', r, 401);

    // ACC-06 inactivity: age the session past 30 minutes
    const ia = new Client('inactive'); await login(ia, email, 'Newpass123');
    await db.collection('refreshsessions').updateMany({ revokedAt: null }, { $set: { lastActivityAt: new Date(Date.now() - 31 * 60000) } });
    r = await ia.get('/auth/me'); st('ACC-06', 'GET', '/auth/me', 'session idle > 30 min expires', r, 401);
    // log c back in (its session was aged too)
    await login(c, email, 'Newpass123');

    // ACC-18 seeded admin
    const admin = new Client('admin');
    r = await login(admin, ADMIN.email, ADMIN.password); st('ACC-18', 'POST', '/auth/login', 'seeded admin can log in', r, 200);
    check('ACC-18', 'seed', 'DB: exactly one seeded admin', 1, await db.collection('users').countDocuments({ role: 'admin' }), (await db.collection('users').countDocuments({ role: 'admin' })) === 1);
    ctx.admin = admin;

    // ACC-11 role guard
    r = await c.get('/admin/accounts'); st('ACC-11', 'GET', '/admin/accounts', 'user cannot access admin routes', r, 403);
    r = await guest.get('/admin/accounts'); st('ACC-11', 'GET', '/admin/accounts', 'guest cannot access admin routes', r, 401);

    // ACC-12 deactivate
    const d = await H.newUser(db, 'deactivate');
    r = await d.del('/users/me', { confirm: false }); st('ACC-12', 'DELETE', '/users/me', 'deactivation needs confirmation', r, 400);
    r = await d.del('/users/me', { confirm: true }); st('ACC-12', 'DELETE', '/users/me', 'deactivate own account', r, 200);
    r = await login(new Client('x'), d.email, 'Start123!'); st('ACC-12', 'POST', '/auth/login', 'deactivated user cannot log in', r, 401);

    ctx.traveler = c; ctx.travelerEmail = email; ctx.travelerPassword = 'Newpass123';
  },
};
