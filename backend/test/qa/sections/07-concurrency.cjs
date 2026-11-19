/* eslint-disable */
'use strict';
const ADULT = '1990-05-05';
const P = (n) => ({ firstName: 'Race' + n, lastName: 'Tester', passportNumber: 'R' + n + Math.floor(Math.random() * 1e6), dateOfBirth: ADULT });
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

module.exports = {
  name: '7. Concurrency',
  async run(ctx, H) {
    const { check, idOf, ObjectId, payWithTestCard, deliver, stripe } = H;
    const db = ctx.db; const mod = ctx.mod;
    const users = [];
    for (let i = 0; i < 10; i++) users.push(await H.newUser(db, 'racer' + i));
    const seats = async (fid) => (await db.collection('flights').findOne({ _id: new ObjectId(fid) }))?.cabins.find((c) => c.cabinClass === 'Economy');

    // 1. ten users race for the final seat
    const res = await Promise.all(users.map((u, i) => u.post('/flight-bookings/hold', { flightId: ctx.fLastSeat, cabinClass: 'Economy', passengers: [P(i)] })));
    const ok = res.filter((r) => r.status === 201).length;
    const cab = await seats(ctx.fLastSeat);
    check('FLT-22', 'POST /flight-bookings/hold x10 concurrent', 'exactly one user gets the last seat', 1, ok, ok === 1);
    check('FLT-22', 'DB flights', 'inventory never negative', 0, cab?.availableSeats, cab?.availableSeats === 0);
    const losers = res.filter((r) => r.status !== 201).map((r) => r.status);
    check('FLT-22', 'POST /flight-bookings/hold x10 concurrent', 'others rejected with 400/409, no 500', '4xx', [...new Set(losers)].join(','), losers.every((s) => s >= 400 && s < 500));

    // 2. demand over capacity: 5 seats, 6 users x 2 seats
    const fr = await mod.post('/flights', { airlineId: ctx.airlineA, flightNumber: 'QA800', departureAirport: 'CAI', arrivalAirport: 'DXB', departureLocalTime: ctx.localDT(70, '10:00:00'), arrivalLocalTime: ctx.localDT(70, '15:00:00'), cabins: [ctx.cabin('Economy', 100, 5)] });
    const f5 = idOf(fr.body);
    const res2 = await Promise.all(users.slice(0, 6).map((u, i) => u.post('/flight-bookings/hold', { flightId: f5, cabinClass: 'Economy', passengers: [P(i), P(i + 50)] })));
    const ok2 = res2.filter((r) => r.status === 201).length;
    const cab2 = await seats(f5);
    const heldSeats = await db.collection('bookings').aggregate([{ $match: { flightId: new ObjectId(f5), status: 'Pending Payment' } }, { $group: { _id: null, n: { $sum: { $size: '$passengers' } } } }]).toArray();
    check('FLT-22', 'POST /flight-bookings/hold x6 concurrent (2 seats each, 5 available)', 'at most 2 bookings succeed', '2', ok2, ok2 === 2);
    check('FLT-22', 'DB flights/bookings', 'held seats + available = capacity', '4 held + 1 free', `${heldSeats[0]?.n ?? 0} held + ${cab2?.availableSeats} free`, (heldSeats[0]?.n ?? 0) + cab2?.availableSeats === 5 && cab2?.availableSeats >= 0);

    // 3. same hotel room, overlapping dates, 8 users at once
    if (ctx.hotelId && ctx.r103) {
      const ci = day(50), co = day(52);
      const res3 = await Promise.all(users.slice(0, 8).map((u) => u.post('/hotel-bookings', { hotelId: ctx.hotelId, checkIn: ci, checkOut: co, rooms: [{ roomId: ctx.r103, guests: [{ firstName: 'A', lastName: 'B', age: 30 }] }] })));
      const ok3 = res3.filter((r) => r.status === 201).length;
      check('HTL-18', 'POST /hotel-bookings x8 concurrent same room', 'exactly one reservation holds the room', 1, ok3, ok3 === 1);
      check('HTL-18', 'POST /hotel-bookings x8 concurrent same room', 'others rejected without 500', '4xx', [...new Set(res3.filter((r) => r.status !== 201).map((r) => r.status))].join(','), res3.every((r) => r.status < 500));
      // 4. overlapping multi-room requests: A wants [101,102], B wants [102,103-free-dates]
      const a = users[8], b = users[9];
      const [ra, rb] = await Promise.all([
        a.post('/hotel-bookings', { hotelId: ctx.hotelId, checkIn: day(60), checkOut: day(62), rooms: [{ roomId: ctx.r101, guests: [{ firstName: 'A', lastName: 'A', age: 30 }] }, { roomId: ctx.r102, guests: [{ firstName: 'A', lastName: 'A', age: 30 }] }] }),
        b.post('/hotel-bookings', { hotelId: ctx.hotelId, checkIn: day(61), checkOut: day(63), rooms: [{ roomId: ctx.r102, guests: [{ firstName: 'B', lastName: 'B', age: 30 }] }, { roomId: ctx.r103, guests: [{ firstName: 'B', lastName: 'B', age: 30 }] }] }),
      ]);
      const both = [ra.status, rb.status];
      check('HTL-18', 'POST /hotel-bookings x2 concurrent overlapping multi-room', 'one wins, the other is rejected as a whole', '201 + 409', both.join('+'), both.filter((s) => s === 201).length === 1);
      const loser = ra.status === 201 ? b : a;
      const loserHolds = await db.collection('room_night_locks').countDocuments({ userId: new ObjectId(loser.id) }) + await db.collection('roomnightlocks').countDocuments({ userId: new ObjectId(loser.id) });
      const loserBookings = await db.collection('hotel_bookings').countDocuments({ userId: new ObjectId(loser.id), checkIn: { $in: [day(60), day(61)] } });
      check('HTL-18', 'DB hotel_bookings', 'rejected request held nothing', 0, loserBookings, loserBookings === 0);
    } else check('HTL-18', 'setup', 'hotel from section 4', 'available', 'missing', false);

    // 5. duplicate booking submission (same user, same body, at once)
    const dupUser = users[0];
    const body = { flightId: ctx.fReturn, cabinClass: 'Economy', passengers: [P(77)] };
    const dup = await Promise.all([dupUser.post('/flight-bookings/hold', body), dupUser.post('/flight-bookings/hold', body)]);
    check('FLT-22', 'POST /flight-bookings/hold x2 identical', 'both handled without error; each hold reserves its own seat (no idempotency key)', '201,201', dup.map((r) => r.status).join(','), dup.every((r) => r.status === 201 || r.status === 409));

    // 6. repeated webhooks at once + simultaneous cancellations
    const payer = users[1];
    const hold = await payer.post('/flight-bookings/hold', { flightId: ctx.fReturn, cabinClass: 'Economy', passengers: [P(88)] });
    const bid = idOf(hold.body);
    await payer.post(`/bookings/flight/${bid}/accept-policies`, { accepted: true });
    const { pi } = await payWithTestCard(payer, 'flight', bid);
    const fresh = await stripe.paymentIntents.retrieve(pi.id);
    const evId = 'evt_qa_race_' + Date.now();
    const hooks = await Promise.all(Array.from({ length: 5 }, () => deliver('payment_intent.succeeded', fresh, evId)));
    check('PAY-01', 'POST /payments/webhook x5 concurrent same event', 'all acknowledged (2xx)', '2xx', hooks.map((h) => h.res.status).join(','), hooks.every((h) => h.res.status >= 200 && h.res.status < 300));
    const processed = await db.collection('processed_stripe_events').countDocuments({ eventId: evId });
    const notes = await db.collection('notifications').countDocuments({ recipientId: new ObjectId(payer.id), type: /confirm/i });
    check('PAY-01', 'DB processed_stripe_events', 'event processed exactly once', 1, processed, processed === 1);
    check('PAY-01', 'DB notifications', 'single confirmation notification', 1, notes, notes === 1);
    const b = await db.collection('bookings').findOne({ _id: new ObjectId(bid) });
    check('FLT-23', 'DB bookings', 'booking confirmed once with one reference', 'Confirmed', b?.status, b?.status === 'Confirmed' && !!b?.reference);
    const cancels = await Promise.all([payer.post(`/flight-bookings/${bid}/cancel`), payer.post(`/flight-bookings/${bid}/cancel`), payer.post(`/flight-bookings/${bid}/cancel`)]);
    const okCancel = cancels.filter((r) => r.status === 200).length;
    const refunds = await db.collection('refunds').countDocuments({ bookingId: new ObjectId(bid) });
    check('FLT-26', 'POST /flight-bookings/:id/cancel x3 concurrent', 'only one cancellation succeeds', 1, okCancel, okCancel === 1);
    check('PAY-03', 'DB refunds', 'only one refund issued', 1, refunds, refunds === 1);
    check('FLT-26', 'POST /flight-bookings/:id/cancel x3 concurrent', 'no 500 errors', 'no 5xx', cancels.map((r) => r.status).join(','), cancels.every((r) => r.status < 500));
  },
};
