# Swagger / API test report

Generated 2026-11-19 16:33 UTC. Every row is a real HTTP request against the built backend (`node dist/main.js`) on an isolated in-memory MongoDB replica set seeded with the repository's reference data, using Stripe **test mode** (real PaymentIntents and refunds; webhooks delivered with a valid Stripe signature). Reproduce with:

```bash
cd backend
npm run build
node test/qa/run.cjs
```

**Result: 707 / 707 checks passed.**

| Section | Passed | Total |
|---|---|---|
| 1. Authentication and accounts | 62 | 62 |
| 2. Administration, airlines and flights | 96 | 96 |
| 3. Flight bookings, payments and refunds | 122 | 122 |
| 4. Hotels, rooms, reservations and reviews | 111 | 111 |
| 5. Itineraries and budgeting | 94 | 94 |
| 6. Blog, community and moderation | 72 | 72 |
| 7. Concurrency | 17 | 17 |
| 8. Swagger documentation accuracy | 133 | 133 |

## 1. Authentication and accounts

| Endpoint | Requirement | Test | Expected | Actual | Result |
|---|---|---|---|---|---|
| seed countries | GEN-12 | countries seeded from the reference CSV | >=8 | 8 | PASS |
| seed cities | GEN-12 | cities seeded from the reference CSV | >=8 | 8 | PASS |
| seed airports | GEN-12 | airports seeded from the reference CSV | >=8 | 8 | PASS |
| seed attractions | GEN-12 | attractions seeded from the reference CSV | >=8 | 8 | PASS |
| seed currencies | GEN-12 | supported currencies seeded | >=1 | 5 | PASS |
| seed airports | GEN-12 | official identifiers kept (CAI, Africa/Cairo) | Africa/Cairo | Africa/Cairo | PASS |
| POST /auth/register | ACC-01 | valid registration | 201 | 201 | PASS |
| POST /auth/register | ACC-01 | DB: user stored with role user | user | user | PASS |
| POST /auth/register | GEN-13 | DB: password stored only as bcrypt hash | bcrypt hash, no plain field | $2b$ | PASS |
| POST /auth/register | ACC-01 | response never contains password hash | absent | absent | PASS |
| POST /auth/register | ACC-01 | duplicate email rejected | 409 | 409 | PASS |
| POST /auth/register | ACC-01 | duplicate email, different case | 409 | 409 | PASS |
| POST /auth/register | ACC-01 | invalid email | 400 | 400 | PASS |
| POST /auth/register | ACC-01 | weak password (< 8 chars) | 400 | 400 | PASS |
| POST /auth/register | ACC-01 | weak password (no digit) | 400 | 400 | PASS |
| POST /auth/register | ACC-01 | weak password (no letter) | 400 | 400 | PASS |
| POST /auth/register | ACC-01 | consent not given | 400 | 400 | PASS |
| POST /auth/register | ACC-01 | missing required fields | 400 | 400 | PASS |
| POST /auth/register | ACC-18 | cannot self-register with role=admin (extra field rejected) | 400 | 400 | PASS |
| POST /auth/register | GEN-13 | NoSQL operator objects rejected | 400 | 400 | PASS |
| POST /auth/register | GEN-13 | malformed JSON -> 400 | 400 | 400 | PASS |
| POST /auth/register | GEN-13 | error response has no stack trace | no stack | no stack | PASS |
| POST /auth/register | GEN-13 | consistent error shape (statusCode, message, path) | statusCode,message,path | statusCode,message,timestamp,path | PASS |
| POST /auth/login | ACC-04 | valid login | 200 | 200 | PASS |
| POST /auth/login | ACC-19 | access token cookie is HttpOnly | HttpOnly | HttpOnly | PASS |
| POST /auth/login | ACC-19 | refresh token cookie is HttpOnly | HttpOnly | HttpOnly | PASS |
| POST /auth/login | ACC-19 | auth cookies are SameSite | SameSite | SameSite | PASS |
| POST /auth/login | ACC-19 | tokens not returned in JSON body | absent | absent | PASS |
| GET /auth/me | ACC-19 | current user from cookie | 200 | 200 | PASS |
| GET /auth/me | ACC-19 | returns own email | traveler-1795105925790@travel.test | traveler-1795105925790@travel.test | PASS |
| GET /auth/me | ACC-19 | no cookie -> 401 | 401 | 401 | PASS |
| POST /auth/login | ACC-04 | wrong password | 401 | 401 | PASS |
| POST /auth/login | ACC-04 | generic message for unknown email vs wrong password | Invalid email or password | Invalid email or password | PASS |
| POST /auth/login | ACC-05 | success after 4 failures resets counter | 200 | 200 | PASS |
| POST /auth/login | ACC-05 | locked after 5 consecutive failures (even correct password) | 401 | 401 | PASS |
| POST /auth/login | ACC-05 | lockout message shown | /lock/i | Account is temporarily locked. Try again later. | PASS |
| POST /auth/login | ACC-05 | DB: locked for ~15 minutes | 14-15 | 15 | PASS |
| PATCH /users/me | GEN-13 | mutating request with wrong CSRF header rejected | 401,403 | 401 | PASS |
| GET /users/me | ACC-11 | own profile | 200 | 200 | PASS |
| PATCH /users/me | ACC-09 | valid profile edit | 200 | 200 | PASS |
| PATCH /users/me | ACC-09 | DB: name/phone/currency saved (currency upper-cased) | EUR | EUR | PASS |
| PATCH /users/me | ACC-09 | invalid phone rejected | 400 | 400 | PASS |
| PATCH /users/me | ACC-09 | DB: nothing saved when one field invalid | Traveler Renamed | Traveler Renamed | PASS |
| PATCH /users/me | ACC-09 | invalid currency code | 400 | 400 | PASS |
| PATCH /users/me | GEN-13 | cannot change own role | 400 | 400 | PASS |
| PATCH /auth/change-password | ACC-08 | wrong current password | 401 | 401 | PASS |
| PATCH /auth/change-password | ACC-08 | new password breaks rules | 400 | 400 | PASS |
| PATCH /auth/change-password | ACC-08 | valid change | 200 | 200 | PASS |
| POST /auth/login | ACC-08 | login with new password | 200 | 200 | PASS |
| POST /auth/login | ACC-08 | old password no longer works | 401 | 401 | PASS |
| POST /auth/logout | ACC-06 | logout | 200 | 200 | PASS |
| POST /auth/logout | ACC-06 | auth cookies cleared | no access_token | cleared | PASS |
| POST /auth/refresh | ACC-06 | revoked refresh token cannot be reused | 401 | 401 | PASS |
| GET /auth/me | ACC-06 | old access token rejected after logout | 401 | 401 | PASS |
| GET /auth/me | ACC-06 | session idle > 30 min expires | 401 | 401 | PASS |
| POST /auth/login | ACC-18 | seeded admin can log in | 200 | 200 | PASS |
| seed | ACC-18 | DB: exactly one seeded admin | 1 | 1 | PASS |
| GET /admin/accounts | ACC-11 | user cannot access admin routes | 403 | 403 | PASS |
| GET /admin/accounts | ACC-11 | guest cannot access admin routes | 401 | 401 | PASS |
| DELETE /users/me | ACC-12 | deactivation needs confirmation | 400 | 400 | PASS |
| DELETE /users/me | ACC-12 | deactivate own account | 200 | 200 | PASS |
| POST /auth/login | ACC-12 | deactivated user cannot log in | 401 | 401 | PASS |

## 2. Administration, airlines and flights

