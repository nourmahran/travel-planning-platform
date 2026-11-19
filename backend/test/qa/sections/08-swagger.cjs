/* eslint-disable */
'use strict';
// Every endpoint listed in section 8 of the project description (8.1 - 8.9).
const PDF = `
POST /api/auth/register ACC-01
GET /api/auth/verify-email ACC-02
POST /api/auth/login ACC-04
POST /api/auth/logout ACC-06
POST /api/auth/forgot-password ACC-07
POST /api/auth/reset-password ACC-07
POST /api/admin/users/{id}/reset-password ACC-07a
PATCH /api/auth/change-password ACC-08
GET /api/auth/me ACC-19
GET /api/users/me ACC-11
PATCH /api/users/me ACC-09
DELETE /api/users/me ACC-12
POST /api/admin/moderators ACC-13
GET /api/admin/accounts ACC-14
PATCH /api/admin/accounts/{id}/suspend ACC-15
PATCH /api/admin/accounts/{id}/reactivate ACC-15
PATCH /api/admin/providers/{type}/{id}/deactivate ACC-15
PATCH /api/admin/providers/{type}/{id}/reactivate ACC-15
GET /api/admin/bookings ACC-17
GET /api/admin/reports GEN-09
PATCH /api/admin/reports/{id} GEN-10
DELETE /api/admin/content/{type}/{id} GEN-10
GET /api/admin/audit-logs GEN-07
POST /api/airlines FLT-01
GET /api/airlines/{id} FLT-01
PATCH /api/airlines/{id} FLT-01
GET /api/airports FLT-02
POST /api/flights FLT-03
GET /api/flights/search FLT-11
GET /api/flights/{id} FLT-17
PATCH /api/flights/{id} FLT-05
POST /api/flights/{id}/cancel FLT-06
POST /api/flights/{id}/cabins FLT-04
PATCH /api/flights/{id}/cabins/{cabinId} FLT-04
PUT /api/airlines/{id}/baggage-policy FLT-08
PUT /api/airlines/{id}/cancellation-policy FLT-09
GET /api/flights/{id}/bookings FLT-29
GET /api/flights/{id}/passengers/export FLT-29
POST /api/flight-bookings/hold FLT-22
POST /api/flight-bookings FLT-19
GET /api/flight-bookings FLT-25
GET /api/flight-bookings/{id} FLT-25
POST /api/flight-bookings/{id}/cancel FLT-26
PATCH /api/flight-bookings/{id}/change-flight FLT-27
GET /api/flight-bookings/{id}/e-ticket FLT-23
PATCH /api/flight-bookings/{id}/seat FLT-28
POST /api/hotels HTL-01
GET /api/hotels/search HTL-11
GET /api/hotels/{id} HTL-02
PATCH /api/hotels/{id} HTL-01
POST /api/hotels/{hotelId}/rooms HTL-03
PATCH /api/hotels/{hotelId}/rooms/{roomId} HTL-05
DELETE /api/hotels/{hotelId}/rooms/{roomId} HTL-06
GET /api/hotels/{hotelId}/rooms/available HTL-15
POST /api/hotels/{hotelId}/rooms/{roomId}/availability HTL-04
PATCH /api/hotels/{hotelId}/rooms/{roomId}/availability/{blockId} HTL-05
GET /api/hotels/{id}/availability HTL-08
PUT /api/hotels/{id}/policies HTL-09
GET /api/hotels/{id}/reservations HTL-22
POST /api/hotel-bookings HTL-16
GET /api/hotel-bookings HTL-20
GET /api/hotel-bookings/grouped HTL-20
GET /api/hotel-bookings/{id} HTL-20
POST /api/hotel-bookings/{id}/cancel HTL-21
POST /api/hotel-bookings/{id}/review HTL-23
PATCH /api/reviews/{id} HTL-23
DELETE /api/reviews/{id} HTL-23
GET /api/hotels/{hotelId}/reviews HTL-24
POST /api/reviews/{id}/reply HTL-26
GET /api/bookings/{type}/{id}/policies PAY-02
POST /api/bookings/{type}/{id}/accept-policies PAY-02
POST /api/payments PAY-01
POST /api/payments/{id}/retry PAY-01
GET /api/payments/{id} PAY-01
POST /api/payments/webhook PAY-01
GET /api/refunds/{id} PAY-03
POST /api/itineraries ITN-01
GET /api/itineraries ITN-03
GET /api/itineraries/{id} ITN-03
PATCH /api/itineraries/{id} ITN-01
DELETE /api/itineraries/{id} ITN-01
POST /api/itineraries/{itineraryId}/days ITN-05
PATCH /api/itineraries/{itineraryId}/days/{dayId} ITN-05
DELETE /api/itineraries/{itineraryId}/days/{dayId} ITN-07
PATCH /api/itineraries/{itineraryId}/days/reorder ITN-08
POST /api/itineraries/{itineraryId}/days/{dayId}/activities ITN-10
PATCH /api/activities/{activityId} ITN-10
DELETE /api/activities/{activityId} ITN-10
POST /api/activities/{id}/images ITN-12
DELETE /api/activities/{id}/images/{imageId} ITN-12
POST /api/itineraries/{itineraryId}/days/{dayId}/budgets ITN-14
PATCH /api/budgets/{budgetId} ITN-14
DELETE /api/budgets/{budgetId} ITN-14
POST /api/itineraries/{itineraryId}/transport-costs ITN-16
PATCH /api/transport-costs/{costId} ITN-16
DELETE /api/transport-costs/{costId} ITN-16
GET /api/itineraries/{id}/budget-summary ITN-14
GET /api/itineraries/public/search ITN-21
GET /api/itineraries/public/{id} ITN-21
POST /api/itineraries/{id}/clone ITN-21
GET /api/itineraries/{id}/hotels ITN-25
GET /api/itineraries/{id}/flights ITN-26
POST /api/itineraries/{itineraryId}/days/{dayId}/bookings/{type}/{bookingId} ITN-27
GET /api/itineraries/{id}/pdf ITN-28
POST /api/posts BLG-01
GET /api/posts BLG-02
GET /api/posts/{id} BLG-02
GET /api/posts/mine BLG-03
PATCH /api/posts/{id} BLG-04
DELETE /api/posts/{id} BLG-04
POST /api/posts/{id}/comments BLG-05
PATCH /api/comments/{id} BLG-07
DELETE /api/comments/{id} BLG-07
POST /api/posts/{id}/like BLG-06
DELETE /api/posts/{id}/like BLG-06
POST /api/posts/{id}/images BLG-10
DELETE /api/posts/{id}/images/{imageId} BLG-10
GET /api/tags/{tag}/posts BLG-08
GET /api/authors/{id} BLG-12
PATCH /api/posts/{id}/itinerary BLG-13
POST /api/reports GEN-09
GET /api/notifications GEN-01
GET /api/currency/convert ITN-18
`.trim().split('\n').map((l) => l.trim().split(' '));

