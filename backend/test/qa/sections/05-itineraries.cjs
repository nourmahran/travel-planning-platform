/* eslint-disable */
'use strict';
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

module.exports = {
  name: '5. Itineraries and budgeting',
  async run(ctx, H) {
    const { Client, guest, check, expectStatus: st, idOf, items, sleep, payWithTestCard, deliverPaymentSucceeded, ObjectId, PNG_1PX, GIF_1PX, imageForm } = H;
    const db = ctx.db;
    let r;
    const owner = await H.newUser(db, 'planner');
    const other = await H.newUser(db, 'cloner');
    const start = day(30);

    // ITN-01
    r = await guest.post('/itineraries', { title: 'Trip', countries: ['EG'], startDate: start }); st('ITN-01', 'POST', '/itineraries', 'guest must log in', r, 401);
    r = await owner.post('/itineraries', { title: 'x'.repeat(101), countries: ['EG'], startDate: start }); st('ITN-01', 'POST', '/itineraries', 'title over 100 chars rejected', r, 400);
    r = await owner.post('/itineraries', { title: 'Trip', countries: [], startDate: start }); st('ITN-01', 'POST', '/itineraries', 'at least one country required', r, 400);
    r = await owner.post('/itineraries', { title: 'Trip', countries: ['ZZ'], startDate: start }); st('ITN-01', 'POST', '/itineraries', 'country not in reference list rejected', r, [400, 404]);
    r = await owner.post('/itineraries', { title: 'Trip', countries: ['EG'], startDate: 'tomorrow' }); st('ITN-01', 'POST', '/itineraries', 'invalid start date', r, 400);
    r = await owner.post('/itineraries', { title: 'Egypt and Dubai', countries: ['EG', 'AE'], startDate: start, currency: 'USD' });
    st('ITN-01', 'POST', '/itineraries', 'create itinerary', r, 201);
    const itn = idOf(r.body);
    check('ITN-01', 'POST /itineraries', 'private by default', 'private', r.body?.visibility, r.body?.visibility === 'private');
    r = await owner.patch(`/itineraries/${itn}`, { title: 'Egypt & Dubai' }); st('ITN-01', 'PATCH', '/itineraries/:id', 'edit title', r, 200);
    r = await other.patch(`/itineraries/${itn}`, { title: 'Hijack' }); st('ACC-11', 'PATCH', '/itineraries/:id', "cannot edit someone else's itinerary", r, [403, 404]);
    r = await other.get(`/itineraries/${itn}`); st('ACC-11', 'GET', '/itineraries/:id', 'private itinerary hidden from others', r, [403, 404]);
    r = await guest.get(`/itineraries/public/${itn}`); st('ITN-20', 'GET', '/itineraries/public/:id', 'private itinerary not public', r, 404);

    // ITN-05 days
    r = await owner.post(`/itineraries/${itn}/days`, { cityId: 'atlantis' }); st('ITN-05', 'POST', '/itineraries/:id/days', 'city not in list rejected', r, [400, 404]);
    r = await owner.post(`/itineraries/${itn}/days`, {}); st('ITN-09', 'POST', '/itineraries/:id/days', 'day requires a city', r, 400);
    const dayIds = [];
    for (const city of ['cairo', 'cairo', 'dubai', 'cairo']) { r = await owner.post(`/itineraries/${itn}/days`, { cityId: city }); dayIds.push(idOf(r.body?.days ? r.body.days[r.body.days.length - 1] : r.body)); }
    st('ITN-05', 'POST', '/itineraries/:id/days', 'add day', r, 201);
    r = await owner.get(`/itineraries/${itn}`); st('ITN-03', 'GET', '/itineraries/:id', 'full detail', r, 200);
    let days = r.body?.days || [];
    dayIds.splice(0, dayIds.length, ...days.map((d) => d.id));
    check('ITN-05', 'GET /itineraries/:id', 'days numbered 1..4 with dates from start date', `${start}..${addDays(start, 3)}`, days.map((d) => `${d.dayNumber}:${d.date}`).join(' '), days.length === 4 && days.every((d, i) => d.dayNumber === i + 1 && d.date === addDays(start, i)));
    r = await owner.patch(`/itineraries/${itn}/days/${dayIds[3]}`, { notes: 'Last day: shopping' }); st('ITN-05', 'PATCH', '/itineraries/:id/days/:dayId', 'edit day notes', r, 200);

    // ITN-10 activities + ITN-14 budgets + ITN-16 transport
    r = await owner.post(`/itineraries/${itn}/days/${dayIds[0]}/activities`, { title: 'Pyramids', attractionId: 'att-1', startTime: '09:00', cost: 20 });
    st('ITN-10', 'POST', '/itineraries/:id/days/:dayId/activities', 'add activity with cost', r, 201);
    const act = idOf((r.body?.days || []).flatMap((d) => d.activities || []).find((a) => a.title === 'Pyramids')) || idOf(r.body);
    r = await owner.post(`/itineraries/${itn}/days/${dayIds[0]}/activities`, { title: '' }); st('ITN-10', 'POST', '/itineraries/:id/days/:dayId/activities', 'empty name rejected', r, 400);
    r = await owner.post(`/itineraries/${itn}/days/${dayIds[0]}/activities`, { title: 'Bad', cost: -1 }); st('ITN-10', 'POST', '/itineraries/:id/days/:dayId/activities', 'negative cost rejected', r, 400);
    r = await owner.patch(`/activities/${act}`, { notes: 'Bring water' }); st('ITN-10', 'PATCH', '/activities/:id', 'edit activity', r, 200);
    r = await other.patch(`/activities/${act}`, { notes: 'x' }); st('ACC-11', 'PATCH', '/activities/:id', "cannot edit another user's activity", r, [403, 404]);
    r = await owner.post(`/itineraries/${itn}/days/${dayIds[0]}/budgets`, { category: 'food', amount: 30 }); st('ITN-14', 'POST', '/itineraries/:id/days/:dayId/budgets', 'add food budget', r, 201);
    const budgetId = idOf((r.body?.days || []).flatMap((d) => d.budgets || []).find((b) => b.category === 'food')) || idOf(r.body);
    await owner.post(`/itineraries/${itn}/days/${dayIds[2]}/budgets`, { category: 'accommodation', amount: 100 });
    r = await owner.post(`/itineraries/${itn}/days/${dayIds[0]}/budgets`, { category: 'food', amount: -5 }); st('ITN-14', 'POST', '/itineraries/:id/days/:dayId/budgets', 'negative amount rejected', r, 400);
    r = await owner.post(`/itineraries/${itn}/days/${dayIds[0]}/budgets`, { category: 'shopping', amount: 5 }); st('ITN-14', 'POST', '/itineraries/:id/days/:dayId/budgets', 'unknown category rejected', r, 400);
    r = await owner.patch(`/budgets/${budgetId}`, { amount: 40 }); st('ITN-14', 'PATCH', '/budgets/:id', 'edit budget', r, 200);
    r = await owner.post(`/itineraries/${itn}/transport-costs`, { mode: 'flight', fromCityId: 'cairo', toCityId: 'dubai', amount: 200, date: addDays(start, 2) }); st('ITN-16', 'POST', '/itineraries/:id/transport-costs', 'add transport cost', r, 201);
    const tcId = idOf((r.body?.transportCosts || [])[0]) || idOf(r.body);
    r = await owner.post(`/itineraries/${itn}/transport-costs`, { fromCityId: 'cairo', toCityId: 'dubai', amount: 10 }); st('ITN-16', 'POST', '/itineraries/:id/transport-costs', 'mode required', r, 400);
    r = await owner.patch(`/transport-costs/${tcId}`, { amount: 210 }); st('ITN-16', 'PATCH', '/transport-costs/:id', 'edit transport cost', r, 200);

    // ITN-14 / ITN-09 summary
    r = await owner.get(`/itineraries/${itn}/budget-summary`); st('ITN-14', 'GET', '/itineraries/:id/budget-summary', 'budget summary', r, 200);
    const sum = r.body || {};
    // food 40 + accommodation 100 + activity 20 + transport 210 = 370
    check('ITN-14', 'GET /itineraries/:id/budget-summary', 'grand total = budgets + activity costs + transport', 370, sum.totals?.grandTotal, sum.totals?.grandTotal === 370);
    check('ITN-14', 'GET /itineraries/:id/budget-summary', 'activity cost counted under activities', 20, sum.totals?.categories?.activities, sum.totals?.categories?.activities === 20);
    check('ITN-14', 'GET /itineraries/:id/budget-summary', 'per-day breakdown', 4, (sum.byDay || []).length, (sum.byDay || []).length === 4);
    const groups = (sum.byCityGroup || []).map((g) => `${g.cityId}x${g.dayCount}`).join(',');
    check('ITN-09', 'GET /itineraries/:id/budget-summary', 'consecutive same-city days grouped', 'cairox2,dubaix1,cairox1', groups, groups === 'cairox2,dubaix1,cairox1');

    // ITN-18 currency
    r = await owner.get(`/itineraries/${itn}/budget-summary?currency=EUR`);
    const conv = r.status === 200 ? r.body : null;
    check('ITN-18', 'GET /itineraries/:id/budget-summary?currency=EUR', 'converted with rate date (FXRatesAPI)', 'EUR + rateDate', conv ? `${conv.currency} ${conv.rateDate} ${conv.rateSource}` : `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`, conv && conv.currency === 'EUR' && !!conv.rateDate && conv.totals?.grandTotal !== 370);
    const rateDocs = await db.collection('exchangerates').countDocuments() + await db.collection('exchange_rates').countDocuments();
    check('ITN-18', 'DB exchange rates', 'rates cached in database', '>=1', rateDocs, rateDocs >= 1);
    r = await owner.get(`/itineraries/${itn}/budget-summary?currency=XYZ`); st('ITN-18', 'GET', '/itineraries/:id/budget-summary', 'unsupported currency rejected', r, 400);
    r = await guest.get('/currency/convert?amount=100&from=USD&to=EGP'); st('ITN-18', 'GET', '/currency/convert', 'convert amount', r, 200);
    r = await guest.get('/currency/convert?amount=100&from=USD&to=QQQ'); st('ITN-18', 'GET', '/currency/convert', 'invalid currency code', r, 400);
    r = await guest.get('/currency/convert?amount=-1&from=USD&to=EGP'); st('ITN-18', 'GET', '/currency/convert', 'negative amount', r, 400);
    // fallback: cached rate used when API unavailable is covered by unit tests in src/currency (ExchangeRatesService)

    // ITN-08 reorder + ITN-07 delete
    const reordered = [dayIds[2], dayIds[0], dayIds[1], dayIds[3]];
    r = await owner.patch(`/itineraries/${itn}/days/reorder`, { dayIds: reordered }); st('ITN-08', 'PATCH', '/itineraries/:id/days/reorder', 'move day 3 to first', r, 200);
    r = await owner.get(`/itineraries/${itn}`); days = r.body?.days || [];
    check('ITN-08', 'GET /itineraries/:id', 'renumbered with recalculated dates', 'dubai first on start date', days.map((d) => `${d.dayNumber}:${d.cityId}:${d.date}`).join(' '), days[0]?.cityId === 'dubai' && days[0]?.date === start && days[1]?.date === addDays(start, 1));
    r = await owner.patch(`/itineraries/${itn}/days/reorder`, { dayIds: reordered.slice(0, 3) }); st('ITN-08', 'PATCH', '/itineraries/:id/days/reorder', 'incomplete day list rejected', r, 400);
    r = await owner.del(`/itineraries/${itn}/days/${dayIds[3]}`); st('ITN-07', 'DELETE', '/itineraries/:id/days/:dayId', 'delete day', r, [200, 204]);
    r = await owner.get(`/itineraries/${itn}`); days = r.body?.days || [];
    check('ITN-07', 'GET /itineraries/:id', 'remaining days renumbered', '1,2,3', days.map((d) => d.dayNumber).join(','), days.map((d) => d.dayNumber).join(',') === '1,2,3');

    // ITN-12 / GEN-08 activity images (multipart upload)
    const fiveMb = Buffer.concat([PNG_1PX, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    r = await owner.raw('POST', `/activities/${act}/images`, imageForm('images', [{ data: PNG_1PX, type: 'image/png', name: 'a.png' }]));
    st('ITN-12', 'POST', '/activities/:id/images', 'upload PNG to activity (multipart)', r, [200, 201]);
    const uploadedJson = JSON.stringify(r.body);
    r = await owner.raw('POST', `/activities/${act}/images`, imageForm('images', [{ data: GIF_1PX, type: 'image/gif', name: 'a.gif' }]));
    st('GEN-08', 'POST', '/activities/:id/images', 'GIF rejected', r, [400, 415]);
    r = await owner.raw('POST', `/activities/${act}/images`, imageForm('images', [{ data: fiveMb, type: 'image/png', name: 'big.png' }]));
    st('GEN-08', 'POST', '/activities/:id/images', 'image over 5 MB rejected', r, [400, 413]);
    r = await owner.raw('POST', `/activities/${act}/images`, imageForm('images', Array.from({ length: 5 }, (_, i) => ({ data: PNG_1PX, type: 'image/png', name: `m${i}.png` }))));
    st('GEN-08', 'POST', '/activities/:id/images', 'more than 5 images per activity rejected', r, [400, 409]);
    r = await other.raw('POST', `/activities/${act}/images`, imageForm('images', [{ data: PNG_1PX, type: 'image/png', name: 'x.png' }]));
    st('ACC-11', 'POST', '/activities/:id/images', "cannot add images to another user's activity", r, [403, 404]);
    const imgUrl = /"url":"([^"]+)"/.exec(uploadedJson)?.[1];
    r = await owner.get(`/itineraries/${itn}`);
    const shownImages = (r.body?.days || []).flatMap((d) => d.activities || []).flatMap((a) => a.images || []);
    check('ITN-12', 'GET /itineraries/:id', 'uploaded activity image appears in itinerary detail', '>=1 image', shownImages.length, shownImages.length >= 1);
    if (imgUrl) {
      const path = imgUrl.replace(/^\/api/, '');
      r = await owner.get(path);
      check('GEN-08', 'GET /media/:id', 'owner fetches uploaded image by URL', '200 image/png', `${r.status} ${r.contentType}`, r.status === 200 && /image\/png/.test(r.contentType));
      r = await other.get(path);
      check('GEN-08', 'GET /media/:id', "private itinerary's image hidden from others", '403/404', r.status, [403, 404].includes(r.status));
      const imgId = path.split('/').pop();
      r = await owner.del(`/activities/${act}/images/${imgId}`, { confirm: true });
      check('ITN-12', 'DELETE /activities/:id/images/:imageId', 'remove image', '200', r.status, r.status === 200);
      r = await owner.get(`/itineraries/${itn}`);
      const left = (r.body?.days || []).flatMap((d) => d.activities || []).flatMap((a) => a.images || []).filter((im) => (im.id || im._id) === imgId);
      check('ITN-12', 'GET /itineraries/:id', 'removed image gone from itinerary detail', 0, left.length, left.length === 0);
    }

    // ITN-20 public + ITN-21 search/clone
    r = await owner.patch(`/itineraries/${itn}`, { visibility: 'public' }); st('ITN-20', 'PATCH', '/itineraries/:id', 'make public', r, 200);
    r = await guest.get(`/itineraries/public/${itn}`); st('ITN-21', 'GET', '/itineraries/public/:id', 'guest views public itinerary', r, 200);
    check('ITN-21', 'GET /itineraries/public/:id', 'shows author, days and budget', 'author+days', JSON.stringify(Object.keys(r.body || {})).slice(0, 150), (r.body?.author || r.body?.authorName || r.body?.owner) && (r.body?.days || []).length === 3);
    r = await guest.get('/itineraries/public/search?q=Dubai'); st('ITN-21', 'GET', '/itineraries/public/search', 'keyword search', r, 200);
    check('ITN-21', 'GET /itineraries/public/search?q=Dubai', 'finds the public itinerary', itn, JSON.stringify(r.body).includes(itn) ? 'found' : 'missing', JSON.stringify(r.body).includes(itn));
    r = await guest.get('/itineraries/public/search?city=dubai&minDays=2&maxDays=5');
    check('ITN-21', 'GET /itineraries/public/search?city&minDays&maxDays', 'city and duration filters', 'found', JSON.stringify(r.body).includes(itn) ? 'found' : 'missing', JSON.stringify(r.body).includes(itn));
    r = await guest.get('/itineraries/public/search?minDays=10');
    check('ITN-21', 'GET /itineraries/public/search?minDays=10', 'excluded by duration', 'absent', JSON.stringify(r.body).includes(itn) ? 'present' : 'absent', !JSON.stringify(r.body).includes(itn));
    r = await guest.get('/itineraries/public/search?minDays=5&maxDays=2'); st('ITN-21', 'GET', '/itineraries/public/search', 'minDays > maxDays rejected', r, 400);
    r = await other.patch(`/itineraries/${itn}`, { title: 'Hijack' }); st('ITN-20', 'PATCH', '/itineraries/:id', 'public itinerary read-only to others', r, [403, 404]);
    r = await guest.post(`/itineraries/${itn}/clone`, {}); st('ITN-21', 'POST', '/itineraries/:id/clone', 'guest cannot clone', r, 401);
    r = await other.post(`/itineraries/${itn}/clone`, {}); st('ITN-21', 'POST', '/itineraries/:id/clone', 'registered user clones', r, 201);
    const clone = r.body; const cloneId = idOf(clone);
    check('ITN-21', 'POST /itineraries/:id/clone', 'clone is private and credits the author', 'private + clonedFrom', `${clone?.visibility} ${clone?.clonedFrom?.authorName}`, clone?.visibility === 'private' && clone?.clonedFrom?.itineraryId === itn);
    check('ITN-21', 'POST /itineraries/:id/clone', 'clone has all days, activities and budgets', '3 days', (clone?.days || []).length, (clone?.days || []).length === 3 && (clone?.days || []).some((d) => (d.activities || []).length) && (clone?.days || []).some((d) => (d.budgets || []).length));
    await other.patch(`/itineraries/${cloneId}`, { title: 'My copy' });
    r = await owner.get(`/itineraries/${itn}`);
    check('ITN-21', 'GET /itineraries/:id', 'original unaffected by clone edits', 'Egypt & Dubai', r.body?.title, r.body?.title === 'Egypt & Dubai');
    r = await owner.post(`/itineraries/${cloneId}/clone`, {}); st('ITN-21', 'POST', '/itineraries/:id/clone', "cannot clone someone else's private itinerary", r, [403, 404]);

    // ITN-03 list
    r = await owner.get('/itineraries'); st('ITN-03', 'GET', '/itineraries', 'list own itineraries', r, 200);
    check('ACC-11', 'GET /itineraries', "list shows only the owner's itineraries", 'no clone', JSON.stringify(r.body).includes(cloneId) ? 'leak' : 'own only', !JSON.stringify(r.body).includes(cloneId));

    // ITN-25 / ITN-26
    r = await owner.get(`/itineraries/${itn}/hotels?guests=2&rooms=1`); st('ITN-25', 'GET', '/itineraries/:id/hotels', 'hotels for city groups', r, 200);
    check('ITN-25', 'GET /itineraries/:id/hotels', 'uses group dates (check-out = day after last day)', 'group dates', JSON.stringify(r.body).slice(0, 160), /checkIn|checkOut/.test(JSON.stringify(r.body)));
    r = await owner.get(`/itineraries/${itn}/flights?originAirport=CAI&tripType=round-trip&passengers=1`); st('ITN-26', 'GET', '/itineraries/:id/flights', 'flights from origin to first-day city', r, 200);
    r = await owner.get(`/itineraries/${itn}/flights?originAirport=XXX`); st('ITN-26', 'GET', '/itineraries/:id/flights', 'unknown origin airport', r, [400, 404]);
    r = await other.get(`/itineraries/${itn}/flights?originAirport=CAI`); check('ITN-26', 'GET /itineraries/:id/flights', 'non-owner blocked', '403/404', r.status, [403, 404].includes(r.status));

    // ITN-28 PDF (bonus)
    r = await owner.get(`/itineraries/${itn}/pdf`); st('ITN-28', 'GET', '/itineraries/:id/pdf', 'export itinerary PDF', r, 200);
    check('ITN-28', 'GET /itineraries/:id/pdf', 'is a PDF', '%PDF', Buffer.isBuffer(r.body) ? r.body.slice(0, 4).toString() : r.contentType, Buffer.isBuffer(r.body) && r.body.slice(0, 4).toString() === '%PDF');
    r = await other.get(`/itineraries/${cloneId}/pdf`); st('ITN-28', 'GET', '/itineraries/:id/pdf', 'owner can export own clone', r, 200);
    r = await guest.get(`/itineraries/${itn}/pdf`); st('ITN-28', 'GET', '/itineraries/:id/pdf', 'guest blocked', r, 401);

    // ITN-27 link confirmed bookings (bonus)
    const fu = ctx.flightUser; const fb = ctx.confirmedFlightBooking;
    if (fu && fb) {
      r = await fu.post('/itineraries', { title: 'With flight', countries: ['EG', 'AE'], startDate: start });
      st('ITN-27', 'POST', '/itineraries', 'booking owner creates itinerary', r, 201);
      const it2 = idOf(r.body);
      r = await fu.post(`/itineraries/${it2}/days`, { cityId: 'dubai' });
      st('ITN-27', 'POST', '/itineraries/:id/days', 'add day for the flight', r, 201);
      r = await fu.get(`/itineraries/${it2}`);
      const d2 = (r.body?.days || [])[0]?.id;
      r = await fu.post(`/itineraries/${it2}/days/${d2}/bookings/flight/${fb}`); st('ITN-27', 'POST', '/itineraries/:id/days/:dayId/bookings/:type/:bookingId', 'link confirmed flight booking', r, [200, 201]);
      r = await fu.get(`/itineraries/${it2}/budget-summary`);
      check('ITN-27', 'GET /itineraries/:id/budget-summary', 'booking amount feeds the budget', '>0', r.body?.totals?.grandTotal, r.body?.totals?.grandTotal > 0);
      r = await fu.post(`/itineraries/${it2}/days/${d2}/bookings/flight/${fb}`); check('ITN-27', 'POST .../bookings/flight/:id', 'linking twice is rejected or idempotent', '200/201/409', r.status, [200, 201, 409].includes(r.status));
      r = await owner.post(`/itineraries/${itn}/days/${dayIds[0]}/bookings/flight/${fb}`); st('ITN-27', 'POST', '/itineraries/:id/days/:dayId/bookings/:type/:bookingId', "cannot link someone else's booking", r, [403, 404]);
      r = await fu.del(`/itineraries/${it2}/days/${d2}/bookings/flight/${fb}`); st('ITN-27', 'DELETE', '/itineraries/:id/days/:dayId/bookings/:type/:bookingId', 'unlink booking', r, [200, 204]);
      r = await fu.del('/users/me', { confirm: true });
      check('ACC-12', 'DELETE /users/me', 'deactivation blocked while an upcoming Confirmed booking exists', '4xx', r.status, r.status >= 400 && r.status < 500);
    } else check('ITN-27', 'setup', 'confirmed flight booking available', 'yes', 'no (section 3 not run)', false);

    // BON-02 favourite public itinerary
    r = await other.post(`/favourites/itinerary/${itn}`); st('BON-02', 'POST', '/favourites/:type/:id', 'save public itinerary', r, [200, 201]);
    r = await other.post(`/favourites/itinerary/${cloneId}`); st('BON-02', 'POST', '/favourites/:type/:id', 'cannot favourite a private itinerary', r, [400, 403, 404]);

    // ITN-20 private again removes it from search; ITN-01 delete keeps clones
    r = await owner.patch(`/itineraries/${itn}`, { visibility: 'private' });
    r = await guest.get('/itineraries/public/search?q=Dubai');
    check('ITN-20', 'GET /itineraries/public/search', 'private again -> removed immediately', 'absent', JSON.stringify(r.body).includes(itn) ? 'present' : 'absent', !JSON.stringify(r.body).includes(itn));
    r = await owner.del(`/itineraries/${itn}`); st('ITN-01', 'DELETE', '/itineraries/:id', 'delete itinerary', r, [200, 204]);
    r = await other.get(`/itineraries/${cloneId}`); st('ITN-01', 'GET', '/itineraries/:id', 'clone survives deletion of original', r, 200);

    Object.assign(ctx, { itineraryOwner: other, publicItineraryCandidate: cloneId });
  },
};