| Endpoint | Requirement | Test | Expected | Actual | Result |
|---|---|---|---|---|---|
| POST /airlines | FLT-01 | admin creates airline | 201 | 201 | PASS |
| POST /airlines | FLT-01 | duplicate airline code | 409 | 409 | PASS |
| POST /airlines | FLT-01 | invalid airline code | 400 | 400 | PASS |
| POST /airlines | FLT-01 | user cannot create airline | 403 | 403 | PASS |
| GET /airlines/:id | FLT-01 | public airline profile | 200 | 200 | PASS |
| POST /admin/moderators | ACC-13 | admin creates airline moderator | 201 | 201 | PASS |
| POST /admin/moderators | ACC-13 | unknown provider rejected | 400,404 | 404 | PASS |
| POST /admin/moderators | ACC-13 | duplicate moderator email | 409 | 409 | PASS |
| POST /auth/login | ACC-13 | moderator logs in with temporary password | 200 | 200 | PASS |
| POST /flights | ACC-13 | temporary password must be changed first | 403 | 403 | PASS |
| PATCH /auth/change-password | ACC-13 | moderator sets own password | 200 | 200 | PASS |
| PATCH /airlines/:id | FLT-01 | moderator edits own airline | 200 | 200 | PASS |
| PATCH /airlines/:id | FLT-01 | moderator cannot edit another airline | 403 | 403 | PASS |
| PUT /airlines/:id/baggage-policy | FLT-08 | set baggage policy | 200 | 200 | PASS |
| PUT /airlines/:id/baggage-policy | FLT-08 | negative extra-bag limit rejected | 400 | 400 | PASS |
| PUT /airlines/:id/cancellation-policy | FLT-09 | set cancellation tiers | 200 | 200 | PASS |
| PUT /airlines/:id/cancellation-policy | FLT-09 | duplicate thresholds rejected | 400 | 400 | PASS |
| PUT /airlines/:id/cancellation-policy | FLT-09 | refund > 100% rejected | 400 | 400 | PASS |
| PUT /airlines/:id/cancellation-policy | FLT-09 | other airline moderator forbidden | 403 | 403 | PASS |
| GET /airports | FLT-02 | list airports | 200 | 200 | PASS |
| GET /airports | FLT-02 | seeded airports listed with time zones | >=8 | 8 | PASS |
| GET /airports/:code | FLT-02 | airport with IANA zone | 200 | 200 | PASS |
| GET /airports/CAI | FLT-02 | time zone Africa/Cairo | Africa/Cairo | Africa/Cairo | PASS |
| POST /flights | FLT-03 | moderator creates flight | 201 | 201 | PASS |
| POST /flights | FLT-03 | DB: departure stored in UTC from airport local time | 08:00Z | 08:00 | PASS |
| POST /flights | FLT-03 | duplicate flight number same day | 409 | 409 | PASS |
| POST /flights | FLT-03 | identical airports rejected | 400 | 400 | PASS |
| POST /flights | FLT-03 | arrival before departure rejected | 400 | 400 | PASS |
| POST /flights | FLT-03 | arrival compared in UTC, not local time | 400 | 400 | PASS |
| POST /flights | FLT-03 | departure in the past rejected | 400 | 400 | PASS |
| POST /flights | FLT-02 | airport not in reference list rejected | 400,404 | 400 | PASS |
| POST /flights | FLT-03 | cannot create flight for another airline | 403 | 403 | PASS |
| POST /flights | FLT-04 | cabin class used twice rejected | 400 | 400 | PASS |
| POST /flights | FLT-04 | price 0 rejected | 400 | 400 | PASS |
| POST /flights | FLT-04 | seat count 0 rejected | 400 | 400 | PASS |
| POST /flights | FLT-04 | unknown cabin class rejected | 400 | 400 | PASS |
| POST /flights | FLT-03 | traveler cannot create flights | 403 | 403 | PASS |
| POST /flights | FLT-03 | test flights created | all ids | 7 | PASS |
| POST /flights/:id/cabins | FLT-04 | add cabin class | 201 | 201 | PASS |
| POST /flights/:id/cabins | FLT-04 | same class twice rejected | 409 | 409 | PASS |
| PATCH /flights/:id/cabins/:cabinId | FLT-05 | update cabin price | 200 | 200 | PASS |
| PATCH /flights/:id/cabins/:cabinId | FLT-04 | unknown cabin id | 400 | 400 | PASS |
| PATCH /flights/:id/cabins/:cabinId | FLT-05 | other airline forbidden | 403 | 403 | PASS |
| GET /flights/search | FLT-11 | guest one-way search | 200 | 200 | PASS |
| GET /flights/search | FLT-11 | finds both CAI->DXB flights on that local date | QA100,QA200 | QA100,QB100,QA200 | PASS |
| GET /flights/search | FLT-11 | excludes flights without enough seats (QA100 has 4+2) | QA200 only | QB100,QA200 | PASS |
| GET /flights/search | FLT-11 | no match -> empty list | 0 | 0 | PASS |
| GET /flights/search | FLT-12 | cabin filter Business | QA100 only | QA100 | PASS |
| GET /flights/search | FLT-15 | min price > max price rejected | 400 | 400 | PASS |
| GET /flights/search | FLT-15 | price range 100-200 inclusive keeps QA200 (150) | QA200 | QA200 | PASS |
| GET /flights/search | FLT-15 | sort price_desc | QA100 before QA200 | QA100,QB100,QA200 | PASS |
| GET /flights/search | FLT-15 | invalid sort value rejected | 400 | 400 | PASS |
| GET /flights/search | FLT-02 | unknown airport in search rejected | 400,404 | 400 | PASS |
| GET /flights/search | FLT-12 | round-trip search | 200 | 200 | PASS |
| GET /flights/search | FLT-12 | round trip returns outbound and return options | QA100/QA300 | QA100,QB100,QA200/QA300 | PASS |
| GET /flights/:id | FLT-17 | flight details | 200 | 200 | PASS |
| GET /flights/:id | FLT-17 | airline, local times, duration, cabins with baggage and cancellation tiers | all present | all present | PASS |
| GET /flights/:id | GEN-06 | departure shown in Cairo local time | 10:00+02:00 | 10:00:00.000+02:00 | PASS |
| GET /flights/:id | GEN-06 | arrival shown in Dubai local time | 15:00+04:00 | 15:00:00.000+04:00 | PASS |
| GET /flights/:id | FLT-17 | malformed id | 400 | 400 | PASS |
| GET /flights/:id | FLT-17 | unknown id | 404 | 404 | PASS |
| GET /admin/accounts | ACC-14 | filter by role | 200 | 200 | PASS |
| GET /admin/accounts | ACC-14 | only moderators returned | airline_moderator | airline_moderator | PASS |
| GET /admin/accounts | ACC-14 | search by email | 1 | 1 | PASS |
| GET /admin/accounts | ACC-14 | filter by status with pagination | 200 | 200 | PASS |
| GET /admin/accounts | ACC-14 | invalid role filter | 400 | 400 | PASS |
| GET /admin/accounts?search=.* | GEN-13 | search text matched literally (regex escaped) | 0 | 0 | PASS |
| GET /admin/accounts?search=(a+)+$ | GEN-13 | no regex injection / ReDoS | 200 fast | 200 5ms | PASS |
| PATCH /admin/accounts/:id/suspend | ACC-16 | suspend user | 200 | 200 | PASS |
| GET /auth/me | ACC-16 | suspended user session rejected | 401 | 401 | PASS |
| POST /auth/login | ACC-04 | suspended account message | /suspended/i | Account is suspended | PASS |
| PATCH /admin/accounts/:id/reactivate | ACC-16 | reactivate user | 200 | 200 | PASS |
| POST /auth/login | ACC-16 | reactivated user can log in | 200 | 200 | PASS |
| PATCH /admin/accounts/:id/suspend | ACC-16 | non-admin cannot suspend | 403 | 403 | PASS |
| POST /admin/users/:id/reset-password | ACC-07a | admin sets temporary password | 200,201 | 201 | PASS |
| POST /auth/login | ACC-07a | login with temporary password | 200 | 200 | PASS |
| GET /flight-bookings | ACC-07a | must change temporary password first | 403 | 403 | PASS |
| PATCH /auth/change-password | ACC-07a | set new password | 200 | 200 | PASS |
| GET /flight-bookings | ACC-07a | access restored after change | 200 | 200 | PASS |
| POST /admin/users/:id/reset-password | ACC-07a | temporary password must meet rules | 400 | 400 | PASS |
| PATCH /admin/accounts/:id/suspend | ACC-15 | suspend moderator | 200 | 200 | PASS |
| POST /auth/login | ACC-15 | suspended moderator cannot log in | 401 | 401 | PASS |
| PATCH /admin/accounts/:id/reactivate | ACC-15 | reactivate moderator | 200 | 200 | PASS |
| PATCH /admin/providers/:type/:id/deactivate | ACC-15 | deactivate airline | 200 | 200 | PASS |
| GET /flights/search | ACC-15 | deactivated airline's flights hidden | no QB100 | QA100,QA200 | PASS |
| POST /flight-bookings/hold | ACC-15 | deactivated airline's flight cannot be booked | 4xx | 400 | PASS |
| GET /notifications | ACC-15 | airline moderator notified of deactivation | notification | provider.suspended | PASS |
| PATCH /admin/providers/:type/:id/reactivate | ACC-15 | reactivate airline | 200 | 200 | PASS |
| GET /flights/search | ACC-15 | reactivated airline visible again | QB100 | QA100,QB100,QA200 | PASS |
| PATCH /admin/providers/:type/:id/deactivate | ACC-15 | invalid provider type | 400 | 400 | PASS |
| GET /admin/audit-logs | GEN-07 | audit log list | 200 | 200 | PASS |
| GET /admin/audit-logs | GEN-07 | suspension and provider deactivation logged | suspend + deactivate | provider.reactivate,provider.deactivate,account.reactivate,account.suspend,accou | PASS |
| GET /admin/audit-logs | GEN-07 | non-admin forbidden | 403 | 403 | PASS |
| cron depart-flights | FLT-30 | flight past departure becomes Departed | Departed | Departed | PASS |
| PATCH /flights/:id | FLT-30 | departed flight not editable | 4xx | 400 | PASS |
| POST /flight-bookings/hold | FLT-30 | departed flight not bookable | 4xx | 400 | PASS |

## 3. Flight bookings, payments and refunds

