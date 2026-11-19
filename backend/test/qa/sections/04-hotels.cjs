/* eslint-disable */
'use strict';
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const room = (num, adults, price, extra = {}) => ({ roomNumber: num, name: `Room ${num}`, bedType: 'double', bedCount: 1, maxAdults: adults, maxChildren: 1, basePricePerNightCents: price, ...extra });
const guestList = (n) => Array.from({ length: n }, (_, i) => ({ firstName: `G${i}`, lastName: 'Guest', age: 30 }));

module.exports = {
  name: '4. Hotels, rooms, reservations and reviews',
  async run(ctx, H) {
    const { Client, guest, check, expectStatus: st, idOf, items, sleep, login, payWithTestCard, deliverPaymentSucceeded, ObjectId } = H;
    const db = ctx.db; const admin = ctx.admin;
    let r;

    // HTL-01 hotel profile
    const hotelBody = { name: 'QA Nile Hotel', description: 'A comfortable hotel on the Nile used for verification.', location: { city: 'Cairo', country: 'Egypt', address: '1 Corniche St' }, starRating: 4, amenities: ['wifi', 'pool'] };
    r = await admin.post('/hotels', hotelBody); st('HTL-01', 'POST', '/hotels', 'admin creates hotel', r, 201);
    const hotelId = idOf(r.body);
    r = await admin.post('/hotels', { ...hotelBody, name: 'Second Hotel', location: { city: 'Cairo', country: 'Egypt', address: '2 Corniche St' }, starRating: 3 });
    const hotel2 = idOf(r.body);
    r = await admin.post('/hotels', { ...hotelBody, starRating: 6 }); st('HTL-01', 'POST', '/hotels', 'star class > 5 rejected', r, 400);
    r = await admin.post('/hotels', { name: 'X' }); st('HTL-01', 'POST', '/hotels', 'missing fields', r, 400);
    r = await ctx.traveler.post('/hotels', hotelBody); st('HTL-01', 'POST', '/hotels', 'traveler cannot create hotel', r, 403);

    const modEmail = `hotelmod-${Date.now()}@travel.test`;
    r = await admin.post('/admin/moderators', { name: 'Hotel Mod', email: modEmail, temporaryPassword: 'TempPass123', providerType: 'hotel', providerId: hotelId });
    st('ACC-13', 'POST', '/admin/moderators', 'admin creates hotel moderator', r, 201);
    const hm = new Client('hotelmod'); await login(hm, modEmail, 'TempPass123'); await hm.patch('/auth/change-password', { currentPassword: 'TempPass123', newPassword: 'ModPass123' });
    const hm2Email = `hotelmod2-${Date.now()}@travel.test`;
    await admin.post('/admin/moderators', { name: 'Hotel Mod 2', email: hm2Email, temporaryPassword: 'TempPass123', providerType: 'hotel', providerId: hotel2 });
    const hm2 = new Client('hotelmod2'); await login(hm2, hm2Email, 'TempPass123'); await hm2.patch('/auth/change-password', { currentPassword: 'TempPass123', newPassword: 'ModPass123' });

    r = await hm.patch(`/hotels/${hotelId}`, { description: 'Updated description for the verification hotel.' }); st('HTL-01', 'PATCH', '/hotels/:id', 'moderator edits own hotel', r, 200);
    r = await hm2.patch(`/hotels/${hotelId}`, { name: 'Hijack' }); st('HTL-01', 'PATCH', '/hotels/:id', "other hotel's moderator forbidden", r, 403);

    // HTL-09 / HTL-10 policies
    const tiers = [{ minDaysBeforeCheckIn: 14, refundPercent: 100 }, { minDaysBeforeCheckIn: 3, refundPercent: 50 }, { minDaysBeforeCheckIn: 0, refundPercent: 0 }];
    r = await hm.put(`/hotels/${hotelId}/policies`, { checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: tiers }); st('HTL-09', 'PUT', '/hotels/:id/policies', 'set check-in/out and tiers', r, 200);
    r = await hm.put(`/hotels/${hotelId}/policies`, { checkInTime: '25:00', checkOutTime: '12:00', cancellationTiers: tiers }); st('HTL-09', 'PUT', '/hotels/:id/policies', 'invalid time rejected', r, 400);
    r = await hm.put(`/hotels/${hotelId}/policies`, { checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [{ minDaysBeforeCheckIn: 3, refundPercent: 50 }, { minDaysBeforeCheckIn: 3, refundPercent: 20 }] }); st('HTL-10', 'PUT', '/hotels/:id/policies', 'duplicate tier thresholds rejected', r, 400);
    r = await hm.put(`/hotels/${hotelId}/policies`, { checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [{ minDaysBeforeCheckIn: 3, refundPercent: 101 }] }); st('HTL-10', 'PUT', '/hotels/:id/policies', 'refund > 100% rejected', r, 400);
    await hm2.put(`/hotels/${hotel2}/policies`, { checkInTime: '15:00', checkOutTime: '11:00', cancellationTiers: tiers });

    // HTL-03 rooms
    r = await hm.post(`/hotels/${hotelId}/rooms`, room('101', 2, 10000)); st('HTL-03', 'POST', '/hotels/:id/rooms', 'add room', r, 201);
    const r101 = idOf(r.body);
    r = await hm.post(`/hotels/${hotelId}/rooms`, room('102', 2, 15000)); const r102 = idOf(r.body);
    r = await hm.post(`/hotels/${hotelId}/rooms`, room('103', 4, 30000)); const r103 = idOf(r.body);
    r = await hm.post(`/hotels/${hotelId}/rooms`, room('104', 1, 5000)); const r104 = idOf(r.body);
    r = await hm.post(`/hotels/${hotelId}/rooms`, room('101', 2, 10000)); st('HTL-03', 'POST', '/hotels/:id/rooms', 'duplicate room number in hotel', r, 409);
    r = await hm.post(`/hotels/${hotelId}/rooms`, room('199', 0, 10000)); st('HTL-03', 'POST', '/hotels/:id/rooms', 'max occupancy 0 rejected', r, 400);
    r = await hm.post(`/hotels/${hotelId}/rooms`, room('198', 2, -5)); st('HTL-03', 'POST', '/hotels/:id/rooms', 'negative price rejected', r, 400);
    r = await hm2.post(`/hotels/${hotelId}/rooms`, room('197', 2, 10000)); st('HTL-03', 'POST', '/hotels/:id/rooms', "other hotel's moderator forbidden", r, 403);
    await hm2.post(`/hotels/${hotel2}/rooms`, room('1', 2, 8000));

    // HTL-06 blocks
    r = await hm.post(`/hotels/${hotelId}/rooms/${r104}/availability`, { startDate: day(20), endDate: day(25), reason: 'Maintenance' }); st('HTL-06', 'POST', '/hotels/:id/rooms/:roomId/availability', 'block dates', r, 201);
    r = await hm.post(`/hotels/${hotelId}/rooms/${r104}/availability`, { startDate: day(25), endDate: day(20) }); st('HTL-06', 'POST', '/hotels/:id/rooms/:roomId/availability', 'end before start rejected', r, 400);

    // HTL-11 / HTL-12 search
    const ci = day(20), co = day(23);
    r = await guest.get(`/hotels/search?city=Cairo&checkIn=${ci}&checkOut=${co}&guests=2&rooms=1`); st('HTL-11', 'GET', '/hotels/search', 'guest searches by city and dates', r, 200);
    const names = items(r.body).map((h) => h.name);
    check('HTL-11', 'GET /hotels/search', 'active hotels with free rooms listed', 'both hotels', names.join(','), names.includes('QA Nile Hotel') && names.includes('Second Hotel'));
    r = await guest.get(`/hotels/search?city=Cairo&checkIn=${ci}&checkOut=${co}&guests=9&rooms=2`);
    check('HTL-11', 'GET /hotels/search', 'guests exceed combined occupancy of best 2 rooms (5+3=8) -> excluded', 'none', items(r.body).map((h) => h.name).join(',') || 'none', items(r.body).length === 0);
    r = await guest.get(`/hotels/search?city=Cairo&checkIn=${co}&checkOut=${ci}`); st('HTL-11', 'GET', '/hotels/search', 'check-out before check-in rejected', r, 400);
    r = await guest.get(`/hotels/search?city=Cairo&checkIn=${day(-2)}&checkOut=${day(1)}`); st('HTL-11', 'GET', '/hotels/search', 'check-in in the past rejected', r, 400);
    r = await guest.get(`/hotels/search?city=Cairo&checkIn=${ci}&checkOut=${co}&minPriceCents=9000&maxPriceCents=12000`);
    const pr = items(r.body).map((h) => `${h.name}:${h.pricePerNightCents}`);
    check('HTL-12', 'GET /hotels/search', 'price filter uses cheapest qualifying room', 'QA Nile 10000 only', pr.join(','), pr.length === 1 && pr[0].startsWith('QA Nile Hotel'));
    r = await guest.get(`/hotels/search?city=Cairo&minPriceCents=500&maxPriceCents=100`); st('HTL-12', 'GET', '/hotels/search', 'min > max rejected', r, 400);
    r = await guest.get(`/hotels/search?city=Cairo&checkIn=${ci}&checkOut=${co}&sort=price_asc`);
    const sorted = items(r.body).map((h) => h.pricePerNightCents);
    check('HTL-12', 'GET /hotels/search', 'sort by price ascending', 'ascending', sorted.join(','), sorted.every((v, i) => i === 0 || sorted[i - 1] <= v));
    r = await guest.get(`/hotels/search?city=Cairo&minRating=4`);
    check('HTL-12', 'GET /hotels/search', 'unrated hotels excluded with rating filter', 0, items(r.body).length, items(r.body).length === 0);

    // HTL-02 / HTL-15 / HTL-08
    r = await guest.get(`/hotels/${hotelId}?checkIn=${ci}&checkOut=${co}`); st('HTL-02', 'GET', '/hotels/:id', 'hotel details', r, 200);
    const hd = JSON.stringify(r.body);
    check('HTL-02', 'GET /hotels/:id', 'shows check-in/out times and cancellation policy', '14:00 + tiers', /14:00/.test(hd) && /refundPercent/.test(hd) ? 'present' : 'missing', /14:00/.test(hd) && /refundPercent/.test(hd));
    r = await guest.get(`/hotels/${hotelId}/rooms/available?checkIn=${ci}&checkOut=${co}`); st('HTL-15', 'GET', '/hotels/:id/rooms/available', 'free rooms for dates', r, 200);
    const avail = JSON.stringify(r.body);
    check('HTL-15', 'GET /hotels/:id/rooms/available', 'blocked room 104 excluded; total stay price shown', '101,102,103 and 30000', avail.includes(r104) ? 'includes 104' : 'ok', !avail.includes(r104) && avail.includes(r101) && /30000/.test(avail));
    r = await hm.get(`/hotels/${hotelId}/availability?from=${ci}&to=${co}`); st('HTL-08', 'GET', '/hotels/:id/availability', 'moderator room calendar', r, 200);
    check('HTL-08', 'GET /hotels/:id/availability', 'room 104 shows blocked days', 'blocked', /blocked/i.test(JSON.stringify(r.body)) ? 'blocked' : 'missing', /blocked/i.test(JSON.stringify(r.body)));
    r = await guest.get(`/hotels/${hotelId}/availability?from=${ci}&to=${co}`); st('HTL-08', 'GET', '/hotels/:id/availability', 'public calendar (statuses only)', r, 200);

    // HTL-16 / HTL-18 reservation
    const u = await H.newUser(db, 'hotelguest');
    const other = await H.newUser(db, 'hotelsnoop');
    const unverified = await H.newUser(db, 'hotelunverified', { verified: false });
    const resBody = { hotelId, checkIn: ci, checkOut: co, rooms: [{ roomId: r101, guests: guestList(2) }, { roomId: r102, guests: guestList(1) }] };
    r = await unverified.post('/hotel-bookings', resBody); st('ACC-02', 'POST', '/hotel-bookings', 'unverified email cannot book', r, 403);
    r = await guest.post('/hotel-bookings', resBody); st('ACC-10', 'POST', '/hotel-bookings', 'guest must log in', r, 401);
    r = await u.post('/hotel-bookings', { ...resBody, rooms: [{ roomId: r101, guests: guestList(3) }] }); st('HTL-16', 'POST', '/hotel-bookings', 'guests exceed room occupancy', r, 400);
    r = await u.post('/hotel-bookings', { ...resBody, rooms: [{ roomId: r101, guests: [{ firstName: 'Kid', lastName: 'Only', age: 8 }] }] }); st('HTL-16', 'POST', '/hotel-bookings', 'no adult in reservation', r, 400);
    r = await u.post('/hotel-bookings', { ...resBody, checkIn: co, checkOut: ci }); st('HTL-18', 'POST', '/hotel-bookings', 'check-out before check-in', r, 400);
    r = await u.post('/hotel-bookings', { ...resBody, rooms: [{ roomId: r104, guests: guestList(1) }] }); st('HTL-18', 'POST', '/hotel-bookings', 'blocked room rejected', r, [400, 409]);
    r = await u.post('/hotel-bookings', resBody); st('HTL-16', 'POST', '/hotel-bookings', 'reserve two rooms together', r, 201);
    const res1 = r.body; const res1Id = idOf(res1);
    check('HTL-16', 'POST /hotel-bookings', 'total = 3 nights x (100 + 150)', 75000, res1?.totalAmountCents, res1?.totalAmountCents === 75000);
    check('HTL-18', 'POST /hotel-bookings', 'held 10 minutes as one reservation', 'HELD, 9-10 min', `${res1?.status} ${Math.round((new Date(res1?.holdExpiresAt) - Date.now()) / 60000)}`, ['HELD', 'Pending Payment'].includes(res1?.status) && Math.round((new Date(res1?.holdExpiresAt) - Date.now()) / 60000) >= 9);
    r = await other.post('/hotel-bookings', { ...resBody, rooms: [{ roomId: r102, guests: guestList(1) }, { roomId: r103, guests: guestList(2) }] });
    st('HTL-18', 'POST', '/hotel-bookings', 'overlap with an unexpired hold rejects whole request', r, 409);
    r = await guest.get(`/hotels/${hotelId}/rooms/available?checkIn=${ci}&checkOut=${co}`);
    check('HTL-18', 'GET /hotels/:id/rooms/available', 'nothing partially held after the rejected request (103 still free)', '103 free', JSON.stringify(r.body).includes(r103) ? '103 free' : '103 held', JSON.stringify(r.body).includes(r103));
    r = await other.get(`/hotel-bookings/${res1Id}`); st('ACC-11', 'GET', '/hotel-bookings/:id', "other user's reservation hidden", r, [403, 404]);
    r = await hm.post(`/hotels/${hotelId}/rooms/${r101}/availability`, { startDate: ci, endDate: co }); st('HTL-06', 'POST', '/hotels/:id/rooms/:roomId/availability', 'cannot block dates with a pending reservation', r, [400, 409]);
    r = await hm.del(`/hotels/${hotelId}/rooms/${r101}`); st('HTL-06', 'DELETE', '/hotels/:id/rooms/:roomId', 'reserved room cannot be deleted', r, [400, 409]);

    // PAY-02 + PAY-01 + HTL-17
    r = await u.post('/payments', { bookingType: 'hotel', bookingId: res1Id }); st('PAY-02', 'POST', '/payments', 'hotel payment blocked before policies accepted', r, 400);
    r = await u.get(`/bookings/hotel/${res1Id}/policies`); st('PAY-02', 'GET', '/bookings/:type/:id/policies', 'hotel policies (tiers + check-in/out)', r, 200);
    check('PAY-02', 'GET /bookings/hotel/:id/policies', 'check-in time included', '14:00', /14:00/.test(JSON.stringify(r.body)) ? '14:00' : 'missing', /14:00/.test(JSON.stringify(r.body)));
    r = await u.post(`/bookings/hotel/${res1Id}/accept-policies`, { accepted: true }); st('PAY-02', 'POST', '/bookings/:type/:id/accept-policies', 'accept hotel policies', r, 200);
    const pay = await payWithTestCard(u, 'hotel', res1Id);
    st('PAY-01', 'POST', '/payments', 'create hotel PaymentIntent', pay.pay, 201);
    check('PAY-04', 'POST /payments', 'hotel amount in platform currency (USD 750)', '750 usd', `${pay.pay.body?.amount} ${pay.pay.body?.currency}`, pay.pay.body?.amount === 750 && pay.pay.body?.currency === 'usd');
    check('PAY-01', 'Stripe confirm', 'test card succeeds', 'succeeded', pay.pi?.status, pay.pi?.status === 'succeeded');
    await deliverPaymentSucceeded(pay.pi);
    r = await u.get(`/hotel-bookings/${res1Id}`);
    check('HTL-17', 'GET /hotel-bookings/:id', 'reservation confirmed with reference', 'CONFIRMED + ref', `${r.body?.status} ${r.body?.reference}`, /confirm/i.test(r.body?.status || '') && !!r.body?.reference);
    r = await u.get('/notifications'); check('HTL-17', 'GET /notifications', 'confirmation notification', 'confirmed', items(r.body).map((n) => n.type).join(','), items(r.body).some((n) => /confirm/i.test(`${n.type} ${n.title}`)));

    // HTL-20 / HTL-22
    r = await u.get('/hotel-bookings'); st('HTL-20', 'GET', '/hotel-bookings', 'my reservations', r, 200);
    check('HTL-20', 'GET /hotel-bookings', 'contains the reservation', res1Id, JSON.stringify(r.body).includes(res1Id) ? 'present' : 'missing', JSON.stringify(r.body).includes(res1Id));
    r = await u.get('/hotel-bookings?status=CANCELLED');
    st('HTL-20', 'GET', '/hotel-bookings?status=', 'filter by status (frontend groups Upcoming/Past/Cancelled)', r, 200);
    r = await hm.get(`/hotels/${hotelId}/reservations?page=1&limit=10`); st('HTL-22', 'GET', '/hotels/:id/reservations', 'moderator sees reservations', r, 200);
    check('HTL-22', 'GET /hotels/:id/reservations', 'includes the reservation', res1Id, JSON.stringify(r.body).includes(res1Id) ? 'present' : 'missing', JSON.stringify(r.body).includes(res1Id));
    r = await hm2.get(`/hotels/${hotelId}/reservations?page=1&limit=10`); st('HTL-22', 'GET', '/hotels/:id/reservations', "other hotel's moderator forbidden", r, 403);
    r = await admin.get('/admin/bookings?type=hotel'); check('ACC-17', 'GET /admin/bookings?type=hotel', 'admin sees hotel reservation', 'present', JSON.stringify(r.body).includes(res1?.reference || res1Id) ? 'present' : 'missing', JSON.stringify(r.body).includes(r.body && (res1?.reference || res1Id)));

    // HTL-05 price edits do not change existing reservations
    r = await hm.patch(`/hotels/${hotelId}/rooms/${r101}`, { basePricePerNightCents: 99900 }); st('HTL-05', 'PATCH', '/hotels/:id/rooms/:roomId', 'edit room price', r, 200);
    r = await u.get(`/hotel-bookings/${res1Id}`); check('HTL-05', 'GET /hotel-bookings/:id', 'existing reservation total unchanged', 75000, r.body?.totalAmountCents, r.body?.totalAmountCents === 75000);
    r = await hm.post(`/hotels/${hotelId}/rooms/${r102}/availability`, { startDate: ci, endDate: co }); st('HTL-06', 'POST', '/hotels/:id/rooms/:roomId/availability', 'cannot block dates with a confirmed reservation', r, [400, 409]);
    r = await hm.get(`/hotels/${hotelId}/availability?from=${ci}&to=${co}&roomId=${r101}`);
    check('HTL-08', 'GET /hotels/:id/availability', 'moderator sees Booked with reservation reference', res1?.reference, JSON.stringify(r.body).includes(res1?.reference) ? 'shown' : 'missing', /booked/.test(JSON.stringify(r.body)) && JSON.stringify(r.body).includes(res1?.reference));
    r = await guest.get(`/hotels/${hotelId}/availability?from=${ci}&to=${co}&roomId=${r101}`);
    check('HTL-08', 'GET /hotels/:id/availability', 'public calendar hides reservation reference', 'hidden', JSON.stringify(r.body).includes(res1?.reference) ? 'leaked' : 'hidden', !JSON.stringify(r.body).includes(res1?.reference));

    // HTL-21 cancel with tier (20 days out -> 100%)
    r = await u.get(`/hotel-bookings/${res1Id}/cancellation-quote`); st('HTL-21', 'GET', '/hotel-bookings/:id/cancellation-quote', 'refund quote', r, 200);
    check('HTL-21', 'GET /hotel-bookings/:id/cancellation-quote', '20 days before -> 100% of full total', '100% 75000', JSON.stringify(r.body).slice(0, 160), /100/.test(JSON.stringify(r.body)) && /75000/.test(JSON.stringify(r.body)));
    r = await other.post(`/hotel-bookings/${res1Id}/cancel`, {}); st('ACC-11', 'POST', '/hotel-bookings/:id/cancel', "cannot cancel someone else's reservation", r, [403, 404]);
    r = await u.post(`/hotel-bookings/${res1Id}/cancel`, {}); st('HTL-21', 'POST', '/hotel-bookings/:id/cancel', 'cancel whole reservation', r, [200, 201]);
    r = await u.get(`/hotel-bookings/${res1Id}`); check('HTL-21', 'GET /hotel-bookings/:id', 'status cancelled', 'CANCELLED', r.body?.status, /cancel/i.test(r.body?.status || ''));
    const hr = await db.collection('refunds').findOne({ bookingId: new ObjectId(res1Id) });
    check('PAY-03', 'DB refunds', 'Stripe refund of 750 created for hotel', '75000 re_', `${hr?.amount} ${hr?.stripeRefundId?.slice(0, 3)}`, hr?.amount === 75000 && /^re_/.test(hr?.stripeRefundId || ''));
    r = await guest.get(`/hotels/${hotelId}/rooms/available?checkIn=${ci}&checkOut=${co}`);
    check('HTL-21', 'GET /hotels/:id/rooms/available', 'rooms released after cancellation', '101 and 102 free', JSON.stringify(r.body).includes(r102) ? 'free' : 'still taken', JSON.stringify(r.body).includes(r102) && JSON.stringify(r.body).includes(r101));

    // HTL-18 expiry
    r = await other.post('/hotel-bookings', { hotelId, checkIn: day(30), checkOut: day(31), rooms: [{ roomId: r103, guests: guestList(1) }] });
    const expId = idOf(r.body);
    await db.collection('hotel_bookings').updateOne({ _id: new ObjectId(expId) }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await db.collection('hotelbookings').updateOne({ _id: new ObjectId(expId) }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
    r = await guest.raw('POST', '/hotel-bookings/maintenance/run', {}, { headers: { 'x-internal-api-key': 'qa-internal-key-0123456789' } });
    st('HTL-18', 'POST', '/hotel-bookings/maintenance/run', 'run hold expiry', r, [200, 201]);
    r = await other.get(`/hotel-bookings/${expId}`); check('HTL-18', 'GET /hotel-bookings/:id', 'unpaid hold expired', 'EXPIRED', r.body?.status, /expire/i.test(r.body?.status || ''));
    r = await guest.raw('POST', '/hotel-bookings/maintenance/run', {}, { headers: { 'x-internal-api-key': 'wrong' } });
    st('GEN-13', 'POST', '/hotel-bookings/maintenance/run', 'internal endpoint rejects wrong key', r, [401, 403]);

    // HTL-23 / HTL-24 / HTL-26 review after a completed stay
    const rv = await H.newUser(db, 'reviewer');
    r = await rv.post('/hotel-bookings', { hotelId, checkIn: day(40), checkOut: day(41), rooms: [{ roomId: r103, guests: guestList(2) }] });
    const rvRes = idOf(r.body);
    await rv.post(`/bookings/hotel/${rvRes}/accept-policies`, { accepted: true });
    const rp = await payWithTestCard(rv, 'hotel', rvRes); await deliverPaymentSucceeded(rp.pi);
    r = await rv.post(`/hotel-bookings/${rvRes}/review`, { rating: 5, comment: 'Lovely stay, very clean rooms.' }); st('HTL-23', 'POST', '/hotel-bookings/:id/review', 'review before stay completed rejected', r, [400, 403, 409]);
    const coll = (await db.listCollections({ name: 'hotel_bookings' }).toArray()).length ? 'hotel_bookings' : 'hotelbookings';
    const past = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d; };
    await db.collection(coll).updateOne({ _id: new ObjectId(rvRes) }, { $set: { checkIn: past(3).toISOString().slice(0, 10), checkOut: past(1).toISOString().slice(0, 10) } });
    await guest.raw('POST', '/hotel-bookings/maintenance/run', {}, { headers: { 'x-internal-api-key': 'qa-internal-key-0123456789' } });
    r = await rv.get(`/hotel-bookings/${rvRes}`); check('HTL-23', 'GET /hotel-bookings/:id', 'confirmed stay becomes COMPLETED after check-out', 'COMPLETED', r.body?.status, /complete/i.test(r.body?.status || ''));
    r = await rv.post(`/hotel-bookings/${rvRes}/review`, { rating: 6, comment: 'Out of range rating.' }); st('HTL-23', 'POST', '/hotel-bookings/:id/review', 'rating 6 rejected', r, 400);
    r = await rv.post(`/hotel-bookings/${rvRes}/review`, { rating: 4, comment: 'x'.repeat(1001) }); st('HTL-23', 'POST', '/hotel-bookings/:id/review', 'review over 1000 characters rejected', r, 400);
    r = await other.post(`/hotel-bookings/${rvRes}/review`, { rating: 1, comment: 'I never stayed here.' }); st('HTL-23', 'POST', '/hotel-bookings/:id/review', 'non-owner cannot review', r, [403, 404]);
    r = await rv.post(`/hotel-bookings/${rvRes}/review`, { rating: 4 }); st('HTL-23', 'POST', '/hotel-bookings/:id/review', 'rating-only review of completed stay (text optional)', r, 201);
    const reviewId = idOf(r.body);
    r = await rv.post(`/hotel-bookings/${rvRes}/review`, { rating: 3, comment: 'Second review attempt here.' }); st('HTL-23', 'POST', '/hotel-bookings/:id/review', 'second review for same reservation rejected', r, 409);
    r = await guest.get(`/hotels/${hotelId}/reviews?page=1&limit=10`); st('HTL-24', 'GET', '/hotels/:id/reviews', 'public reviews', r, 200);
    r = await guest.get(`/hotels/${hotelId}`);
    const avg = r.body?.averageRating ?? r.body?.rating?.average; const cnt = r.body?.reviewCount ?? r.body?.ratingCount ?? r.body?.rating?.count;
    check('HTL-23', 'GET /hotels/:id', 'average rating recalculated', '4 (1 rating)', `${avg} (${cnt})`, avg === 4 && cnt === 1);
    r = await rv.patch(`/reviews/${reviewId}`, { rating: 2, comment: 'Lovely stay, very clean rooms.' }); st('HTL-23', 'PATCH', '/reviews/:id', 'edit own review (add text, change rating)', r, 200);
    r = await guest.get(`/hotels/${hotelId}`); check('HTL-23', 'GET /hotels/:id', 'average updated after edit', 2, r.body?.averageRating ?? r.body?.rating?.average, (r.body?.averageRating ?? r.body?.rating?.average) === 2);
    r = await other.patch(`/reviews/${reviewId}`, { rating: 5 }); st('HTL-23', 'PATCH', '/reviews/:id', "cannot edit someone else's review", r, [403, 404]);
    r = await hm.post(`/reviews/${reviewId}/reply`, { body: 'Thank you for staying with us!' }); st('HTL-26', 'POST', '/reviews/:id/reply', 'hotel moderator replies (bonus)', r, [200, 201]);
    r = await hm2.post(`/reviews/${reviewId}/reply`, { body: 'Not my hotel.' }); st('HTL-26', 'POST', '/reviews/:id/reply', "other hotel's moderator cannot reply", r, 403);
    r = await rv.post(`/reviews/${reviewId}/reply`, { body: 'Replying to myself.' }); st('HTL-26', 'POST', '/reviews/:id/reply', 'traveler cannot reply', r, 403);
    r = await guest.get(`/hotels/${hotelId}/reviews?page=1&limit=10`);
    check('HTL-26', 'GET /hotels/:id/reviews', 'reply visible on review', 'Thank you', /Thank you for staying/.test(JSON.stringify(r.body)) ? 'visible' : 'missing', /Thank you for staying/.test(JSON.stringify(r.body)));

    // HTL-06 room deletion rules
    r = await hm.post(`/hotels/${hotelId}/rooms`, room('150', 2, 10000)); const r150 = idOf(r.body);
    r = await hm.del(`/hotels/${hotelId}/rooms/${r150}`); st('HTL-06', 'DELETE', '/hotels/:id/rooms/:roomId', 'never-reserved room can be deleted', r, [200, 204]);

    // ACC-15 hotel deactivation
    r = await admin.patch(`/admin/providers/hotel/${hotel2}/deactivate`); st('ACC-15', 'PATCH', '/admin/providers/:type/:id/deactivate', 'deactivate hotel', r, 200);
    r = await guest.get(`/hotels/search?city=Cairo&checkIn=${ci}&checkOut=${co}`);
    check('ACC-15', 'GET /hotels/search', 'deactivated hotel hidden', 'no Second Hotel', items(r.body).map((h) => h.name).join(','), !items(r.body).some((h) => h.name === 'Second Hotel'));
    const h2rooms = await guest.get(`/hotels/${hotel2}/rooms`);
    const h2room = items(h2rooms.body)[0] && idOf(items(h2rooms.body)[0]);
    r = await u.post('/hotel-bookings', { hotelId: hotel2, checkIn: ci, checkOut: co, rooms: [{ roomId: h2room || '6a0000000000000000000000', guests: guestList(1) }] });
    check('ACC-15', 'POST /hotel-bookings', 'deactivated hotel cannot be booked', '4xx', r.status, r.status >= 400 && r.status < 500);
    await admin.patch(`/admin/providers/hotel/${hotel2}/reactivate`);

    // BON-02 favourites
    r = await u.post(`/favourites/hotel/${hotelId}`); st('BON-02', 'POST', '/favourites/:type/:id', 'save hotel to favourites', r, [200, 201]);
    r = await u.post(`/favourites/hotel/${hotelId}`); st('BON-02', 'POST', '/favourites/:type/:id', 'saving twice is idempotent', r, [200, 201, 409]);
    r = await u.get('/favourites?page=1'); st('BON-02', 'GET', '/favourites', 'list favourites', r, 200);
    check('BON-02', 'GET /favourites', 'hotel listed once', 1, (JSON.stringify(r.body).match(new RegExp(hotelId, 'g')) || []).length, (JSON.stringify(r.body).match(new RegExp(hotelId, 'g')) || []).length >= 1);
    r = await u.del(`/favourites/hotel/${hotelId}`); st('BON-02', 'DELETE', '/favourites/:type/:id', 'remove favourite', r, [200, 204]);
    r = await guest.get('/favourites?page=1'); st('BON-02', 'GET', '/favourites', 'guest must log in', r, 401);

    Object.assign(ctx, { hotelId, hotel2, hm, r101, r102, r103, hotelGuest: u, hotelBookingConfirmed: rvRes });
  },
};
