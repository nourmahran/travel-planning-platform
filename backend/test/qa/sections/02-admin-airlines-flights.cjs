/* eslint-disable */
'use strict';
const localDT = (days, time) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) + 'T' + time; };
const cabin = (cabinClass, price, seats) => ({ cabinClass, price, totalSeats: seats, availableSeats: seats, freeBagsPerPassenger: 1, maxWeightKgPerBag: 23, extraBagPrice: 50, maxExtraBagsPerPassenger: 2 });
const policies = { cancellationTiers: [{ daysBefore: 30, refundPercent: 100 }, { daysBefore: 7, refundPercent: 50 }, { daysBefore: 0, refundPercent: 0 }], baggage: { freeBagsPerPassenger: 1, maxWeightKgPerBag: 23, extraBagPrice: 50, maxExtraBagsPerPassenger: 2 } };

module.exports = {
  name: '2. Administration, airlines and flights',
  async run(ctx, H) {
    const { Client, guest, check, expectStatus: st, idOf, items, login, sleep } = H;
    const db = ctx.db; const admin = ctx.admin; const user = ctx.traveler;
    let r;

    // FLT-01 airlines
    r = await admin.post('/airlines', { code: 'QA', name: 'QA Airways', countryCode: 'EG', logoUrl: 'https://example.com/qa.png', flightPolicies: policies });
    st('FLT-01', 'POST', '/airlines', 'admin creates airline', r, 201);
    const airlineA = idOf(r.body);
    r = await admin.post('/airlines', { code: 'QB', name: 'Other Air', countryCode: 'AE', flightPolicies: policies });
    const airlineB = idOf(r.body);
    r = await admin.post('/airlines', { code: 'QA', name: 'Dup', countryCode: 'EG' }); st('FLT-01', 'POST', '/airlines', 'duplicate airline code', r, 409);
    r = await admin.post('/airlines', { code: 'toolong', name: 'X', countryCode: 'EG' }); st('FLT-01', 'POST', '/airlines', 'invalid airline code', r, 400);
    r = await user.post('/airlines', { code: 'QZ', name: 'User Air', countryCode: 'EG' }); st('FLT-01', 'POST', '/airlines', 'user cannot create airline', r, 403);
    r = await guest.get(`/airlines/${airlineA}`); st('FLT-01', 'GET', '/airlines/:id', 'public airline profile', r, 200);

    // ACC-13 moderators
    const modEmail = `airmod-${Date.now()}@travel.test`;
    r = await admin.post('/admin/moderators', { name: 'Air Mod', email: modEmail, temporaryPassword: 'TempPass123', providerType: 'airline', providerId: airlineA });
    st('ACC-13', 'POST', '/admin/moderators', 'admin creates airline moderator', r, 201);
    const modId = idOf(r.body);
    r = await admin.post('/admin/moderators', { name: 'Bad', email: `x-${Date.now()}@travel.test`, temporaryPassword: 'TempPass123', providerType: 'airline', providerId: '6a0000000000000000000000' });
    st('ACC-13', 'POST', '/admin/moderators', 'unknown provider rejected', r, [400, 404]);
    r = await admin.post('/admin/moderators', { name: 'Dup', email: modEmail, temporaryPassword: 'TempPass123', providerType: 'airline', providerId: airlineA });
    st('ACC-13', 'POST', '/admin/moderators', 'duplicate moderator email', r, 409);
    const mod = new Client('airmod');
    r = await login(mod, modEmail, 'TempPass123'); st('ACC-13', 'POST', '/auth/login', 'moderator logs in with temporary password', r, 200);
    r = await mod.get('/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=2030-01-01');
    r = await mod.post('/flights', {}); st('ACC-13', 'POST', '/flights', 'temporary password must be changed first', r, 403);
    r = await mod.patch('/auth/change-password', { currentPassword: 'TempPass123', newPassword: 'ModPass123' }); st('ACC-13', 'PATCH', '/auth/change-password', 'moderator sets own password', r, 200);
    const modB = new Client('airmodB');
    const modBEmail = `airmodb-${Date.now()}@travel.test`;
    await admin.post('/admin/moderators', { name: 'Air Mod B', email: modBEmail, temporaryPassword: 'TempPass123', providerType: 'airline', providerId: airlineB });
    await login(modB, modBEmail, 'TempPass123'); await modB.patch('/auth/change-password', { currentPassword: 'TempPass123', newPassword: 'ModPass123' });

    r = await mod.patch(`/airlines/${airlineA}`, { name: 'QA Airways Renamed' }); st('FLT-01', 'PATCH', '/airlines/:id', 'moderator edits own airline', r, 200);
    r = await modB.patch(`/airlines/${airlineA}`, { name: 'Hijack' }); st('FLT-01', 'PATCH', '/airlines/:id', "moderator cannot edit another airline", r, 403);

    // FLT-08 / FLT-09 policy endpoints
    r = await mod.put(`/airlines/${airlineA}/baggage-policy`, policies.baggage); st('FLT-08', 'PUT', '/airlines/:id/baggage-policy', 'set baggage policy', r, 200);
    r = await mod.put(`/airlines/${airlineA}/baggage-policy`, { ...policies.baggage, maxExtraBagsPerPassenger: -1 }); st('FLT-08', 'PUT', '/airlines/:id/baggage-policy', 'negative extra-bag limit rejected', r, 400);
    r = await mod.put(`/airlines/${airlineA}/cancellation-policy`, { cancellationTiers: policies.cancellationTiers }); st('FLT-09', 'PUT', '/airlines/:id/cancellation-policy', 'set cancellation tiers', r, 200);
    r = await mod.put(`/airlines/${airlineA}/cancellation-policy`, { cancellationTiers: [{ daysBefore: 3, refundPercent: 50 }, { daysBefore: 3, refundPercent: 20 }] }); st('FLT-09', 'PUT', '/airlines/:id/cancellation-policy', 'duplicate thresholds rejected', r, 400);
    r = await mod.put(`/airlines/${airlineA}/cancellation-policy`, { cancellationTiers: [{ daysBefore: 3, refundPercent: 150 }] }); st('FLT-09', 'PUT', '/airlines/:id/cancellation-policy', 'refund > 100% rejected', r, 400);
    r = await modB.put(`/airlines/${airlineA}/cancellation-policy`, { cancellationTiers: policies.cancellationTiers }); st('FLT-09', 'PUT', '/airlines/:id/cancellation-policy', 'other airline moderator forbidden', r, 403);

    // FLT-02 airports
    r = await guest.get('/airports'); st('FLT-02', 'GET', '/airports', 'list airports', r, 200);
    const airportCount = items(r.body).length || (r.body?.total ?? 0);
    check('FLT-02', 'GET /airports', 'seeded airports listed with time zones', '>=8', airportCount, airportCount >= 8);
    r = await guest.get('/airports/CAI'); st('FLT-02', 'GET', '/airports/:code', 'airport with IANA zone', r, 200);
    check('FLT-02', 'GET /airports/CAI', 'time zone Africa/Cairo', 'Africa/Cairo', r.body?.time_zone ?? r.body?.timeZone, (r.body?.time_zone ?? r.body?.timeZone) === 'Africa/Cairo');

    // FLT-03 / FLT-04 flights
    const base = { airlineId: airlineA, departureAirport: 'CAI', arrivalAirport: 'DXB', departureLocalTime: localDT(40, '10:00:00'), arrivalLocalTime: localDT(40, '15:00:00'), cabins: [cabin('Economy', 300, 4), cabin('Business', 900, 2)] };
    r = await mod.post('/flights', { ...base, flightNumber: 'QA100' }); st('FLT-03', 'POST', '/flights', 'moderator creates flight', r, 201);
    const f1 = idOf(r.body);
    const f1doc = await db.collection('flights').findOne({ flightNumber: 'QA100' });
    // CAI (UTC+2) 10:00 local -> 08:00Z
    check('FLT-03', 'POST /flights', 'DB: departure stored in UTC from airport local time', '08:00Z', f1doc?.departureTimeUtc?.toISOString().slice(11, 16), f1doc?.departureTimeUtc?.toISOString().slice(11, 16) === '08:00');
    r = await mod.post('/flights', { ...base, flightNumber: 'QA100' }); st('FLT-03', 'POST', '/flights', 'duplicate flight number same day', r, 409);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA101', arrivalAirport: 'CAI' }); st('FLT-03', 'POST', '/flights', 'identical airports rejected', r, 400);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA102', arrivalLocalTime: localDT(40, '09:00:00') }); st('FLT-03', 'POST', '/flights', 'arrival before departure rejected', r, 400);
    // 10:00 CAI = 08:00Z, 11:30 DXB = 07:30Z -> arrival before departure in UTC despite later local time
    r = await mod.post('/flights', { ...base, flightNumber: 'QA103', arrivalLocalTime: localDT(40, '11:30:00') }); st('FLT-03', 'POST', '/flights', 'arrival compared in UTC, not local time', r, 400);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA104', departureLocalTime: localDT(-2, '10:00:00'), arrivalLocalTime: localDT(-2, '15:00:00') }); st('FLT-03', 'POST', '/flights', 'departure in the past rejected', r, 400);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA105', departureAirport: 'XXX' }); st('FLT-02', 'POST', '/flights', 'airport not in reference list rejected', r, [400, 404]);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA106', airlineId: airlineB }); st('FLT-03', 'POST', '/flights', "cannot create flight for another airline", r, 403);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA107', cabins: [cabin('Economy', 300, 4), cabin('Economy', 200, 4)] }); st('FLT-04', 'POST', '/flights', 'cabin class used twice rejected', r, 400);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA108', cabins: [cabin('Economy', 0, 4)] }); st('FLT-04', 'POST', '/flights', 'price 0 rejected', r, 400);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA109', cabins: [cabin('Economy', 300, 0)] }); st('FLT-04', 'POST', '/flights', 'seat count 0 rejected', r, 400);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA110', cabins: [cabin('Coach', 300, 5)] }); st('FLT-04', 'POST', '/flights', 'unknown cabin class rejected', r, 400);
    r = await user.post('/flights', { ...base, flightNumber: 'QA111' }); st('FLT-03', 'POST', '/flights', 'traveler cannot create flights', r, 403);

    // more flights for search, round trip, sort and later tests
    r = await mod.post('/flights', { ...base, flightNumber: 'QA200', departureLocalTime: localDT(40, '18:00:00'), arrivalLocalTime: localDT(40, '23:00:00'), cabins: [cabin('Economy', 150, 30)] });
    const f2 = idOf(r.body);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA300', departureAirport: 'DXB', arrivalAirport: 'CAI', departureLocalTime: localDT(47, '09:00:00'), arrivalLocalTime: localDT(47, '11:00:00'), cabins: [cabin('Economy', 280, 30), cabin('Business', 800, 4)] });
    const fReturn = idOf(r.body);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA400', departureLocalTime: localDT(3, '10:00:00'), arrivalLocalTime: localDT(3, '15:00:00'), cabins: [cabin('Economy', 400, 20)] });
    const fSoon = idOf(r.body);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA500', departureLocalTime: localDT(60, '10:00:00'), arrivalLocalTime: localDT(60, '15:00:00'), cabins: [cabin('Economy', 500, 1)] });
    const fLastSeat = idOf(r.body);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA600', departureLocalTime: localDT(41, '10:00:00'), arrivalLocalTime: localDT(41, '15:00:00'), cabins: [cabin('Economy', 200, 30)] });
    const fChange = idOf(r.body);
    r = await mod.post('/flights', { ...base, flightNumber: 'QA700', departureLocalTime: localDT(50, '10:00:00'), arrivalLocalTime: localDT(50, '15:00:00'), cabins: [cabin('Economy', 250, 30)] });
    const fCancelLater = idOf(r.body);
    r = await modB.post('/flights', { ...base, airlineId: airlineB, flightNumber: 'QB100', cabins: [cabin('Economy', 220, 30)] });
    const fB = idOf(r.body);
    check('FLT-03', 'POST /flights', 'test flights created', 'all ids', [f2, fReturn, fSoon, fLastSeat, fChange, fCancelLater, fB].filter(Boolean).length, [f2, fReturn, fSoon, fLastSeat, fChange, fCancelLater, fB].every(Boolean));

    // FLT-04 cabin endpoints
    r = await mod.post(`/flights/${f2}/cabins`, cabin('First', 2000, 2)); st('FLT-04', 'POST', '/flights/:id/cabins', 'add cabin class', r, 201);
    r = await mod.post(`/flights/${f2}/cabins`, cabin('First', 2000, 2)); st('FLT-04', 'POST', '/flights/:id/cabins', 'same class twice rejected', r, 409);
    r = await mod.patch(`/flights/${f2}/cabins/First`, { price: 2100 }); st('FLT-05', 'PATCH', '/flights/:id/cabins/:cabinId', 'update cabin price', r, 200);
    r = await mod.patch(`/flights/${f2}/cabins/Galley`, { price: 1 }); st('FLT-04', 'PATCH', '/flights/:id/cabins/:cabinId', 'unknown cabin id', r, 400);
    r = await modB.patch(`/flights/${f2}/cabins/First`, { price: 1 }); st('FLT-05', 'PATCH', '/flights/:id/cabins/:cabinId', 'other airline forbidden', r, 403);

    // FLT-11 / FLT-12 / FLT-15 search
    const date40 = localDT(40, '').slice(0, 10);
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${date40}&passengers=1`);
    st('FLT-11', 'GET', '/flights/search', 'guest one-way search', r, 200);
    const found = (r.body?.flights || []).map((f) => f.flightNumber);
    check('FLT-11', 'GET /flights/search', 'finds both CAI->DXB flights on that local date', 'QA100,QA200', found.join(','), found.includes('QA100') && found.includes('QA200') && !found.includes('QA600'));
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${date40}&passengers=5`);
    const found5 = (r.body?.flights || []).map((f) => f.flightNumber);
    check('FLT-11', 'GET /flights/search', 'excludes flights without enough seats (QA100 has 4+2)', 'QA200 only', found5.join(','), !found5.includes('QA100') && found5.includes('QA200'));
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=LHR&departureDate=${date40}`);
    check('FLT-11', 'GET /flights/search', 'no match -> empty list', 0, (r.body?.flights || []).length, r.status === 200 && (r.body?.flights || []).length === 0);
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${date40}&cabinClass=Business`);
    const biz = (r.body?.flights || []).map((f) => f.flightNumber);
    check('FLT-12', 'GET /flights/search', 'cabin filter Business', 'QA100 only', biz.join(','), biz.includes('QA100') && !biz.includes('QA200'));
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${date40}&minPrice=500&maxPrice=100`);
    st('FLT-15', 'GET', '/flights/search', 'min price > max price rejected', r, 400);
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${date40}&minPrice=100&maxPrice=200`);
    const priced = (r.body?.flights || []).map((f) => f.flightNumber);
    check('FLT-15', 'GET /flights/search', 'price range 100-200 inclusive keeps QA200 (150)', 'QA200', priced.join(','), priced.includes('QA200') && !priced.includes('QA100'));
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${date40}&sortBy=price_desc`);
    const order = (r.body?.flights || []).map((f) => f.flightNumber);
    check('FLT-15', 'GET /flights/search', 'sort price_desc', 'QA100 before QA200', order.join(','), order.indexOf('QA100') > -1 && order.indexOf('QA100') < order.indexOf('QA200'));
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${date40}&sortBy=sideways`);
    st('FLT-15', 'GET', '/flights/search', 'invalid sort value rejected', r, 400);
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=XXX&departureDate=${date40}`);
    st('FLT-02', 'GET', '/flights/search', 'unknown airport in search rejected', r, [400, 404]);
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${date40}&returnDate=${localDT(47, '').slice(0, 10)}`);
    st('FLT-12', 'GET', '/flights/search', 'round-trip search', r, 200);
    const rtOut = (r.body?.outbound?.flights || []).map((f) => f.flightNumber), rtIn = (r.body?.inbound?.flights || []).map((f) => f.flightNumber);
    check('FLT-12', 'GET /flights/search', 'round trip returns outbound and return options', 'QA100/QA300', `${rtOut}/${rtIn}`, rtOut.includes('QA100') && rtIn.includes('QA300'));

    // FLT-17 details
    r = await guest.get(`/flights/${f1}`); st('FLT-17', 'GET', '/flights/:id', 'flight details', r, 200);
    const det = r.body || {};
    check('FLT-17', 'GET /flights/:id', 'airline, local times, duration, cabins with baggage and cancellation tiers', 'all present',
      ['airline', 'departureLocalTime', 'arrivalLocalTime', 'durationMinutes', 'cancellationTiers'].filter((k) => det[k] === undefined).join(',') || 'all present',
      det.airline && det.departureLocalTime?.includes('+02:00') && det.durationMinutes === 180 && det.cancellationTiers?.length === 3 && det.flight?.cabins?.[0]?.maxWeightKgPerBag === 23);
    check('GEN-06', 'GET /flights/:id', 'departure shown in Cairo local time', '10:00+02:00', det.departureLocalTime?.slice(11), det.departureLocalTime?.slice(11, 16) === '10:00' && det.departureLocalTime?.endsWith('+02:00'));
    check('GEN-06', 'GET /flights/:id', 'arrival shown in Dubai local time', '15:00+04:00', det.arrivalLocalTime?.slice(11), det.arrivalLocalTime?.slice(11, 16) === '15:00' && det.arrivalLocalTime?.endsWith('+04:00'));
    r = await guest.get('/flights/not-an-id'); st('FLT-17', 'GET', '/flights/:id', 'malformed id', r, 400);
    r = await guest.get('/flights/6a0000000000000000000000'); st('FLT-17', 'GET', '/flights/:id', 'unknown id', r, 404);

    // ACC-14 accounts list
    r = await admin.get('/admin/accounts?role=airline_moderator'); st('ACC-14', 'GET', '/admin/accounts', 'filter by role', r, 200);
    const roles = items(r.body).map((a) => a.role);
    check('ACC-14', 'GET /admin/accounts', 'only moderators returned', 'airline_moderator', [...new Set(roles)].join(','), roles.length >= 2 && roles.every((x) => x === 'airline_moderator'));
    r = await admin.get(`/admin/accounts?search=${encodeURIComponent(ctx.travelerEmail)}`);
    check('ACC-14', 'GET /admin/accounts', 'search by email', 1, items(r.body).length, items(r.body).length === 1);
    r = await admin.get('/admin/accounts?status=suspended&page=1&limit=10'); st('ACC-14', 'GET', '/admin/accounts', 'filter by status with pagination', r, 200);
    r = await admin.get('/admin/accounts?role=wizard'); st('ACC-14', 'GET', '/admin/accounts', 'invalid role filter', r, 400);
    r = await admin.get(`/admin/accounts?search=${encodeURIComponent('.*')}`);
    check('GEN-13', 'GET /admin/accounts?search=.*', 'search text matched literally (regex escaped)', 0, items(r.body).length, r.status === 200 && items(r.body).length === 0);
    const t0 = Date.now(); r = await admin.get(`/admin/accounts?search=${encodeURIComponent('(a+)+$')}`);
    check('GEN-13', 'GET /admin/accounts?search=(a+)+$', 'no regex injection / ReDoS', '200 fast', `${r.status} ${Date.now() - t0}ms`, r.status === 200 && Date.now() - t0 < 2000);

    // ACC-16 suspend / reactivate user
    const victim = await H.newUser(db, 'suspendme');
    r = await admin.patch(`/admin/accounts/${victim.id}/suspend`); st('ACC-16', 'PATCH', '/admin/accounts/:id/suspend', 'suspend user', r, 200);
    r = await victim.get('/auth/me'); st('ACC-16', 'GET', '/auth/me', 'suspended user session rejected', r, 401);
    r = await login(new Client('x'), victim.email, 'Start123!');
    check('ACC-04', 'POST /auth/login', 'suspended account message', /suspended/i, r.body?.message, r.status === 401 && /suspended/i.test(r.body?.message || ''));
    r = await admin.patch(`/admin/accounts/${victim.id}/reactivate`); st('ACC-16', 'PATCH', '/admin/accounts/:id/reactivate', 'reactivate user', r, 200);
    r = await login(new Client('x'), victim.email, 'Start123!'); st('ACC-16', 'POST', '/auth/login', 'reactivated user can log in', r, 200);
    r = await user.patch(`/admin/accounts/${victim.id}/suspend`); st('ACC-16', 'PATCH', '/admin/accounts/:id/suspend', 'non-admin cannot suspend', r, 403);

    // ACC-07a admin reset password
    r = await admin.post(`/admin/users/${victim.id}/reset-password`, { temporaryPassword: 'Temp4567x' }); st('ACC-07a', 'POST', '/admin/users/:id/reset-password', 'admin sets temporary password', r, [200, 201]);
    const vc = new Client('victim2');
    r = await login(vc, victim.email, 'Temp4567x'); st('ACC-07a', 'POST', '/auth/login', 'login with temporary password', r, 200);
    r = await vc.get('/flight-bookings'); st('ACC-07a', 'GET', '/flight-bookings', 'must change temporary password first', r, 403);
    r = await vc.patch('/auth/change-password', { currentPassword: 'Temp4567x', newPassword: 'Mine12345' }); st('ACC-07a', 'PATCH', '/auth/change-password', 'set new password', r, 200);
    r = await vc.get('/flight-bookings'); st('ACC-07a', 'GET', '/flight-bookings', 'access restored after change', r, 200);
    r = await admin.post(`/admin/users/${victim.id}/reset-password`, { temporaryPassword: 'weak' }); st('ACC-07a', 'POST', '/admin/users/:id/reset-password', 'temporary password must meet rules', r, 400);

    // ACC-15 moderator suspension + provider deactivation
    r = await admin.patch(`/admin/accounts/${modId}/suspend`); st('ACC-15', 'PATCH', '/admin/accounts/:id/suspend', 'suspend moderator', r, 200);
    r = await login(new Client('x'), modEmail, 'ModPass123'); st('ACC-15', 'POST', '/auth/login', 'suspended moderator cannot log in', r, 401);
    r = await admin.patch(`/admin/accounts/${modId}/reactivate`); st('ACC-15', 'PATCH', '/admin/accounts/:id/reactivate', 'reactivate moderator', r, 200);
    await login(mod, modEmail, 'ModPass123');

    r = await admin.patch(`/admin/providers/airline/${airlineB}/deactivate`); st('ACC-15', 'PATCH', '/admin/providers/:type/:id/deactivate', 'deactivate airline', r, 200);
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${date40}`);
    const afterDeact = (r.body?.flights || []).map((f) => f.flightNumber);
    check('ACC-15', 'GET /flights/search', "deactivated airline's flights hidden", 'no QB100', afterDeact.join(','), !afterDeact.includes('QB100'));
    const bk = await H.newUser(db, 'deactbook');
    r = await bk.post('/flight-bookings/hold', { flightId: fB, cabinClass: 'Economy', passengers: [{ firstName: 'A', lastName: 'B', passportNumber: 'P1', dateOfBirth: '1990-01-01' }] });
    check('ACC-15', 'POST /flight-bookings/hold', "deactivated airline's flight cannot be booked", '4xx', r.status, r.status >= 400 && r.status < 500);
    r = await modB.get('/notifications'); const modBNotes = items(r.body).map((n) => n.type || n.title);
    check('ACC-15', 'GET /notifications', 'airline moderator notified of deactivation', 'notification', modBNotes.join(','), modBNotes.length > 0);
    r = await admin.patch(`/admin/providers/airline/${airlineB}/reactivate`); st('ACC-15', 'PATCH', '/admin/providers/:type/:id/reactivate', 'reactivate airline', r, 200);
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${date40}`);
    check('ACC-15', 'GET /flights/search', 'reactivated airline visible again', 'QB100', (r.body?.flights || []).map((f) => f.flightNumber).join(','), (r.body?.flights || []).some((f) => f.flightNumber === 'QB100'));
    r = await admin.patch(`/admin/providers/plane/${airlineB}/deactivate`); st('ACC-15', 'PATCH', '/admin/providers/:type/:id/deactivate', 'invalid provider type', r, 400);

    // GEN-07 audit log
    r = await admin.get('/admin/audit-logs'); st('GEN-07', 'GET', '/admin/audit-logs', 'audit log list', r, 200);
    const actions = items(r.body).map((a) => a.action).join(',');
    check('GEN-07', 'GET /admin/audit-logs', 'suspension and provider deactivation logged', 'suspend + deactivate', actions.slice(0, 200), /suspend/i.test(actions) && /deactivat/i.test(actions));
    r = await user.get('/admin/audit-logs'); st('GEN-07', 'GET', '/admin/audit-logs', 'non-admin forbidden', r, 403);

    // FLT-30 departed
    r = await mod.post('/flights', { ...base, flightNumber: 'QA900', departureLocalTime: localDT(2, '10:00:00'), arrivalLocalTime: localDT(2, '15:00:00'), cabins: [cabin('Economy', 100, 10)] });
    const fDepart = idOf(r.body);
    await db.collection('flights').updateOne({ _id: new H.ObjectId(fDepart) }, { $set: { departureTimeUtc: new Date(Date.now() - 60000), arrivalTimeUtc: new Date(Date.now() + 3600000) } });
    let status;
    for (let i = 0; i < 12 && status !== 'Departed'; i++) { await sleep(2500); status = (await db.collection('flights').findOne({ _id: new H.ObjectId(fDepart) }))?.status; }
    check('FLT-30', 'cron depart-flights', 'flight past departure becomes Departed', 'Departed', status, status === 'Departed');
    r = await mod.patch(`/flights/${fDepart}`, { flightNumber: 'QA901' }); check('FLT-30', 'PATCH /flights/:id', 'departed flight not editable', '4xx', r.status, r.status >= 400 && r.status < 500);
    r = await bk.post('/flight-bookings/hold', { flightId: fDepart, cabinClass: 'Economy', passengers: [{ firstName: 'A', lastName: 'B', passportNumber: 'P1', dateOfBirth: '1990-01-01' }] });
    check('FLT-30', 'POST /flight-bookings/hold', 'departed flight not bookable', '4xx', r.status, r.status >= 400 && r.status < 500);

    Object.assign(ctx, { airlineA, airlineB, mod, modB, modEmail, f1, f2, fReturn, fSoon, fLastSeat, fChange, fCancelLater, fB, date40, localDT, cabin });
  },
};