module.exports = {
  name: '8. Swagger documentation accuracy',
  async run(ctx, H) {
    const { check } = H;
    const res = await fetch(H.BASE.replace(/\/api$/, '') + '/api-json');
    const spec = await res.json();
    check('GEN-13', 'GET /api-json', 'OpenAPI document served', 200, res.status, res.status === 200);
    const ui = await fetch(H.BASE);
    check('GEN-13', 'GET /api', 'Swagger UI served at /api', 200, ui.status, ui.status === 200);
    const paths = spec.paths || {};
    for (const [method, path, req] of PDF) {
      const op = paths[path]?.[method.toLowerCase()];
      check(req, `${method} ${path}`, 'documented in Swagger (PDF section 8)', 'present', op ? 'present' : 'missing', !!op);
    }
    let noSummary = [], noBody = [], notApi = [];
    for (const [p, ms] of Object.entries(paths)) {
      if (!p.startsWith('/api/')) notApi.push(p);
      for (const [m, op] of Object.entries(ms)) {
        if (!op.summary) noSummary.push(`${m.toUpperCase()} ${p}`);
        if (['post', 'put', 'patch'].includes(m)) {
          const content = op.requestBody?.content || {};
          const json = content['application/json']?.schema;
          const multipart = content['multipart/form-data'];
          const bodyless = /\/(logout|refresh|like|cancel|retry|webhook|clone|suspend|reactivate|deactivate|read|read-all|bookings\/\{type\}\/\{bookingId\}|payment-intent|confirm|maintenance\/run|accept-policies|favourites\/\{type\}\/\{id\})$/.test(p) || /\/hotel-bookings\/\{id\}\/(accept-policies)/.test(p);
          if (!json && !multipart && !bodyless) noBody.push(`${m.toUpperCase()} ${p}`);
          if (json?.$ref) {
            const s = spec.components.schemas[json.$ref.split('/').pop()];
            if (!s || !s.properties || !Object.keys(s.properties).length) noBody.push(`${m.toUpperCase()} ${p} (empty schema)`);
          }
        }
      }
    }
    check('GEN-13', 'OpenAPI', 'every route under /api', 0, notApi.length, notApi.length === 0, notApi.join(', '));
    check('GEN-13', 'OpenAPI', 'every operation has a summary', 0, noSummary.length, noSummary.length === 0, noSummary.join(', '));
    check('GEN-13', 'OpenAPI', 'every JSON write endpoint documents its request body', 0, noBody.length, noBody.length === 0, noBody.join(', '));
    const cookieAuth = JSON.stringify(spec.components?.securitySchemes || {});
    check('ACC-19', 'OpenAPI', 'cookie authentication scheme declared', 'cookie', cookieAuth.slice(0, 80), /cookie/i.test(cookieAuth));
    // GEN-01-B: without SMTP the backend prints each email to its log (development only).
    let log = '';
    const NOTIFICATION_EMAIL = /To: [^\r\n]*[\r\n]+Subject: (?!You have been invited|Verify|Reset)/;
    for (let i = 0; i < 14; i++) { log = ctx.appLog(); if (/Subject: You have been invited as a moderator/.test(log) && NOTIFICATION_EMAIL.test(log)) break; await new Promise((r) => setTimeout(r, 2500)); }
    check('GEN-01-B', 'mail outbox', 'moderator invitation email produced', 'invitation', /Subject: You have been invited as a moderator/.test(log) ? 'invitation' : 'missing', /Subject: You have been invited as a moderator/.test(log));
    check('GEN-01-B', 'mail outbox', 'in-app notifications also produced as emails', 'notification email', NOTIFICATION_EMAIL.test(log) ? 'notification email' : 'missing', NOTIFICATION_EMAIL.test(log));
    check('GEN-01-B', 'mail outbox', 'temporary passwords never emailed', 'absent', /TempPass123/.test(log) ? 'leaked' : 'absent', !/TempPass123/.test(log));
    check('ACC-02', 'mail outbox', 'verification email sent on registration', 'Verify your email', /Subject: Verify your email address/.test(log) ? 'sent' : 'missing', /Subject: Verify your email address/.test(log));
    ctx.openapi = spec;
  },
};