| Endpoint | Requirement | Test | Expected | Actual | Result |
|---|---|---|---|---|---|
| POST /flight-bookings/hold | ACC-02 | unverified email cannot book | 403 | 403 | PASS |
| POST /flight-bookings/hold | ACC-10 | guest must log in to book | 401 | 401 | PASS |
| POST /flight-bookings/hold | ACC-11 | moderator cannot book as traveler | 403 | 403 | PASS |
| POST /flight-bookings/hold | FLT-12 | booking without an adult rejected | 400 | 400 | PASS |
| POST /flight-bookings/hold | FLT-12 | more infants than adults rejected | 400 | 400 | PASS |
| POST /flight-bookings/hold | FLT-19 | extra bags above airline maximum (2) rejected | 400 | 400 | PASS |
| POST /flight-bookings/hold | FLT-08 | extra bag heavier than max weight (23kg) rejected | 400 | 400 | PASS |
| POST /flight-bookings/hold | FLT-19 | missing passport number | 400 | 400 | PASS |
| POST /flight-bookings/hold | FLT-19 | date of birth in the future | 400 | 400 | PASS |
| POST /flight-bookings/hold | FLT-19 | no passengers | 400 | 400 | PASS |
| POST /flight-bookings/hold | FLT-19 | malformed flight id | 400 | 400 | PASS |
| POST /flight-bookings/hold | FLT-19 | cabin not on this flight | 400 | 400 | PASS |
| POST /flight-bookings/hold | FLT-22 | hold 1 adult + 1 child + 1 infant with one extra bag | 201 | 201 | PASS |
| POST /flight-bookings/hold | FLT-12 | price: adult+child full fare, infant 10%, bag fee | 365 | 365 | PASS |
| POST /flight-bookings/hold | FLT-22 | status Pending Payment | Pending Payment | Pending Payment | PASS |
| POST /flight-bookings/hold | FLT-22 | hold lasts 10 minutes | 9-10 | 10 | PASS |
| POST /flight-bookings/hold | FLT-12 | DB: infant takes no seat (2 seats held) | 28 | 28 | PASS |
| GET /flight-bookings/:id | FLT-21 | booking summary before payment | 200 | 200 | PASS |
| GET /flight-bookings/:id | FLT-21 | summary has passengers, baggage and total | 3 passengers | 3 | PASS |
| GET /flight-bookings/:id | ACC-11 | other user's booking hidden | 403,404 | 404 | PASS |
| GET /flight-bookings/:id | ACC-11 | guest rejected | 401 | 401 | PASS |
| POST /payments | PAY-02 | payment blocked before policies accepted | 400 | 400 | PASS |
| GET /bookings/:type/:id/policies | PAY-02 | airline policies shown | 200 | 200 | PASS |
| GET /bookings/flight/:id/policies | PAY-02 | includes cancellation tiers and baggage | both | {"bookingType":"flight","bookingId":"6aff249face8ee94f9e0e56d","policies":{"kind | PASS |
| GET /bookings/:type/:id/policies | PAY-02 | other user can't read | 403,404 | 404 | PASS |
| POST /bookings/:type/:id/accept-policies | PAY-02 | unchecked box rejected | 400 | 400 | PASS |
| POST /bookings/:type/:id/accept-policies | PAY-02 | accept policies | 200 | 200 | PASS |
| POST /bookings/flight/:id/accept-policies | PAY-02 | acceptance timestamp returned | date | 2026-11-19T16:32:31.816Z | PASS |
| POST /payments | PAY-01 | cannot pay someone else's booking | 403,404 | 404 | PASS |
| POST /payments | PAY-01 | create PaymentIntent | 201 | 201 | PASS |
| POST /payments | PAY-01 | amount equals booking total (USD) | 365 usd | 365 usd | PASS |
| Stripe confirm | PAY-01 | declined test card does not succeed | requires_payment_method | requires_payment_method | PASS |
| webhook payment_failed | PAY-01 | booking stays unconfirmed after failure | Pending Payment | Pending Payment | PASS |
| POST /payments/:id/retry | PAY-01 | retry after failure | 200,201 | 200 | PASS |
| Stripe confirm | PAY-01 | test card 4242 succeeds on retry | succeeded | succeeded | PASS |
| before webhook | PAY-01 | not confirmed until webhook verified | Pending Payment | Pending Payment | PASS |
| POST /payments/webhook | PAY-01 | forged webhook signature rejected | 400 | 400 | PASS |
| forged webhook | PAY-01 | forged event does not confirm | Pending Payment | Pending Payment | PASS |
| POST /payments/webhook | PAY-01 | signed payment_intent.succeeded accepted | 200,201 | 200 | PASS |
| GET /flight-bookings/:id | FLT-23 | booking Confirmed after verified payment | Confirmed | Confirmed | PASS |
| GET /flight-bookings/:id | FLT-23 | unique booking reference generated | reference | 38BDD9CE-C0A6-4B40-8EAE-21BD67A76938 | PASS |
| POST /payments/webhook | PAY-01 | duplicate event acknowledged | 200,201 | 200 | PASS |
| duplicate webhook | PAY-01 | DB: event processed once | 1 | 1 | PASS |
| duplicate webhook | PAY-01 | no duplicate confirmation notification | 1 | 1 | PASS |
| DB payments | PAY-01 | no card data or client secret stored | no card/secret fields | _id,bookingType,bookingId,userId,stripePaymentIntentId,amount,currency,status,at | PASS |
| GET /payments/:id | PAY-01 | payment status | 200 | 200 | PASS |
| GET /payments/:id | PAY-01 | status Succeeded | Succeeded | Succeeded | PASS |
| GET /payments/:id | PAY-01 | other user can't view payment | 403,404 | 404 | PASS |
| GET /notifications | FLT-23 | booking confirmation notification | booking confirmed | booking.confirmed,payment.failed | PASS |
| GET /notifications/unread-count | GEN-01 | unread count | 200 | 200 | PASS |
| GET /notifications/unread-count | GEN-01 | unread count >= 1 | >=1 | 2 | PASS |
| PATCH /notifications/:id/read | GEN-01 | mark one read | 200 | 200 | PASS |
| PATCH /notifications/:id/read | GEN-01 | cannot mark another user's notification | 403,404 | 404 | PASS |
| PATCH /notifications/read-all | GEN-01 | mark all read | 200 | 200 | PASS |
| GET /notifications/unread-count | GEN-01 | zero after read-all | 0 | 0 | PASS |
| GET /flight-bookings/:id/e-ticket | FLT-23 | download e-ticket | 200 | 200 | PASS |
| GET /flight-bookings/:id/e-ticket | FLT-23 | is a PDF | %PDF | %PDF | PASS |
| GET /flight-bookings/:id/e-ticket | ACC-11 | other user's ticket hidden | 403,404 | 404 | PASS |
| GET /flight-bookings/flights/:id/seats | FLT-28 | free numbered seats | 200 | 200 | PASS |
| PATCH /flight-bookings/:id/seat | FLT-28 | choose seat 7 | 200 | 200 | PASS |
| PATCH /flight-bookings/:id/seat | FLT-28 | infant cannot take a seat | 400 | 400 | PASS |
| PATCH /flight-bookings/:id/seat | FLT-28 | seat number out of range | 400 | 400 | PASS |
| PATCH /flight-bookings/:id/seat | FLT-28 | seat already taken by another booking | 400 | 400 | PASS |
| GET /flight-bookings/flights/:id/seats | FLT-28 | seat 7 no longer listed | absent | absent | PASS |
| cron expire-seat-holds | FLT-22 | unpaid hold becomes Expired | Expired | Expired | PASS |
| cron expire-seat-holds | FLT-22 | DB: held seat released | 28 | 28 | PASS |
| POST /payments | PAY-01 | expired hold cannot be paid | 4xx | 409 | PASS |
| GET /flight-bookings | FLT-25 | my bookings | 200 | 200 | PASS |
| GET /flight-bookings | FLT-25 | grouped as upcoming / past / cancelled | upcoming,past,cancelled | upcoming,past,cancelled | PASS |
| GET /flight-bookings | FLT-25 | confirmed booking under upcoming | 6aff249face8ee94f9e0e56d | 6aff249face8ee94f9e0e56d | PASS |
| GET /flight-bookings | ACC-11 | other user's list excludes my booking | absent | absent | PASS |
| GET /flights/:id/bookings | FLT-29 | moderator lists flight bookings | 200 | 200 | PASS |
| GET /flights/:id/bookings | FLT-29 | includes the confirmed booking | 38BDD9CE-C0A6-4B40-8EAE-21BD67A76938 | 38BDD9CE-C0A6-4B40-8EAE-21BD67A76938 | PASS |
| GET /flights/:id/passengers/export | FLT-29 | CSV export | 200 | 200 | PASS |
| GET /flights/:id/passengers/export | FLT-29 | CSV with passenger names | Adult | text/csv; charset=utf-8 | PASS |
| GET /flights/:id/bookings | FLT-29 | other airline's moderator forbidden | 403 | 403 | PASS |
| GET /flights/:id/bookings | FLT-29 | traveler forbidden | 403 | 403 | PASS |
| GET /admin/bookings | ACC-17 | admin lists confirmed flight bookings | 200 | 200 | PASS |
| GET /admin/bookings | ACC-17 | contains the confirmed booking | 38BDD9CE-C0A6-4B40-8EAE-21BD67A76938 | 38BDD9CE-C0A6-4B40-8EAE-21BD67A76938 | PASS |
| GET /admin/bookings | ACC-17 | traveler forbidden | 403 | 403 | PASS |
| GET /admin/analytics | BON-01 | analytics for period | 200 | 200 | PASS |
| GET /admin/analytics | BON-01 | revenue per provider includes 365 for QA Airways | 365 | {"from":"2026-11-18","to":"2026-11-20","providers":[{"bookings":1,"type":"flight | PASS |
| GET /admin/analytics | BON-01 | from after to rejected | 400 | 400 | PASS |
| PATCH /flights/:id | FLT-05 | airport change blocked once booked | 400 | 400 | PASS |
| PATCH /flights/:id | FLT-05 | rejected for the airport reason | /airport/i | departureLocalTime is required when changing the departure airport | PASS |
| PATCH /flights/:id/cabins/:cabinId | FLT-05 | seat count below booked rejected | 400 | 400 | PASS |
| PATCH /flights/:id/cabins/:cabinId | FLT-05 | rejected for the booked-seats reason | /book\|held\|allocated\|below/i | Seat count cannot fall below held or booked seats | PASS |
| PATCH /flights/:id/cabins/:cabinId | FLT-05 | seat count reduced but above booked | 200 | 200 | PASS |
| DB flights | FLT-05 | total 25, available = 25 - booked/held | 25 / 23 | 25 / 23 | PASS |
| PATCH /flights/:id/cabins/:cabinId | FLT-05 | price change | 200 | 200 | PASS |
| GET /flight-bookings/:id | FLT-05 | price change does not affect booking | 365 | 365 | PASS |
| PATCH /flights/:id | FLT-05 | time change | 200 | 200 | PASS |
| GET /notifications | FLT-05 | passenger notified of schedule change | schedule change | flight.schedule_changed,booking.confirmed,payment.failed | PASS |
| PATCH /flights/:id | FLT-05 | other airline can't edit | 403 | 403 | PASS |
| GET /flight-bookings/:id/cancellation-preview | FLT-26 | refund preview | 200 | 200 | PASS |
| GET /flight-bookings/:id/cancellation-preview | FLT-09 | 40 days before -> 100% tier | 100% / 365 | 100% / 365 | PASS |
| POST /flight-bookings/:id/cancel | ACC-11 | cannot cancel another user's booking | 403,404 | 404 | PASS |
| POST /flight-bookings/:id/cancel | FLT-26 | cancel confirmed booking | 200 | 200 | PASS |
| GET /flight-bookings/:id | FLT-26 | status Cancelled | Cancelled | Cancelled | PASS |
| DB flights | FLT-26 | seats returned to inventory | 25 | 25 | PASS |
| GET /bookings/:type/:id/refund | PAY-03 | refund status on booking | 200 | 200 | PASS |
| GET /bookings/flight/:id/refund | PAY-03 | Stripe refund created (Pending or Refunded) | Pending\|Refunded | Refunded | PASS |
| GET /refunds/:id | PAY-03 | refund record | 200 | 200 | PASS |
| DB refunds | PAY-03 | refund amount 365 with Stripe refund id | 36500 + re_ | 36500 re_ | PASS |
| GET /notifications | PAY-03 | cancellation/refund notification | refund | refund.updated,booking.cancelled,flight.schedule_changed,booking.confirmed,payme | PASS |
| POST /flight-bookings/:id/cancel | GEN-11 | cancelled booking cannot be cancelled again | 4xx | 400 | PASS |
| GET /flight-bookings/:id/cancellation-preview | FLT-09 | 3 days before -> tier 0 (0%) | 0% | 0% | PASS |
| POST /flight-bookings/:id/cancel | FLT-26 | cancellation after departure blocked | 400 | 400 | PASS |
| GET /flight-bookings/:id/change-preview | FLT-27 | preview change to same-route flight | 200 | 200 | PASS |
| GET /flight-bookings/:id/change-preview | FLT-27 | different route rejected | 400 | 400 | PASS |
| PATCH /flight-bookings/:id/change-flight | FLT-27 | change to higher fare holds replacement | 200,201 | 200 | PASS |
| POST /payments | FLT-27 | fare difference payment (bookingType flight_change) | 201 | 201 | PASS |
| POST /payments | FLT-27 | fare difference = 50 | 50 | 50 | PASS |
| GET /flight-bookings/:id | FLT-27 | booking moved to the new flight after payment | 6aff248cace8ee94f9e0e556 | 6aff248cace8ee94f9e0e556 | PASS |
| POST /flights/:id/cancel | FLT-06 | other airline can't cancel | 403 | 403 | PASS |
| POST /flights/:id/cancel | FLT-06 | airline cancels flight | 200 | 200 | PASS |
| DB flights | FLT-06 | flight Cancelled | Cancelled | Cancelled | PASS |
| GET /flight-bookings/:id | FLT-06 | confirmed booking Cancelled | Cancelled | Cancelled | PASS |
| DB refunds | FLT-06 | 100% refund (250) issued | 25000 | 25000 | PASS |
| DB bookings | FLT-06 | pending hold released | not Pending Payment | Cancelled | PASS |
| GET /notifications | FLT-06 | passenger notified | flight cancelled | refund.updated,booking.cancelled,booking.confirmed | PASS |
| GET /flights/search | FLT-06 | cancelled flight hidden from search | absent | absent | PASS |

## 4. Hotels, rooms, reservations and reviews

| Endpoint | Requirement | Test | Expected | Actual | Result |
|---|---|---|---|---|---|
| POST /hotels | HTL-01 | admin creates hotel | 201 | 201 | PASS |
| POST /hotels | HTL-01 | star class > 5 rejected | 400 | 400 | PASS |
| POST /hotels | HTL-01 | missing fields | 400 | 400 | PASS |
| POST /hotels | HTL-01 | traveler cannot create hotel | 403 | 403 | PASS |
| POST /admin/moderators | ACC-13 | admin creates hotel moderator | 201 | 201 | PASS |
| PATCH /hotels/:id | HTL-01 | moderator edits own hotel | 200 | 200 | PASS |
| PATCH /hotels/:id | HTL-01 | other hotel's moderator forbidden | 403 | 403 | PASS |
| PUT /hotels/:id/policies | HTL-09 | set check-in/out and tiers | 200 | 200 | PASS |
| PUT /hotels/:id/policies | HTL-09 | invalid time rejected | 400 | 400 | PASS |
| PUT /hotels/:id/policies | HTL-10 | duplicate tier thresholds rejected | 400 | 400 | PASS |
| PUT /hotels/:id/policies | HTL-10 | refund > 100% rejected | 400 | 400 | PASS |
| POST /hotels/:id/rooms | HTL-03 | add room | 201 | 201 | PASS |
| POST /hotels/:id/rooms | HTL-03 | duplicate room number in hotel | 409 | 409 | PASS |
| POST /hotels/:id/rooms | HTL-03 | max occupancy 0 rejected | 400 | 400 | PASS |
| POST /hotels/:id/rooms | HTL-03 | negative price rejected | 400 | 400 | PASS |
| POST /hotels/:id/rooms | HTL-03 | other hotel's moderator forbidden | 403 | 403 | PASS |
| POST /hotels/:id/rooms/:roomId/availability | HTL-06 | block dates | 201 | 201 | PASS |
| POST /hotels/:id/rooms/:roomId/availability | HTL-06 | end before start rejected | 400 | 400 | PASS |
| GET /hotels/search | HTL-11 | guest searches by city and dates | 200 | 200 | PASS |
| GET /hotels/search | HTL-11 | active hotels with free rooms listed | both hotels | QA Nile Hotel,Second Hotel | PASS |
| GET /hotels/search | HTL-11 | guests exceed combined occupancy of best 2 rooms (5+3=8) -> excluded | none | none | PASS |
| GET /hotels/search | HTL-11 | check-out before check-in rejected | 400 | 400 | PASS |
| GET /hotels/search | HTL-11 | check-in in the past rejected | 400 | 400 | PASS |
| GET /hotels/search | HTL-12 | price filter uses cheapest qualifying room | QA Nile 10000 only | QA Nile Hotel:10000 | PASS |
| GET /hotels/search | HTL-12 | min > max rejected | 400 | 400 | PASS |
| GET /hotels/search | HTL-12 | sort by price ascending | ascending | 8000,10000 | PASS |
| GET /hotels/search | HTL-12 | unrated hotels excluded with rating filter | 0 | 0 | PASS |
| GET /hotels/:id | HTL-02 | hotel details | 200 | 200 | PASS |
| GET /hotels/:id | HTL-02 | shows check-in/out times and cancellation policy | 14:00 + tiers | present | PASS |
| GET /hotels/:id/rooms/available | HTL-15 | free rooms for dates | 200 | 200 | PASS |
| GET /hotels/:id/rooms/available | HTL-15 | blocked room 104 excluded; total stay price shown | 101,102,103 and 30000 | ok | PASS |
| GET /hotels/:id/availability | HTL-08 | moderator room calendar | 200 | 200 | PASS |
| GET /hotels/:id/availability | HTL-08 | room 104 shows blocked days | blocked | blocked | PASS |
| GET /hotels/:id/availability | HTL-08 | public calendar (statuses only) | 200 | 200 | PASS |
| POST /hotel-bookings | ACC-02 | unverified email cannot book | 403 | 403 | PASS |
| POST /hotel-bookings | ACC-10 | guest must log in | 401 | 401 | PASS |
| POST /hotel-bookings | HTL-16 | guests exceed room occupancy | 400 | 400 | PASS |
| POST /hotel-bookings | HTL-16 | no adult in reservation | 400 | 400 | PASS |
| POST /hotel-bookings | HTL-18 | check-out before check-in | 400 | 400 | PASS |
| POST /hotel-bookings | HTL-18 | blocked room rejected | 400,409 | 409 | PASS |
| POST /hotel-bookings | HTL-16 | reserve two rooms together | 201 | 201 | PASS |
| POST /hotel-bookings | HTL-16 | total = 3 nights x (100 + 150) | 75000 | 75000 | PASS |
| POST /hotel-bookings | HTL-18 | held 10 minutes as one reservation | HELD, 9-10 min | HELD 10 | PASS |
| POST /hotel-bookings | HTL-18 | overlap with an unexpired hold rejects whole request | 409 | 409 | PASS |
| GET /hotels/:id/rooms/available | HTL-18 | nothing partially held after the rejected request (103 still free) | 103 free | 103 free | PASS |
| GET /hotel-bookings/:id | ACC-11 | other user's reservation hidden | 403,404 | 403 | PASS |
| POST /hotels/:id/rooms/:roomId/availability | HTL-06 | cannot block dates with a pending reservation | 400,409 | 409 | PASS |
| DELETE /hotels/:id/rooms/:roomId | HTL-06 | reserved room cannot be deleted | 400,409 | 409 | PASS |
| POST /payments | PAY-02 | hotel payment blocked before policies accepted | 400 | 400 | PASS |
| GET /bookings/:type/:id/policies | PAY-02 | hotel policies (tiers + check-in/out) | 200 | 200 | PASS |
| GET /bookings/hotel/:id/policies | PAY-02 | check-in time included | 14:00 | 14:00 | PASS |
| POST /bookings/:type/:id/accept-policies | PAY-02 | accept hotel policies | 200 | 200 | PASS |
| POST /payments | PAY-01 | create hotel PaymentIntent | 201 | 201 | PASS |
| POST /payments | PAY-04 | hotel amount in platform currency (USD 750) | 750 usd | 750 usd | PASS |
| Stripe confirm | PAY-01 | test card succeeds | succeeded | succeeded | PASS |
| GET /hotel-bookings/:id | HTL-17 | reservation confirmed with reference | CONFIRMED + ref | CONFIRMED HB-W6K7R3 | PASS |
| GET /notifications | HTL-17 | confirmation notification | confirmed | booking.confirmed | PASS |
| GET /hotel-bookings | HTL-20 | my reservations | 200 | 200 | PASS |
| GET /hotel-bookings | HTL-20 | contains the reservation | 6aff24bcace8ee94f9e0e5b5 | present | PASS |
| GET /hotel-bookings/grouped | HTL-20 | confirmed future reservation under upcoming | upcoming | upcoming | PASS |
| GET /hotel-bookings/grouped | HTL-20 | guest must log in | 401 | 401 | PASS |
| GET /hotel-bookings?status= | HTL-20 | filter by status (frontend groups Upcoming/Past/Cancelled) | 200 | 200 | PASS |
| GET /hotels/:id/reservations | HTL-22 | moderator sees reservations | 200 | 200 | PASS |
| GET /hotels/:id/reservations | HTL-22 | includes the reservation | 6aff24bcace8ee94f9e0e5b5 | present | PASS |
| GET /hotels/:id/reservations | HTL-22 | other hotel's moderator forbidden | 403 | 403 | PASS |
| GET /admin/bookings?type=hotel | ACC-17 | admin sees hotel reservation | present | present | PASS |
| PATCH /hotels/:id/rooms/:roomId | HTL-05 | edit room price | 200 | 200 | PASS |
| GET /hotel-bookings/:id | HTL-05 | existing reservation total unchanged | 75000 | 75000 | PASS |
| POST /hotels/:id/rooms/:roomId/availability | HTL-06 | cannot block dates with a confirmed reservation | 400,409 | 409 | PASS |
| GET /hotels/:id/availability | HTL-08 | moderator sees Booked with reservation reference | HB-W6K7R3 | shown | PASS |
| GET /hotels/:id/availability | HTL-08 | public calendar hides reservation reference | hidden | hidden | PASS |
| GET /hotel-bookings/:id/cancellation-quote | HTL-21 | refund quote | 200 | 200 | PASS |
| GET /hotel-bookings/:id/cancellation-quote | HTL-21 | 20 days before -> 100% of full total | 100% 75000 | {"bookingId":"6aff24bcace8ee94f9e0e5b5","daysBeforeCheckIn":20,"refundPercent":1 | PASS |
| POST /hotel-bookings/:id/cancel | ACC-11 | cannot cancel someone else's reservation | 403,404 | 403 | PASS |
| POST /hotel-bookings/:id/cancel | HTL-21 | cancel whole reservation | 200,201 | 200 | PASS |
| GET /hotel-bookings/grouped | HTL-20 | after cancellation it moves to cancelled | cancelled | cancelled | PASS |
| GET /hotel-bookings/:id | HTL-21 | status cancelled | CANCELLED | CANCELLED | PASS |
| DB refunds | PAY-03 | Stripe refund of 750 created for hotel | 75000 re_ | 75000 re_ | PASS |
| GET /hotels/:id/rooms/available | HTL-21 | rooms released after cancellation | 101 and 102 free | free | PASS |
| POST /hotel-bookings/maintenance/run | HTL-18 | run hold expiry | 200,201 | 200 | PASS |
| GET /hotel-bookings/:id | HTL-18 | unpaid hold expired | EXPIRED | EXPIRED | PASS |
| POST /hotel-bookings/maintenance/run | GEN-13 | internal endpoint rejects wrong key | 401,403 | 403 | PASS |
| GET /hotel-bookings/grouped | HTL-20 | grouped reservations | 200 | 200 | PASS |
| GET /hotel-bookings/grouped | HTL-20 | confirmed future stay under upcoming | upcoming | upcoming | PASS |
| POST /hotel-bookings/:id/review | HTL-23 | review before stay completed rejected | 400,403,409 | 409 | PASS |
| GET /hotel-bookings/grouped | HTL-20 | finished stay moves to past | past | past | PASS |
| GET /hotel-bookings/:id | HTL-23 | confirmed stay becomes COMPLETED after check-out | COMPLETED | COMPLETED | PASS |
| POST /hotel-bookings/:id/review | HTL-23 | rating 6 rejected | 400 | 400 | PASS |
| POST /hotel-bookings/:id/review | HTL-23 | review over 1000 characters rejected | 400 | 400 | PASS |
| POST /hotel-bookings/:id/review | HTL-23 | non-owner cannot review | 403,404 | 403 | PASS |
| POST /hotel-bookings/:id/review | HTL-23 | rating-only review of completed stay (text optional) | 201 | 201 | PASS |
| POST /hotel-bookings/:id/review | HTL-23 | second review for same reservation rejected | 409 | 409 | PASS |
| GET /hotels/:id/reviews | HTL-24 | public reviews | 200 | 200 | PASS |
| GET /hotels/:id | HTL-23 | average rating recalculated | 4 (1 rating) | 4 (1) | PASS |
| PATCH /reviews/:id | HTL-23 | edit own review (add text, change rating) | 200 | 200 | PASS |
| GET /hotels/:id | HTL-23 | average updated after edit | 2 | 2 | PASS |
| PATCH /reviews/:id | HTL-23 | cannot edit someone else's review | 403,404 | 403 | PASS |
| POST /reviews/:id/reply | HTL-26 | hotel moderator replies (bonus) | 200,201 | 201 | PASS |
| POST /reviews/:id/reply | HTL-26 | other hotel's moderator cannot reply | 403 | 403 | PASS |
| POST /reviews/:id/reply | HTL-26 | traveler cannot reply | 403 | 403 | PASS |
| GET /hotels/:id/reviews | HTL-26 | reply visible on review | Thank you | visible | PASS |
| DELETE /hotels/:id/rooms/:roomId | HTL-06 | never-reserved room can be deleted | 200,204 | 200 | PASS |
| PATCH /admin/providers/:type/:id/deactivate | ACC-15 | deactivate hotel | 200 | 200 | PASS |
| GET /hotels/search | ACC-15 | deactivated hotel hidden | no Second Hotel | QA Nile Hotel | PASS |
| POST /hotel-bookings | ACC-15 | deactivated hotel cannot be booked | 4xx | 409 | PASS |
| POST /favourites/:type/:id | BON-02 | save hotel to favourites | 200,201 | 201 | PASS |
| POST /favourites/:type/:id | BON-02 | saving twice is idempotent | 200,201,409 | 201 | PASS |
| GET /favourites | BON-02 | list favourites | 200 | 200 | PASS |
| GET /favourites | BON-02 | hotel listed once | 1 | 1 | PASS |
| DELETE /favourites/:type/:id | BON-02 | remove favourite | 200,204 | 200 | PASS |
| GET /favourites | BON-02 | guest must log in | 401 | 401 | PASS |

## 5. Itineraries and budgeting

| Endpoint | Requirement | Test | Expected | Actual | Result |
|---|---|---|---|---|---|
| POST /itineraries | ITN-01 | guest must log in | 401 | 401 | PASS |
| POST /itineraries | ITN-01 | title over 100 chars rejected | 400 | 400 | PASS |
| POST /itineraries | ITN-01 | at least one country required | 400 | 400 | PASS |
| POST /itineraries | ITN-01 | country not in reference list rejected | 400,404 | 400 | PASS |
| POST /itineraries | ITN-01 | invalid start date | 400 | 400 | PASS |
| POST /itineraries | ITN-01 | create itinerary | 201 | 201 | PASS |
| POST /itineraries | ITN-01 | private by default | private | private | PASS |
| PATCH /itineraries/:id | ITN-01 | edit title | 200 | 200 | PASS |
| PATCH /itineraries/:id | ACC-11 | cannot edit someone else's itinerary | 403,404 | 403 | PASS |
| GET /itineraries/:id | ACC-11 | private itinerary hidden from others | 403,404 | 403 | PASS |
| GET /itineraries/public/:id | ITN-20 | private itinerary not public | 404 | 404 | PASS |
| POST /itineraries/:id/days | ITN-05 | city not in list rejected | 400,404 | 400 | PASS |
| POST /itineraries/:id/days | ITN-09 | day requires a city | 400 | 400 | PASS |
| POST /itineraries/:id/days | ITN-05 | add day | 201 | 201 | PASS |
| GET /itineraries/:id | ITN-03 | full detail | 200 | 200 | PASS |
| GET /itineraries/:id | ITN-05 | days numbered 1..4 with dates from start date | 2026-12-19..2026-12-22 | 1:2026-12-19 2:2026-12-20 3:2026-12-21 4:2026-12-22 | PASS |
| PATCH /itineraries/:id/days/:dayId | ITN-05 | edit day notes | 200 | 200 | PASS |
| POST /itineraries/:id/days/:dayId/activities | ITN-10 | add activity with cost | 201 | 201 | PASS |
| POST /itineraries/:id/days/:dayId/activities | ITN-10 | empty name rejected | 400 | 400 | PASS |
| POST /itineraries/:id/days/:dayId/activities | ITN-10 | negative cost rejected | 400 | 400 | PASS |
| PATCH /activities/:id | ITN-10 | edit activity | 200 | 200 | PASS |
| PATCH /activities/:id | ACC-11 | cannot edit another user's activity | 403,404 | 403 | PASS |
| POST /itineraries/:id/days/:dayId/budgets | ITN-14 | add food budget | 201 | 201 | PASS |
| POST /itineraries/:id/days/:dayId/budgets | ITN-14 | negative amount rejected | 400 | 400 | PASS |
| POST /itineraries/:id/days/:dayId/budgets | ITN-14 | unknown category rejected | 400 | 400 | PASS |
| PATCH /budgets/:id | ITN-14 | edit budget | 200 | 200 | PASS |
| POST /itineraries/:id/transport-costs | ITN-16 | add transport cost | 201 | 201 | PASS |
| POST /itineraries/:id/transport-costs | ITN-16 | mode required | 400 | 400 | PASS |
| PATCH /transport-costs/:id | ITN-16 | edit transport cost | 200 | 200 | PASS |
| GET /itineraries/:id/budget-summary | ITN-14 | budget summary | 200 | 200 | PASS |
| GET /itineraries/:id/budget-summary | ITN-14 | grand total = budgets + activity costs + transport | 370 | 370 | PASS |
| GET /itineraries/:id/budget-summary | ITN-14 | activity cost counted under activities | 20 | 20 | PASS |
| GET /itineraries/:id/budget-summary | ITN-14 | per-day breakdown | 4 | 4 | PASS |
| GET /itineraries/:id/budget-summary | ITN-09 | consecutive same-city days grouped | cairox2,dubaix1,cairox1 | cairox2,dubaix1,cairox1 | PASS |
| GET /itineraries/:id/budget-summary?currency=EUR | ITN-18 | converted with rate date (FXRatesAPI) | EUR + rateDate | EUR 2026-11-19 live | PASS |
| DB exchange rates | ITN-18 | rates cached in database | >=1 | 1 | PASS |
| GET /itineraries/:id/budget-summary | ITN-18 | unsupported currency rejected | 400 | 400 | PASS |
| GET /currency/convert | ITN-18 | convert amount | 200 | 200 | PASS |
| GET /currency/convert | ITN-18 | invalid currency code | 400 | 400 | PASS |
| GET /currency/convert | ITN-18 | negative amount | 400 | 400 | PASS |
| PATCH /itineraries/:id/days/reorder | ITN-08 | move day 3 to first | 200 | 200 | PASS |
| GET /itineraries/:id | ITN-08 | renumbered with recalculated dates | dubai first on start date | 1:dubai:2026-12-19 2:cairo:2026-12-20 3:cairo:2026-12-21 4:cairo:2026-12-22 | PASS |
| PATCH /itineraries/:id/days/reorder | ITN-08 | incomplete day list rejected | 400 | 400 | PASS |
| DELETE /itineraries/:id/days/:dayId | ITN-07 | delete day | 200,204 | 200 | PASS |
| GET /itineraries/:id | ITN-07 | remaining days renumbered | 1,2,3 | 1,2,3 | PASS |
| POST /activities/:id/images | ITN-12 | upload PNG to activity (multipart) | 200,201 | 201 | PASS |
| POST /activities/:id/images | GEN-08 | GIF rejected | 400,415 | 400 | PASS |
| POST /activities/:id/images | GEN-08 | image over 5 MB rejected | 400,413 | 413 | PASS |
| POST /activities/:id/images | GEN-08 | more than 5 images per activity rejected | 400,409 | 400 | PASS |
| POST /activities/:id/images | ACC-11 | cannot add images to another user's activity | 403,404 | 403 | PASS |
| GET /itineraries/:id | ITN-12 | uploaded activity image appears in itinerary detail | >=1 image | 1 | PASS |
| GET /media/:id | GEN-08 | owner fetches uploaded image by URL | 200 image/png | 200 image/png | PASS |
| GET /media/:id | GEN-08 | private itinerary's image hidden from others | 403/404 | 404 | PASS |
| DELETE /activities/:id/images/:imageId | ITN-12 | remove image | 200 | 200 | PASS |
| GET /itineraries/:id | ITN-12 | removed image gone from itinerary detail | 0 | 0 | PASS |
| PATCH /itineraries/:id | ITN-20 | make public | 200 | 200 | PASS |
| GET /itineraries/public/:id | ITN-21 | guest views public itinerary | 200 | 200 | PASS |
| GET /itineraries/public/:id | ITN-21 | shows author, days and budget | author+days | ["id","title","countries","startDate","currency","cloneCount","updatedAt","days" | PASS |
| GET /itineraries/public/search | ITN-21 | keyword search | 200 | 200 | PASS |
| GET /itineraries/public/search?q=Dubai | ITN-21 | finds the public itinerary | 6aff24c2ace8ee94f9e0e5d5 | found | PASS |
| GET /itineraries/public/search?city&minDays&maxDays | ITN-21 | city and duration filters | found | found | PASS |
| GET /itineraries/public/search?minDays=10 | ITN-21 | excluded by duration | absent | absent | PASS |
| GET /itineraries/public/search | ITN-21 | minDays > maxDays rejected | 400 | 400 | PASS |
| PATCH /itineraries/:id | ITN-20 | public itinerary read-only to others | 403,404 | 403 | PASS |
| POST /itineraries/:id/clone | ITN-21 | guest cannot clone | 401 | 401 | PASS |
| POST /itineraries/:id/clone | ITN-21 | registered user clones | 201 | 201 | PASS |
| POST /itineraries/:id/clone | ITN-21 | clone is private and credits the author | private + clonedFrom | private planner | PASS |
| POST /itineraries/:id/clone | ITN-21 | clone has all days, activities and budgets | 3 days | 3 | PASS |
| GET /itineraries/:id | ITN-21 | original unaffected by clone edits | Egypt & Dubai | Egypt & Dubai | PASS |
| POST /itineraries/:id/clone | ITN-21 | cannot clone someone else's private itinerary | 403,404 | 404 | PASS |
| GET /itineraries | ITN-03 | list own itineraries | 200 | 200 | PASS |
| GET /itineraries | ACC-11 | list shows only the owner's itineraries | no clone | own only | PASS |
| GET /itineraries/:id/hotels | ITN-25 | hotels for city groups | 200 | 200 | PASS |
| GET /itineraries/:id/hotels | ITN-25 | uses group dates (check-out = day after last day) | group dates | {"itineraryId":"6aff24c2ace8ee94f9e0e5d5","guests":2,"rooms":1,"available":true, | PASS |
| GET /itineraries/:id/flights | ITN-26 | flights from origin to first-day city | 200 | 200 | PASS |
| GET /itineraries/:id/flights | ITN-26 | unknown origin airport | 400,404 | 400 | PASS |
| GET /itineraries/:id/flights | ITN-26 | non-owner blocked | 403/404 | 403 | PASS |
| GET /itineraries/:id/pdf | ITN-28 | export itinerary PDF | 200 | 200 | PASS |
| GET /itineraries/:id/pdf | ITN-28 | is a PDF | %PDF | %PDF | PASS |
| GET /itineraries/:id/pdf | ITN-28 | owner can export own clone | 200 | 200 | PASS |
| GET /itineraries/:id/pdf | ITN-28 | guest blocked | 401 | 401 | PASS |
| POST /itineraries | ITN-27 | booking owner creates itinerary | 201 | 201 | PASS |
| POST /itineraries/:id/days | ITN-27 | add day for the flight | 201 | 201 | PASS |
| POST /itineraries/:id/days/:dayId/bookings/:type/:bookingId | ITN-27 | link confirmed flight booking | 200,201 | 201 | PASS |
| GET /itineraries/:id/budget-summary | ITN-27 | booking amount feeds the budget | >0 | 400 | PASS |
| POST .../bookings/flight/:id | ITN-27 | linking twice is rejected or idempotent | 200/201/409 | 409 | PASS |
| POST /itineraries/:id/days/:dayId/bookings/:type/:bookingId | ITN-27 | cannot link someone else's booking | 403,404 | 404 | PASS |
| DELETE /itineraries/:id/days/:dayId/bookings/:type/:bookingId | ITN-27 | unlink booking | 200,204 | 200 | PASS |
| DELETE /users/me | ACC-12 | deactivation blocked while an upcoming Confirmed booking exists | 4xx | 400 | PASS |
| POST /favourites/:type/:id | BON-02 | save public itinerary | 200,201 | 201 | PASS |
| POST /favourites/:type/:id | BON-02 | cannot favourite a private itinerary | 400,403,404 | 404 | PASS |
| GET /itineraries/public/search | ITN-20 | private again -> removed immediately | absent | absent | PASS |
| DELETE /itineraries/:id | ITN-01 | delete itinerary | 200,204 | 204 | PASS |
| GET /itineraries/:id | ITN-01 | clone survives deletion of original | 200 | 200 | PASS |

## 6. Blog, community and moderation

| Endpoint | Requirement | Test | Expected | Actual | Result |
|---|---|---|---|---|---|
| POST /posts | ACC-10 | guest must log in to post | 401 | 401 | PASS |
| POST /posts | BLG-01 | title required | 400 | 400 | PASS |
| POST /posts | BLG-08 | more than 5 tags rejected | 400 | 400 | PASS |
| POST /posts | BLG-08 | tag over 30 chars rejected | 400 | 400 | PASS |
| POST /posts | BLG-01 | save draft | 201 | 201 | PASS |
| GET /posts/:id | BLG-01 | draft hidden from public | 404 | 404 | PASS |
| GET /posts/:id | BLG-01 | draft hidden from other users | 404 | 404 | PASS |
| GET /posts/:id | BLG-01 | author sees own draft | 200 | 200 | PASS |
| POST /posts | BLG-01 | publish post | 201 | 201 | PASS |
| GET /posts | BLG-02 | public list filtered by tag | 200 | 200 | PASS |
| GET /posts?tag= | BLG-02 | published posts only (no draft) | 2 posts | 2 | PASS |
| GET /tags/:tag/posts | BLG-08 | click tag to list posts | 200 | 200 | PASS |
| GET /posts/:id | BLG-02 | post page | 200 | 200 | PASS |
| GET /posts/:id | BLG-02 | shows author, tags, like count | present | present | PASS |
| GET /posts/mine | BLG-03 | own posts incl. drafts | 200 | 200 | PASS |
| GET /posts/mine | BLG-03 | includes the draft | 6aff24c4ace8ee94f9e0e71d | present | PASS |
| PATCH /posts/:id | BLG-04 | edit own post | 200 | 200 | PASS |
| PATCH /posts/:id | BLG-04 | empty edit rejected | 400 | 400 | PASS |
| PATCH /posts/:id | BLG-04 | cannot edit someone else's post | 403 | 403 | PASS |
| DELETE /posts/:id | BLG-04 | cannot delete someone else's post | 403 | 403 | PASS |
| DELETE /posts/:id | GEN-03 | delete requires confirmation | 400 | 400 | PASS |
| POST /posts/:id/images | BLG-10 | attach PNG | 200,201 | 201 | PASS |
| POST /posts/:id/images | GEN-08 | GIF rejected | 400,415 | 400 | PASS |
| POST /posts/:id/images | GEN-08 | file with fake PNG type rejected | 400,415 | 400 | PASS |
| POST /posts/:id/images | BLG-10 | cannot add images to someone else's post | 403 | 403 | PASS |
| GET /media/:id | GEN-08 | published post image served publicly | 200 | 200 | PASS |
| DELETE /posts/:id/images/:imageId | BLG-10 | remove image | 200 | 200 | PASS |
| POST /posts/:id/comments | BLG-05 | empty comment rejected | 400 | 400 | PASS |
| POST /posts/:id/comments | BLG-05 | comment over 500 chars rejected | 400 | 400 | PASS |
| POST /posts/:id/comments | ACC-10 | guest must log in to comment | 401 | 401 | PASS |
| POST /posts/:id/comments | BLG-05 | cannot comment on a draft | 403/404 | 404 | PASS |
| POST /posts/:id/comments | BLG-05 | comment on published post | 201 | 201 | PASS |
| GET /posts/:id/comments | BLG-05 | comments listed | 200 | 200 | PASS |
| GET /posts/:id/comments | BLG-05 | chronological order | Great trip! first | Great trip! \| Thanks for sharing. | PASS |
| PATCH /comments/:id | BLG-07 | edit own comment | 200 | 200 | PASS |
| PATCH /comments/:id | BLG-07 | cannot edit someone else's comment | 403 | 403 | PASS |
| POST /posts/:id/like | BLG-06 | like | 200,201 | 200 | PASS |
| POST /posts/:id/like | BLG-06 | second like does not double count | 200/201/409 | 200 | PASS |
| DB likes | BLG-06 | one like per user (2 users -> 2 likes) | 2 | 2 | PASS |
| DELETE /posts/:id/like | BLG-06 | remove like | 200 | 200 | PASS |
| POST /posts/:id/like | ACC-10 | guest must log in to like | 401 | 401 | PASS |
| GET /posts?q= | BLG-09 | keyword search | 200 | 200 | PASS |
| GET /posts?q=Nile | BLG-09 | ordered by likes + comments (post with 1 like + 2 comments first) | 6aff24c4ace8ee94f9e0e71e | 6aff24c4ace8ee94f9e0e71e,6aff24c4ace8ee94f9e0e71f | PASS |
| GET /posts?q= | BLG-09 | no results -> empty list | 0 | 0 | PASS |
| GET /authors/:id | BLG-12 | public author page | 200 | 200 | PASS |
| GET /authors/:id | BLG-12 | name and published posts; no email or drafts | no email/draft | ok | PASS |
| PATCH /posts/:id/itinerary | BLG-13 | private itinerary cannot be attached | 400,403,404 | 404 | PASS |
| PATCH /posts/:id/itinerary | BLG-13 | attach own public itinerary | 200 | 200 | PASS |
| GET /posts/:id | BLG-13 | post shows the itinerary | 6aff24c4ace8ee94f9e0e723 | linked | PASS |
| PATCH /posts/:id/itinerary | BLG-13 | cannot attach to someone else's post | 403 | 403 | PASS |
| PATCH /posts/:id/itinerary | BLG-13 | detach itinerary | 200 | 200 | PASS |
| POST /reports | GEN-09 | report a post | 201 | 201 | PASS |
| POST /reports | GEN-09 | second report of same item rejected | 409 | 409 | PASS |
| POST /reports | GEN-09 | report a comment | 201 | 201 | PASS |
| POST /reports | GEN-09 | reason required | 400 | 400 | PASS |
| POST /reports | GEN-09 | unsupported target type | 400 | 400 | PASS |
| POST /reports | ACC-10 | guest must log in to report | 401 | 401 | PASS |
| GET /admin/reports | GEN-10 | non-admin forbidden | 403 | 403 | PASS |
| GET /admin/reports | GEN-10 | admin lists open reports | 200 | 200 | PASS |
| GET /admin/reports | GEN-10 | post report listed | present | present | PASS |
| PATCH /admin/reports/:id | GEN-10 | resolve by hiding content | 200 | 200 | PASS |
| GET /posts/:id | GEN-10 | hidden post invisible to public | 404 | 404 | PASS |
| GET /posts/:id | GEN-10 | author still sees hidden post | 200 | 200 | PASS |
| GET /admin/content/:type/:id | GEN-10 | admin sees hidden post | 200 | 200 | PASS |
| PATCH /admin/reports/:id | GEN-10 | dismiss report | 200 | 200 | PASS |
| DELETE /admin/content/:type/:id | GEN-10 | admin deletes post directly | 200 | 200 | PASS |
| GET /posts/:id | GEN-10 | deleted post gone | 404 | 404 | PASS |
| GET /admin/audit-logs | GEN-07 | moderation actions audited (hide + delete) | hide,delete | content.deleted,report.dismissed,content.hidden,provider.reactivate,provider.dea | PASS |
| DELETE /users/me | ACC-12 | commenter deactivates account | 200 | 200 | PASS |
| GET /posts/:id/comments | ACC-12 | deactivated user's comment shown as 'Deleted user' | Deleted user | Deleted user | PASS |
| GET /posts | GEN-05 | lists paginate at 10 per page | 10 of 11 | 10 of 11 | PASS |
| GET /posts?page=2 | GEN-05 | second page has the rest | 1 | 1 | PASS |

## 7. Concurrency

| Endpoint | Requirement | Test | Expected | Actual | Result |
|---|---|---|---|---|---|
| POST /flight-bookings/hold x10 concurrent | FLT-22 | exactly one user gets the last seat | 1 | 1 | PASS |
| DB flights | FLT-22 | inventory never negative | 0 | 0 | PASS |
| POST /flight-bookings/hold x10 concurrent | FLT-22 | others rejected with 400/409, no 500 | 4xx | 400 | PASS |
| POST /flight-bookings/hold x6 concurrent (2 seats each, 5 available) | FLT-22 | at most 2 bookings succeed | 2 | 2 | PASS |
| DB flights/bookings | FLT-22 | held seats + available = capacity | 4 held + 1 free | 4 held + 1 free | PASS |
| POST /hotel-bookings x8 concurrent same room | HTL-18 | exactly one reservation holds the room | 1 | 1 | PASS |
| POST /hotel-bookings x8 concurrent same room | HTL-18 | others rejected without 500 | 4xx | 409 | PASS |
| POST /hotel-bookings x2 concurrent overlapping multi-room | HTL-18 | one wins, the other is rejected as a whole | 201 + 409 | 201+409 | PASS |
| DB hotel_bookings | HTL-18 | rejected request held nothing | 0 | 0 | PASS |
| POST /flight-bookings/hold x2 identical | FLT-22 | both handled without error; each hold reserves its own seat (no idempotency key) | 201,201 | 201,201 | PASS |
| POST /payments/webhook x5 concurrent same event | PAY-01 | all acknowledged (2xx) | 2xx | 200,200,200,200,200 | PASS |
| DB processed_stripe_events | PAY-01 | event processed exactly once | 1 | 1 | PASS |
| DB notifications | PAY-01 | single confirmation notification | 1 | 1 | PASS |
| DB bookings | FLT-23 | booking confirmed once with one reference | Confirmed | Confirmed | PASS |
| POST /flight-bookings/:id/cancel x3 concurrent | FLT-26 | only one cancellation succeeds | 1 | 1 | PASS |
| DB refunds | PAY-03 | only one refund issued | 1 | 1 | PASS |
| POST /flight-bookings/:id/cancel x3 concurrent | FLT-26 | no 500 errors | no 5xx | 404,200,404 | PASS |

## 8. Swagger documentation accuracy

| Endpoint | Requirement | Test | Expected | Actual | Result |
|---|---|---|---|---|---|
| GET /api-json | GEN-13 | OpenAPI document served | 200 | 200 | PASS |
| GET /api | GEN-13 | Swagger UI served at /api | 200 | 200 | PASS |
| POST /api/auth/register | ACC-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/auth/verify-email | ACC-02 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/auth/login | ACC-04 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/auth/logout | ACC-06 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/auth/forgot-password | ACC-07 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/auth/reset-password | ACC-07 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/admin/users/{id}/reset-password | ACC-07a | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/auth/change-password | ACC-08 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/auth/me | ACC-19 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/users/me | ACC-11 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/users/me | ACC-09 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/users/me | ACC-12 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/admin/moderators | ACC-13 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/admin/accounts | ACC-14 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/admin/accounts/{id}/suspend | ACC-15 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/admin/accounts/{id}/reactivate | ACC-15 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/admin/providers/{type}/{id}/deactivate | ACC-15 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/admin/providers/{type}/{id}/reactivate | ACC-15 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/admin/bookings | ACC-17 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/admin/reports | GEN-09 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/admin/reports/{id} | GEN-10 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/admin/content/{type}/{id} | GEN-10 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/admin/audit-logs | GEN-07 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/airlines | FLT-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/airlines/{id} | FLT-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/airlines/{id} | FLT-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/airports | FLT-02 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/flights | FLT-03 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/flights/search | FLT-11 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/flights/{id} | FLT-17 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/flights/{id} | FLT-05 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/flights/{id}/cancel | FLT-06 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/flights/{id}/cabins | FLT-04 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/flights/{id}/cabins/{cabinId} | FLT-04 | documented in Swagger (PDF section 8) | present | present | PASS |
| PUT /api/airlines/{id}/baggage-policy | FLT-08 | documented in Swagger (PDF section 8) | present | present | PASS |
| PUT /api/airlines/{id}/cancellation-policy | FLT-09 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/flights/{id}/bookings | FLT-29 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/flights/{id}/passengers/export | FLT-29 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/flight-bookings/hold | FLT-22 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/flight-bookings | FLT-19 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/flight-bookings | FLT-25 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/flight-bookings/{id} | FLT-25 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/flight-bookings/{id}/cancel | FLT-26 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/flight-bookings/{id}/change-flight | FLT-27 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/flight-bookings/{id}/e-ticket | FLT-23 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/flight-bookings/{id}/seat | FLT-28 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/hotels | HTL-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/hotels/search | HTL-11 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/hotels/{id} | HTL-02 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/hotels/{id} | HTL-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/hotels/{hotelId}/rooms | HTL-03 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/hotels/{hotelId}/rooms/{roomId} | HTL-05 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/hotels/{hotelId}/rooms/{roomId} | HTL-06 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/hotels/{hotelId}/rooms/available | HTL-15 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/hotels/{hotelId}/rooms/{roomId}/availability | HTL-04 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/hotels/{hotelId}/rooms/{roomId}/availability/{blockId} | HTL-05 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/hotels/{id}/availability | HTL-08 | documented in Swagger (PDF section 8) | present | present | PASS |
| PUT /api/hotels/{id}/policies | HTL-09 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/hotels/{id}/reservations | HTL-22 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/hotel-bookings | HTL-16 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/hotel-bookings | HTL-20 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/hotel-bookings/grouped | HTL-20 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/hotel-bookings/{id} | HTL-20 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/hotel-bookings/{id}/cancel | HTL-21 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/hotel-bookings/{id}/review | HTL-23 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/reviews/{id} | HTL-23 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/reviews/{id} | HTL-23 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/hotels/{hotelId}/reviews | HTL-24 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/reviews/{id}/reply | HTL-26 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/bookings/{type}/{id}/policies | PAY-02 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/bookings/{type}/{id}/accept-policies | PAY-02 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/payments | PAY-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/payments/{id}/retry | PAY-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/payments/{id} | PAY-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/payments/webhook | PAY-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/refunds/{id} | PAY-03 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/itineraries | ITN-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/itineraries | ITN-03 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/itineraries/{id} | ITN-03 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/itineraries/{id} | ITN-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/itineraries/{id} | ITN-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/itineraries/{itineraryId}/days | ITN-05 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/itineraries/{itineraryId}/days/{dayId} | ITN-05 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/itineraries/{itineraryId}/days/{dayId} | ITN-07 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/itineraries/{itineraryId}/days/reorder | ITN-08 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/itineraries/{itineraryId}/days/{dayId}/activities | ITN-10 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/activities/{activityId} | ITN-10 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/activities/{activityId} | ITN-10 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/activities/{id}/images | ITN-12 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/activities/{id}/images/{imageId} | ITN-12 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/itineraries/{itineraryId}/days/{dayId}/budgets | ITN-14 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/budgets/{budgetId} | ITN-14 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/budgets/{budgetId} | ITN-14 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/itineraries/{itineraryId}/transport-costs | ITN-16 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/transport-costs/{costId} | ITN-16 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/transport-costs/{costId} | ITN-16 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/itineraries/{id}/budget-summary | ITN-14 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/itineraries/public/search | ITN-21 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/itineraries/public/{id} | ITN-21 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/itineraries/{id}/clone | ITN-21 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/itineraries/{id}/hotels | ITN-25 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/itineraries/{id}/flights | ITN-26 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/itineraries/{itineraryId}/days/{dayId}/bookings/{type}/{bookingId} | ITN-27 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/itineraries/{id}/pdf | ITN-28 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/posts | BLG-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/posts | BLG-02 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/posts/{id} | BLG-02 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/posts/mine | BLG-03 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/posts/{id} | BLG-04 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/posts/{id} | BLG-04 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/posts/{id}/comments | BLG-05 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/comments/{id} | BLG-07 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/comments/{id} | BLG-07 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/posts/{id}/like | BLG-06 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/posts/{id}/like | BLG-06 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/posts/{id}/images | BLG-10 | documented in Swagger (PDF section 8) | present | present | PASS |
| DELETE /api/posts/{id}/images/{imageId} | BLG-10 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/tags/{tag}/posts | BLG-08 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/authors/{id} | BLG-12 | documented in Swagger (PDF section 8) | present | present | PASS |
| PATCH /api/posts/{id}/itinerary | BLG-13 | documented in Swagger (PDF section 8) | present | present | PASS |
| POST /api/reports | GEN-09 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/notifications | GEN-01 | documented in Swagger (PDF section 8) | present | present | PASS |
| GET /api/currency/convert | ITN-18 | documented in Swagger (PDF section 8) | present | present | PASS |
| OpenAPI | GEN-13 | every route under /api | 0 | 0 | PASS |
| OpenAPI | GEN-13 | every operation has a summary | 0 | 0 | PASS |
| OpenAPI | GEN-13 | every JSON write endpoint documents its request body | 0 | 0 | PASS |
| OpenAPI | ACC-19 | cookie authentication scheme declared | cookie | {"cookie":{"type":"apiKey","in":"cookie","name":"access_token"}} | PASS |
| mail outbox | GEN-01-B | moderator invitation email produced | invitation | invitation | PASS |
| mail outbox | GEN-01-B | in-app notifications also produced as emails | notification email | notification email | PASS |
| mail outbox | GEN-01-B | temporary passwords never emailed | absent | absent | PASS |
| mail outbox | ACC-02 | verification email sent on registration | Verify your email | sent | PASS |

