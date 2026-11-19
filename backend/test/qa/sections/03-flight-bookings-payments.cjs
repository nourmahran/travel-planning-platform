/* eslint-disable */
'use strict';
const P = (first, dob, extra) => ({ firstName: first, lastName: 'Tester', passportNumber: 'P' + Math.floor(Math.random() * 1e7), dateOfBirth: dob, ...(extra ? { extraBagWeightsKg: extra } : {}) });
const ADULT = '1990-05-05', CHILD = () => `${new Date().getUTCFullYear() - 6}-01-01`, INFANT = () => `${new Date().getUTCFullYear() - 1}-01-01`;
const total = (b) => b?.totalPrice ?? b?.totalAmount ?? b?.total;

module.exports = {
  name: '3. Flight bookings, payments and refunds',
  async run(ctx, H) {
    const { Client, guest, check, expectStatus: st, idOf, items, sleep, login, payWithTestCard, deliverPaymentSucceeded, deliver, stripe, ObjectId } = H;
    const db = ctx.db; const mod = ctx.mod; const modB = ctx.modB; const admin = ctx.admin;
    const seats = async (fid, cls = 'Economy') => (await db.collection('flights').findOne({ _id: new ObjectId(fid) }))?.cabins.find((c) => c.cabinClass === cls)?.availableSeats;
    let r;

    const u = await H.newUser(db, 'flyer');
    const other = await H.newUser(db, 'snoop');
    const unverified = await H.newUser(db, 'unverified', { verified: false });

    // ACC-02 bonus
    r = await unverified.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [P('A', ADULT)] });
    st('ACC-02', 'POST', '/flight-bookings/hold', 'unverified email cannot book', r, 403);

    // ACC-10/ACC-11
    r = await guest.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [P('A', ADULT)] });
    st('ACC-10', 'POST', '/flight-bookings/hold', 'guest must log in to book', r, 401);
    r = await mod.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [P('A', ADULT)] });
    st('ACC-11', 'POST', '/flight-bookings/hold', 'moderator cannot book as traveler', r, 403);

    // FLT-12(b) passenger rules + FLT-19 validation
    r = await u.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [P('Kid', CHILD())] });
    st('FLT-12', 'POST', '/flight-bookings/hold', 'booking without an adult rejected', r, 400);
    r = await u.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [P('A', ADULT), P('I1', INFANT()), P('I2', INFANT())] });
    st('FLT-12', 'POST', '/flight-bookings/hold', 'more infants than adults rejected', r, 400);
    r = await u.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [P('A', ADULT, [10, 10, 10])] });
    st('FLT-19', 'POST', '/flight-bookings/hold', 'extra bags above airline maximum (2) rejected', r, 400);
    r = await u.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [P('A', ADULT, [30])] });
    st('FLT-08', 'POST', '/flight-bookings/hold', 'extra bag heavier than max weight (23kg) rejected', r, 400);
    r = await u.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [{ firstName: 'A', lastName: 'B', dateOfBirth: ADULT }] });
    st('FLT-19', 'POST', '/flight-bookings/hold', 'missing passport number', r, 400);
    r = await u.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [P('A', '2099-01-01')] });
    st('FLT-19', 'POST', '/flight-bookings/hold', 'date of birth in the future', r, 400);
    r = await u.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [] });
    st('FLT-19', 'POST', '/flight-bookings/hold', 'no passengers', r, 400);
    r = await u.post('/flight-bookings/hold', { flightId: 'nope', cabinClass: 'Economy', passengers: [P('A', ADULT)] });
    st('FLT-19', 'POST', '/flight-bookings/hold', 'malformed flight id', r, 400);
    r = await u.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Business', passengers: [P('A', ADULT)] });
    st('FLT-19', 'POST', '/flight-bookings/hold', 'cabin not on this flight', r, 400);

    // FLT-22 hold + FLT-12 pricing
    const before = await seats(ctx.f2);
    r = await u.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [P('Adult', ADULT, [20]), P('Child', CHILD()), P('Infant', INFANT())] });
    st('FLT-22', 'POST', '/flight-bookings/hold', 'hold 1 adult + 1 child + 1 infant with one extra bag', r, 201);
    const b1 = r.body; const b1id = idOf(b1);
    // 150 + 150 + 15 (infant 10%) + 50 (extra bag) = 365
    check('FLT-12', 'POST /flight-bookings/hold', 'price: adult+child full fare, infant 10%, bag fee', 365, total(b1), Math.abs(total(b1) - 365) < 0.01);
    check('FLT-22', 'POST /flight-bookings/hold', 'status Pending Payment', 'Pending Payment', b1?.status, b1?.status === 'Pending Payment');
    const holdMin = b1?.holdExpiresAt ? Math.round((new Date(b1.holdExpiresAt) - Date.now()) / 60000) : null;
    check('FLT-22', 'POST /flight-bookings/hold', 'hold lasts 10 minutes', '9-10', holdMin, holdMin >= 9 && holdMin <= 10);
    check('FLT-12', 'POST /flight-bookings/hold', 'DB: infant takes no seat (2 seats held)', before - 2, await seats(ctx.f2), (await seats(ctx.f2)) === before - 2);

    // FLT-21 summary + ACC-11 ownership
    r = await u.get(`/flight-bookings/${b1id}`); st('FLT-21', 'GET', '/flight-bookings/:id', 'booking summary before payment', r, 200);
    check('FLT-21', 'GET /flight-bookings/:id', 'summary has passengers, baggage and total', '3 passengers', r.body?.passengers?.length, r.body?.passengers?.length === 3 && total(r.body) === total(b1));
    r = await other.get(`/flight-bookings/${b1id}`); st('ACC-11', 'GET', '/flight-bookings/:id', "other user's booking hidden", r, [403, 404]);
    r = await guest.get(`/flight-bookings/${b1id}`); st('ACC-11', 'GET', '/flight-bookings/:id', 'guest rejected', r, 401);

    // PAY-02 policies
    r = await u.post('/payments', { bookingType: 'flight', bookingId: b1id }); st('PAY-02', 'POST', '/payments', 'payment blocked before policies accepted', r, 400);
    r = await u.get(`/bookings/flight/${b1id}/policies`); st('PAY-02', 'GET', '/bookings/:type/:id/policies', 'airline policies shown', r, 200);
    const pol = JSON.stringify(r.body);
    check('PAY-02', 'GET /bookings/flight/:id/policies', 'includes cancellation tiers and baggage', 'both', pol.slice(0, 120), /cancellationTiers/.test(pol) && /baggage|Bag/i.test(pol));
    r = await other.get(`/bookings/flight/${b1id}/policies`); st('PAY-02', 'GET', '/bookings/:type/:id/policies', "other user can't read", r, [403, 404]);
    r = await u.post(`/bookings/flight/${b1id}/accept-policies`, { accepted: false }); st('PAY-02', 'POST', '/bookings/:type/:id/accept-policies', 'unchecked box rejected', r, 400);
    r = await u.post(`/bookings/flight/${b1id}/accept-policies`, { accepted: true }); st('PAY-02', 'POST', '/bookings/:type/:id/accept-policies', 'accept policies', r, 200);
    check('PAY-02', 'POST /bookings/flight/:id/accept-policies', 'acceptance timestamp returned', 'date', r.body?.acceptedAt, !!r.body?.acceptedAt);

    // PAY-01 pay with Stripe test card
    r = await other.post('/payments', { bookingType: 'flight', bookingId: b1id }); st('PAY-01', 'POST', '/payments', "cannot pay someone else's booking", r, [403, 404]);
    const declined = await payWithTestCard(u, 'flight', b1id, { card: 'pm_card_chargeDeclined' });
    st('PAY-01', 'POST', '/payments', 'create PaymentIntent', declined.pay, 201);
    check('PAY-01', 'POST /payments', 'amount equals booking total (USD)', '365 usd', `${declined.pay.body?.amount} ${declined.pay.body?.currency}`, declined.pay.body?.amount === 365 && declined.pay.body?.currency === 'usd');
    check('PAY-01', 'Stripe confirm', 'declined test card does not succeed', 'requires_payment_method', declined.pi?.status, declined.pi?.status !== 'succeeded');
    await deliver('payment_intent.payment_failed', await stripe.paymentIntents.retrieve(declined.pi.id));
    r = await u.get(`/flight-bookings/${b1id}`);
    check('PAY-01', 'webhook payment_failed', 'booking stays unconfirmed after failure', 'Pending Payment', r.body?.status, r.body?.status === 'Pending Payment');
    r = await u.post(`/payments/${declined.pay.body.paymentId}/retry`); st('PAY-01', 'POST', '/payments/:id/retry', 'retry after failure', r, [200, 201]);
    const retrySecret = r.body?.clientSecret;
    const pi = await stripe.paymentIntents.confirm(retrySecret.split('_secret_')[0], { payment_method: 'pm_card_visa', return_url: 'http://localhost/return' });
    check('PAY-01', 'Stripe confirm', 'test card 4242 succeeds on retry', 'succeeded', pi.status, pi.status === 'succeeded');
    r = await u.get(`/flight-bookings/${b1id}`);
    check('PAY-01', 'before webhook', 'not confirmed until webhook verified', 'Pending Payment', r.body?.status, r.body?.status === 'Pending Payment');
    // invalid signature
    const bad = await guest.raw('POST', '/payments/webhook', undefined, { rawBody: JSON.stringify({ id: 'evt_x', type: 'payment_intent.succeeded', data: { object: pi } }), headers: { 'stripe-signature': 't=1,v1=deadbeef', 'content-type': 'application/json' } });
    st('PAY-01', 'POST', '/payments/webhook', 'forged webhook signature rejected', bad, 400);
    r = await u.get(`/flight-bookings/${b1id}`);
    check('PAY-01', 'forged webhook', 'forged event does not confirm', 'Pending Payment', r.body?.status, r.body?.status === 'Pending Payment');
    const ev = await deliverPaymentSucceeded(pi);
    st('PAY-01', 'POST', '/payments/webhook', 'signed payment_intent.succeeded accepted', ev.res, [200, 201]);
    r = await u.get(`/flight-bookings/${b1id}`);
    check('FLT-23', 'GET /flight-bookings/:id', 'booking Confirmed after verified payment', 'Confirmed', r.body?.status, r.body?.status === 'Confirmed');
    const ref1 = r.body?.reference ?? r.body?.bookingReference;
    check('FLT-23', 'GET /flight-bookings/:id', 'unique booking reference generated', 'reference', ref1, !!ref1);
    // duplicate webhook delivery
    const dup = await H.deliver('payment_intent.succeeded', await stripe.paymentIntents.retrieve(pi.id), ev.id);
    st('PAY-01', 'POST', '/payments/webhook', 'duplicate event acknowledged', dup.res, [200, 201]);
    const evCount = await db.collection('processed_stripe_events').countDocuments({ eventId: ev.id });
    check('PAY-01', 'duplicate webhook', 'DB: event processed once', 1, evCount, evCount === 1);
    const confirmedOnce = await db.collection('notifications').countDocuments({ recipientId: new ObjectId(u.id), type: /confirm/i });
    check('PAY-01', 'duplicate webhook', 'no duplicate confirmation notification', 1, confirmedOnce, confirmedOnce === 1);
    const payDoc = await db.collection('payments').findOne({ bookingId: new ObjectId(b1id) });
    const payKeys = Object.keys(payDoc || {}).join(',');
    check('PAY-01', 'DB payments', 'no card data or client secret stored', 'no card/secret fields', payKeys, payDoc && !/card|cvc|pan|secret|number/i.test(payKeys));
    r = await u.get(`/payments/${declined.pay.body.paymentId}`); st('PAY-01', 'GET', '/payments/:id', 'payment status', r, 200);
    check('PAY-01', 'GET /payments/:id', 'status Succeeded', 'Succeeded', r.body?.status, /succeeded/i.test(r.body?.status || ''));
    r = await other.get(`/payments/${declined.pay.body.paymentId}`); st('PAY-01', 'GET', '/payments/:id', "other user can't view payment", r, [403, 404]);

    // FLT-23 notification + e-ticket
    r = await u.get('/notifications'); const notes = items(r.body);
    check('FLT-23', 'GET /notifications', 'booking confirmation notification', 'booking confirmed', notes.map((n) => n.type).join(','), notes.some((n) => /confirm/i.test(`${n.type} ${n.title}`)));
    r = await u.get('/notifications/unread-count'); st('GEN-01', 'GET', '/notifications/unread-count', 'unread count', r, 200);
    const unread = r.body?.count ?? r.body?.unread ?? r.body?.unreadCount;
    check('GEN-01', 'GET /notifications/unread-count', 'unread count >= 1', '>=1', unread, unread >= 1);
    if (notes[0]) { r = await u.patch(`/notifications/${idOf(notes[0])}/read`); st('GEN-01', 'PATCH', '/notifications/:id/read', 'mark one read', r, 200); }
    if (notes[0]) { r = await other.patch(`/notifications/${idOf(notes[0])}/read`); st('GEN-01', 'PATCH', '/notifications/:id/read', "cannot mark another user's notification", r, [403, 404]); }
    r = await u.patch('/notifications/read-all'); st('GEN-01', 'PATCH', '/notifications/read-all', 'mark all read', r, 200);
    r = await u.get('/notifications/unread-count');
    check('GEN-01', 'GET /notifications/unread-count', 'zero after read-all', 0, r.body?.count ?? r.body?.unread ?? r.body?.unreadCount, (r.body?.count ?? r.body?.unread ?? r.body?.unreadCount) === 0);
    r = await u.get(`/flight-bookings/${b1id}/e-ticket`); st('FLT-23', 'GET', '/flight-bookings/:id/e-ticket', 'download e-ticket', r, 200);
    check('FLT-23', 'GET /flight-bookings/:id/e-ticket', 'is a PDF', '%PDF', Buffer.isBuffer(r.body) ? r.body.slice(0, 4).toString() : r.contentType, Buffer.isBuffer(r.body) && r.body.slice(0, 4).toString() === '%PDF');
    r = await other.get(`/flight-bookings/${b1id}/e-ticket`); st('ACC-11', 'GET', '/flight-bookings/:id/e-ticket', "other user's ticket hidden", r, [403, 404]);

    // FLT-28 seat selection
    r = await guest.get(`/flight-bookings/flights/${ctx.f2}/seats?cabin=Economy`); st('FLT-28', 'GET', '/flight-bookings/flights/:id/seats', 'free numbered seats', r, 200);
    r = await u.patch(`/flight-bookings/${b1id}/seat`, { passengerIndex: 0, seatNumber: 7 }); st('FLT-28', 'PATCH', '/flight-bookings/:id/seat', 'choose seat 7', r, 200);
    r = await u.patch(`/flight-bookings/${b1id}/seat`, { passengerIndex: 2, seatNumber: 8 }); st('FLT-28', 'PATCH', '/flight-bookings/:id/seat', 'infant cannot take a seat', r, 400);
    r = await u.patch(`/flight-bookings/${b1id}/seat`, { passengerIndex: 0, seatNumber: 999 }); st('FLT-28', 'PATCH', '/flight-bookings/:id/seat', 'seat number out of range', r, 400);
    const u2 = await H.newUser(db, 'seatmate');
    r = await u2.post('/flight-bookings/hold', { flightId: ctx.f2, cabinClass: 'Economy', passengers: [P('B', ADULT)] });
    const b2id = idOf(r.body);
    r = await u2.patch(`/flight-bookings/${b2id}/seat`, { passengerIndex: 0, seatNumber: 7 }); st('FLT-28', 'PATCH', '/flight-bookings/:id/seat', 'seat already taken by another booking', r, 400);
    r = await guest.get(`/flight-bookings/flights/${ctx.f2}/seats?cabin=Economy`);
    check('FLT-28', 'GET /flight-bookings/flights/:id/seats', 'seat 7 no longer listed', 'absent', (r.body?.numberedSeats || []).includes(7) ? 'present' : 'absent', !(r.body?.numberedSeats || []).includes(7));

    // FLT-22 expiry
    const beforeExp = await seats(ctx.f2);
    await db.collection('bookings').updateOne({ _id: new ObjectId(b2id) }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
    let expStatus;
    for (let i = 0; i < 12 && expStatus !== 'Expired'; i++) { await sleep(2500); expStatus = (await db.collection('bookings').findOne({ _id: new ObjectId(b2id) }))?.status; }
    check('FLT-22', 'cron expire-seat-holds', 'unpaid hold becomes Expired', 'Expired', expStatus, expStatus === 'Expired');
    check('FLT-22', 'cron expire-seat-holds', 'DB: held seat released', beforeExp + 1, await seats(ctx.f2), (await seats(ctx.f2)) === beforeExp + 1);
    r = await u2.post('/payments', { bookingType: 'flight', bookingId: b2id }); check('PAY-01', 'POST /payments', 'expired hold cannot be paid', '4xx', r.status, r.status >= 400 && r.status < 500);

    // FLT-25 list grouped
    r = await u.get('/flight-bookings'); st('FLT-25', 'GET', '/flight-bookings', 'my bookings', r, 200);
    check('FLT-25', 'GET /flight-bookings', 'grouped as upcoming / past / cancelled', 'upcoming,past,cancelled', Object.keys(r.body || {}).join(','), Array.isArray(r.body?.upcoming) && Array.isArray(r.body?.past) && Array.isArray(r.body?.cancelled));
    check('FLT-25', 'GET /flight-bookings', 'confirmed booking under upcoming', b1id, (r.body?.upcoming || []).map(idOf).join(','), (r.body?.upcoming || []).some((b) => idOf(b) === b1id));
    r = await other.get('/flight-bookings');
    check('ACC-11', 'GET /flight-bookings', "other user's list excludes my booking", 'absent', JSON.stringify(r.body).includes(b1id) ? 'present' : 'absent', !JSON.stringify(r.body).includes(b1id));

    // FLT-29 moderator views
    r = await mod.get(`/flights/${ctx.f2}/bookings?page=1&limit=10`); st('FLT-29', 'GET', '/flights/:id/bookings', 'moderator lists flight bookings', r, 200);
    check('FLT-29', 'GET /flights/:id/bookings', 'includes the confirmed booking', ref1, JSON.stringify(r.body).includes(ref1) ? ref1 : 'missing', JSON.stringify(r.body).includes(ref1));
    r = await mod.get(`/flights/${ctx.f2}/passengers/export`); st('FLT-29', 'GET', '/flights/:id/passengers/export', 'CSV export', r, 200);
    check('FLT-29', 'GET /flights/:id/passengers/export', 'CSV with passenger names', 'Adult', r.contentType, /csv/.test(r.contentType) && String(r.body).includes('Adult'));
    r = await modB.get(`/flights/${ctx.f2}/bookings?page=1&limit=10`); st('FLT-29', 'GET', '/flights/:id/bookings', "other airline's moderator forbidden", r, 403);
    r = await u.get(`/flights/${ctx.f2}/bookings?page=1&limit=10`); st('FLT-29', 'GET', '/flights/:id/bookings', 'traveler forbidden', r, 403);

    // ACC-17 / BON-01 admin
    r = await admin.get('/admin/bookings?type=flight&status=Confirmed'); st('ACC-17', 'GET', '/admin/bookings', 'admin lists confirmed flight bookings', r, 200);
    check('ACC-17', 'GET /admin/bookings', 'contains the confirmed booking', ref1, JSON.stringify(r.body).includes(ref1) ? ref1 : 'missing', JSON.stringify(r.body).includes(ref1));
    r = await u.get('/admin/bookings'); st('ACC-17', 'GET', '/admin/bookings', 'traveler forbidden', r, 403);
    const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10), to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    r = await admin.get(`/admin/analytics?from=${from}&to=${to}`); st('BON-01', 'GET', '/admin/analytics', 'analytics for period', r, 200);
    check('BON-01', 'GET /admin/analytics', 'revenue per provider includes 365 for QA Airways', 365, JSON.stringify(r.body).slice(0, 200), JSON.stringify(r.body).includes('365'));
    r = await admin.get(`/admin/analytics?from=${to}&to=${from}`); st('BON-01', 'GET', '/admin/analytics', 'from after to rejected', r, 400);

    // FLT-05 edits with bookings
    r = await mod.patch(`/flights/${ctx.f2}`, { departureAirport: 'LHR' }); st('FLT-05', 'PATCH', '/flights/:id', 'airport change blocked once booked', r, 400);
    check('FLT-05', 'PATCH /flights/:id', 'rejected for the airport reason', /airport/i, r.body?.message, /airport/i.test(JSON.stringify(r.body?.message)));
    r = await mod.patch(`/flights/${ctx.f2}/cabins/Economy`, { totalSeats: 1 }); st('FLT-05', 'PATCH', '/flights/:id/cabins/:cabinId', 'seat count below booked rejected', r, 400);
    check('FLT-05', 'PATCH /flights/:id/cabins/:cabinId', 'rejected for the booked-seats reason', /book|held|allocated|below/i, r.body?.message, /book|held|allocated|below/i.test(JSON.stringify(r.body?.message)));
    r = await mod.patch(`/flights/${ctx.f2}/cabins/Economy`, { totalSeats: 25 }); st('FLT-05', 'PATCH', '/flights/:id/cabins/:cabinId', 'seat count reduced but above booked', r, 200);
    const cab = (await db.collection('flights').findOne({ _id: new ObjectId(ctx.f2) }))?.cabins.find((c) => c.cabinClass === 'Economy');
    check('FLT-05', 'DB flights', 'total 25, available = 25 - booked/held', '25 / 23', `${cab?.totalSeats} / ${cab?.availableSeats}`, cab?.totalSeats === 25 && cab?.availableSeats === 23);
    r = await mod.patch(`/flights/${ctx.f2}/cabins/Economy`, { price: 999 }); st('FLT-05', 'PATCH', '/flights/:id/cabins/:cabinId', 'price change', r, 200);
    r = await u.get(`/flight-bookings/${b1id}`); check('FLT-05', 'GET /flight-bookings/:id', 'price change does not affect booking', 365, total(r.body), total(r.body) === 365);
    const d40 = ctx.date40;
    r = await mod.patch(`/flights/${ctx.f2}`, { departureLocalTime: `${d40}T19:00:00`, arrivalLocalTime: `${d40}T23:30:00` }); st('FLT-05', 'PATCH', '/flights/:id', 'time change', r, 200);
    r = await u.get('/notifications'); check('FLT-05', 'GET /notifications', 'passenger notified of schedule change', 'schedule change', items(r.body).map((n) => n.type).join(','), items(r.body).some((n) => /schedule|time|change/i.test(`${n.type} ${n.title}`)));
    r = await modB.patch(`/flights/${ctx.f2}`, { departureLocalTime: `${d40}T20:00:00` }); st('FLT-05', 'PATCH', '/flights/:id', "other airline can't edit", r, 403);

    // FLT-26 user cancellation with tier refund (40 days out -> 100%)
    r = await u.get(`/flight-bookings/${b1id}/cancellation-preview`); st('FLT-26', 'GET', '/flight-bookings/:id/cancellation-preview', 'refund preview', r, 200);
    check('FLT-09', 'GET /flight-bookings/:id/cancellation-preview', '40 days before -> 100% tier', '100% / 365', `${r.body?.percent}% / ${r.body?.amount}`, r.body?.percent === 100 && Math.abs(r.body?.amount - 365) < 0.01);
    const seatsBeforeCancel = await seats(ctx.f2);
    r = await other.post(`/flight-bookings/${b1id}/cancel`); st('ACC-11', 'POST', '/flight-bookings/:id/cancel', "cannot cancel another user's booking", r, [403, 404]);
    r = await u.post(`/flight-bookings/${b1id}/cancel`); st('FLT-26', 'POST', '/flight-bookings/:id/cancel', 'cancel confirmed booking', r, 200);
    const refundId = idOf(r.body?.refund);
    r = await u.get(`/flight-bookings/${b1id}`); check('FLT-26', 'GET /flight-bookings/:id', 'status Cancelled', 'Cancelled', r.body?.status, r.body?.status === 'Cancelled');
    check('FLT-26', 'DB flights', 'seats returned to inventory', seatsBeforeCancel + 2, await seats(ctx.f2), (await seats(ctx.f2)) === seatsBeforeCancel + 2);
    r = await u.get(`/bookings/flight/${b1id}/refund`); st('PAY-03', 'GET', '/bookings/:type/:id/refund', 'refund status on booking', r, 200);
    const refundStatus = r.body?.status;
    check('PAY-03', 'GET /bookings/flight/:id/refund', 'Stripe refund created (Pending or Refunded)', 'Pending|Refunded', refundStatus, /pending|refunded|succeeded/i.test(refundStatus || ''));
    if (refundId) { r = await u.get(`/refunds/${refundId}`); st('PAY-03', 'GET', '/refunds/:id', 'refund record', r, 200); }
    const refundDoc = await db.collection('refunds').findOne({ bookingId: new ObjectId(b1id) });
    check('PAY-03', 'DB refunds', 'refund amount 365 with Stripe refund id', '36500 + re_', `${refundDoc?.amount} ${refundDoc?.stripeRefundId?.slice(0, 3)}`, refundDoc?.amount === 36500 && /^re_/.test(refundDoc?.stripeRefundId || ''));
    r = await u.get('/notifications'); check('PAY-03', 'GET /notifications', 'cancellation/refund notification', 'refund', items(r.body).map((n) => n.type).join(','), items(r.body).some((n) => /refund|cancel/i.test(`${n.type} ${n.title}`)));
    r = await u.post(`/flight-bookings/${b1id}/cancel`); check('GEN-11', 'POST /flight-bookings/:id/cancel', 'cancelled booking cannot be cancelled again', '4xx', r.status, r.status >= 400 && r.status < 500);

    // tier 50% (10 days before), then cancellation after departure blocked
    const cu = await H.newUser(db, 'tierflyer');
    r = await cu.post('/flight-bookings/hold', { flightId: ctx.fSoon, cabinClass: 'Economy', passengers: [P('T', ADULT)] });
    const bt = idOf(r.body);
    await cu.post(`/bookings/flight/${bt}/accept-policies`, { accepted: true });
    const pt = await payWithTestCard(cu, 'flight', bt); await deliverPaymentSucceeded(pt.pi);
    r = await cu.get(`/flight-bookings/${bt}/cancellation-preview`);
    check('FLT-09', 'GET /flight-bookings/:id/cancellation-preview', '3 days before -> tier 0 (0%)', '0%', `${r.body?.percent}%`, r.body?.percent === 0);
    await db.collection('flights').updateOne({ _id: new ObjectId(ctx.fSoon) }, { $set: { departureTimeUtc: new Date(Date.now() - 60000) } });
    r = await cu.post(`/flight-bookings/${bt}/cancel`); st('FLT-26', 'POST', '/flight-bookings/:id/cancel', 'cancellation after departure blocked', r, 400);
    await db.collection('flights').updateOne({ _id: new ObjectId(ctx.fSoon) }, { $set: { departureTimeUtc: new Date(Date.now() + 3 * 86400000), status: 'Scheduled' } });

    // FLT-27 flight change (bonus): QA600 (200) -> QA700 (250) same route, other date
    const chu = await H.newUser(db, 'changer');
    r = await chu.post('/flight-bookings/hold', { flightId: ctx.fChange, cabinClass: 'Economy', passengers: [P('C', ADULT)] });
    const bc = idOf(r.body);
    await chu.post(`/bookings/flight/${bc}/accept-policies`, { accepted: true });
    const pc = await payWithTestCard(chu, 'flight', bc); await deliverPaymentSucceeded(pc.pi);
    r = await chu.get(`/flight-bookings/${bc}/change-preview?flightId=${ctx.f2}&leg=outbound`);
    st('FLT-27', 'GET', '/flight-bookings/:id/change-preview', 'preview change to same-route flight', r, 200);
    r = await chu.get(`/flight-bookings/${bc}/change-preview?flightId=${ctx.fReturn}&leg=outbound`);
    st('FLT-27', 'GET', '/flight-bookings/:id/change-preview', 'different route rejected', r, 400);
    r = await chu.patch(`/flight-bookings/${bc}/change-flight`, { flightId: ctx.fCancelLater });
    st('FLT-27', 'PATCH', '/flight-bookings/:id/change-flight', 'change to higher fare holds replacement', r, [200, 201]);
    const changeId = r.body?.changeId;
    const changePay = await chu.post('/payments', { bookingType: 'flight_change', bookingId: changeId });
    st('FLT-27', 'POST', '/payments', 'fare difference payment (bookingType flight_change)', changePay, 201);
    check('FLT-27', 'POST /payments', 'fare difference = 50', 50, changePay.body?.amount, changePay.body?.amount === 50);
    if (changePay.status === 201) {
      const cpi = await stripe.paymentIntents.confirm(changePay.body.clientSecret.split('_secret_')[0], { payment_method: 'pm_card_visa', return_url: 'http://localhost/return' });
      await deliverPaymentSucceeded(cpi);
      let moved;
      for (let i = 0; i < 6 && !moved; i++) { await sleep(500); r = await chu.get(`/flight-bookings/${bc}`); moved = (r.body?.flightId?._id ?? r.body?.flightId) === ctx.fCancelLater; }
      check('FLT-27', 'GET /flight-bookings/:id', 'booking moved to the new flight after payment', ctx.fCancelLater, r.body?.flightId?._id ?? r.body?.flightId, moved);
    }

    // FLT-06 provider cancels flight -> 100% refund
    const pc6 = await H.newUser(db, 'provcancel');
    r = await pc6.post('/flight-bookings/hold', { flightId: ctx.fCancelLater, cabinClass: 'Economy', passengers: [P('Z', ADULT)] });
    const b6 = idOf(r.body);
    await pc6.post(`/bookings/flight/${b6}/accept-policies`, { accepted: true });
    const p6 = await payWithTestCard(pc6, 'flight', b6); await deliverPaymentSucceeded(p6.pi);
    const pending = await H.newUser(db, 'pendinghold');
    r = await pending.post('/flight-bookings/hold', { flightId: ctx.fCancelLater, cabinClass: 'Economy', passengers: [P('Y', ADULT)] });
    const b6p = idOf(r.body);
    r = await modB.post(`/flights/${ctx.fCancelLater}/cancel`); st('FLT-06', 'POST', '/flights/:id/cancel', "other airline can't cancel", r, 403);
    r = await mod.post(`/flights/${ctx.fCancelLater}/cancel`); st('FLT-06', 'POST', '/flights/:id/cancel', 'airline cancels flight', r, 200);
    const fc = await db.collection('flights').findOne({ _id: new ObjectId(ctx.fCancelLater) });
    check('FLT-06', 'DB flights', 'flight Cancelled', 'Cancelled', fc?.status, fc?.status === 'Cancelled');
    r = await pc6.get(`/flight-bookings/${b6}`); check('FLT-06', 'GET /flight-bookings/:id', 'confirmed booking Cancelled', 'Cancelled', r.body?.status, r.body?.status === 'Cancelled');
    const rf6 = await db.collection('refunds').findOne({ bookingId: new ObjectId(b6) });
    check('FLT-06', 'DB refunds', '100% refund (250) issued', 25000, rf6?.amount, rf6?.amount === 25000);
    const pend = await db.collection('bookings').findOne({ _id: new ObjectId(b6p) });
    check('FLT-06', 'DB bookings', 'pending hold released', 'not Pending Payment', pend?.status, pend?.status !== 'Pending Payment');
    r = await pc6.get('/notifications'); check('FLT-06', 'GET /notifications', 'passenger notified', 'flight cancelled', items(r.body).map((n) => n.type).join(','), items(r.body).some((n) => /cancel/i.test(`${n.type} ${n.title}`)));
    r = await guest.get(`/flights/search?departureAirport=CAI&arrivalAirport=DXB&departureDate=${ctx.localDT(50, '').slice(0, 10)}`);
    check('FLT-06', 'GET /flights/search', 'cancelled flight hidden from search', 'absent', (r.body?.flights || []).some((f) => f.flightNumber === 'QA700') ? 'present' : 'absent', !(r.body?.flights || []).some((f) => f.flightNumber === 'QA700'));

    Object.assign(ctx, { flyer: u, confirmedFlightBooking: bt, flightUser: cu });
  },
};
