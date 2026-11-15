# Itineraries, budgets and currency API

Member 5's module: itinerary planning (ITN-01 … ITN-26). All routes are served
without an `/api` prefix; Swagger UI is mounted at `/api`.

- Base URL: `http://localhost:3000`
- Content type: `application/json`
- SwiftUI-style camelCase bodies; ids are 24-character Mongo ObjectIds.

## 1. Authentication

Member 1's authentication guards the whole API: `JwtAuthGuard` is registered as a
global `APP_GUARD` in `AuthModule`, so every route needs a session unless it is
marked `@Public()`.

| Item | Value |
|---|---|
| Register | `POST /auth/register` `{ name, email, password, acceptedTerms, acceptedPrivacyPolicy }` |
| Login | `POST /auth/login` `{ email, password }` — sets `access_token`, `refresh_token` and `csrf_token` cookies |
| Read routes | send the cookies |
| Write routes | also send `x-csrf-token: <csrf_token cookie value>` |
| Session lifetime | 15-minute access token, 30-minute inactivity, 7-day refresh |
| Missing or expired session | `401 Unauthorized` |

Public routes need no cookies: public search, public detail, `GET /cities` and
`GET /currency/convert`. The guard resolves the caller id only; every service
re-checks ownership against the stored `ownerId`, so a valid session is not
enough to touch somebody else's itinerary (`403`).

In Swagger UI: log in through `POST /auth/login`, then use **Authorize** with the
`access_token` cookie, and add the `x-csrf-token` header per request.

The earlier `x-dev-user-id` header guard is gone. Integration with Member 1 was
verified by `itineraries/itineraries.module.spec.ts`, which boots the module
graph with the real `AuthModule` and asserts that the owner routes answer `401`,
the guest routes answer `200`, and the retired header is ignored.

## 2. Endpoints

| # | Method | Path | Auth | Responsibility |
|---|---|---|---|---|
| 1 | POST | `/itineraries` | yes | ITN-01 create |
| 2 | GET | `/itineraries` | yes | ITN-01 list own, paginated |
| 3 | GET | `/itineraries/:id` | yes | ITN-01, ITN-03 detail |
| 4 | PATCH | `/itineraries/:id` | yes | ITN-01, ITN-20 edit, publish |
| 5 | DELETE | `/itineraries/:id` | yes | ITN-01 delete |
| 6 | POST | `/itineraries/:id/clone` | yes | ITN-21, ITN-22 clone |
| 7 | GET | `/itineraries/:id/budget-summary` | yes | ITN-14, ITN-18 totals |
| 8 | GET | `/itineraries/:id/hotels` | yes | ITN-25 stays per city, guests and rooms |
| 9 | GET | `/itineraries/:id/flights` | yes | ITN-26 flight options, origin and trip type |
| 10 | POST | `/itineraries/:itineraryId/days` | yes | ITN-05 add day |
| 11 | PATCH | `/itineraries/:itineraryId/days/reorder` | yes | ITN-07 reorder |
| 12 | PATCH | `/itineraries/:itineraryId/days/:dayId` | yes | ITN-05 change city or note |
| 13 | DELETE | `/itineraries/:itineraryId/days/:dayId` | yes | ITN-05 delete day |
| 14 | POST | `/itineraries/:itineraryId/days/:dayId/activities` | yes | ITN-10 add activity |
| 15 | PATCH | `/activities/:activityId` | yes | ITN-10, ITN-11 edit |
| 16 | DELETE | `/activities/:activityId` | yes | ITN-10 delete |
| 17 | POST | `/activities/:activityId/images` | yes | ITN-12 add image |
| 18 | DELETE | `/activities/:activityId/images/:imageId` | yes | ITN-12 remove image |
| 19 | POST | `/itineraries/:itineraryId/days/:dayId/budgets` | yes | ITN-14 add budget entry |
| 20 | PATCH | `/budgets/:budgetId` | yes | ITN-14 edit budget entry |
| 21 | DELETE | `/budgets/:budgetId` | yes | ITN-14 delete budget entry |
| 22 | POST | `/itineraries/:itineraryId/transport-costs` | yes | ITN-16 add cost |
| 23 | PATCH | `/transport-costs/:costId` | yes | ITN-16 edit cost |
| 24 | DELETE | `/transport-costs/:costId` | yes | ITN-16 delete cost |
| 25 | GET | `/itineraries/public/search` | no | ITN-20, ITN-21 search |
| 26 | GET | `/itineraries/public/:id` | no | ITN-21 public detail |
| 27 | GET | `/cities` | no | ITN-05 reference cities |
| 28 | GET | `/currency/convert` | no | ITN-18 conversion |

## 3. Itinerary

### Create

```json
POST /itineraries
{
  "title": "Cairo and Dubai",
  "countries": ["EG", "AE"],
  "startDate": "2026-12-01",
  "currency": "EGP"
}
```

| Field | Rule |
|---|---|
| `title` | trimmed, 1–100 characters |
| `countries` | 1–10 distinct ISO codes, must exist in `countries` |
| `startDate` | `YYYY-MM-DD`, a real calendar date |
| `currency` | optional 3-letter code, must be a display currency; defaults to the first country's currency |

New itineraries are `visibility: "private"`, `isHidden: false`, `cloneCount: 0`.
The response is the owner detail object.

### Detail response

```json
{
  "id": "…", "title": "Cairo and Dubai", "countries": ["EG", "AE"], "startDate": "2026-12-01",
  "currency": "EGP", "visibility": "private", "isHidden": false,
  "cloneCount": 0, "dayCount": 3, "updatedAt": "…", "createdAt": "…",
  "days": [
    {
      "id": "…", "dayNumber": 1, "date": "2026-12-01", "cityId": "cairo",
      "notes": "Old town in the morning.",
      "activities": [
        {
          "id": "…", "title": "Pyramids of Giza", "attractionId": "att-1",
          "startTime": "09:00", "durationMinutes": 180,
          "notes": "Tickets bought online.", "cost": 450,
          "images": [{ "id": "…", "url": "https://…", "mimeType": "image/png", "sizeBytes": 204800 }]
        }
      ],
      "budgets": [{ "id": "…", "category": "food", "amount": 200, "note": "Lunch" }]
    }
  ],
  "transportCosts": [
    { "id": "…", "mode": "flight", "fromCityId": "cairo", "toCityId": "dubai", "amount": 300, "date": "2026-12-02", "note": "Flight" }
  ],
  "clonedFrom": { "itineraryId": "…", "authorId": "…", "authorName": "Sara", "clonedAt": "…" }
}
```

`clonedFrom` is present only on a copy. `GET /itineraries` returns
`{ items: [summary], total, page, limit, totalPages }` where a summary is the
detail without `days`, `transportCosts`, `clonedFrom` and `createdAt`, plus
`dayCount`.

### Edit and delete

`PATCH /itineraries/:id` accepts any subset of `title`, `countries`,
`startDate`, `currency`, `visibility` (`private` | `public`). Changing
`startDate` or `countries` renumbers every day date from the new start and
re-validates that each day city still belongs to one of the countries (a city
outside them is a `400`). `DELETE` removes the itinerary and its subdocuments;
it answers `204`.

## 4. Days (ITN-05 … ITN-09)

| Route | Body | Rule |
|---|---|---|
| `POST …/days` | `{ "cityId": "cairo" }` | city must exist and belong to the itinerary countries; `dayNumber = n+1`; `date` derived from `startDate`; max 60 days |
| `PATCH …/days/reorder` | `{ "dayIds": ["…", "…"] }` | must list every day exactly once; dates are recalculated in the new order |
| `PATCH …/days/:dayId` | `{ "cityId": "dubai", "notes": "Old town in the morning." }` | same city rule as create; `notes` is optional and an empty string clears it; at least one of the two must be sent |
| `DELETE …/days/:dayId` | — | remaining days renumber to 1…n and their dates close the gap |

Every day response carries `id`, `dayNumber`, `date`, `cityId`, `notes`,
`activities` and `budgets`. City names are resolved on read for the budget
summary, public detail and travel routes; the day itself stores only the
reference id.

City groups (ITN-09) are computed, never stored: consecutive days in the same
city form one group, and the same city appearing twice forms two groups.

## 5. Activities and images (ITN-10 … ITN-13)

```json
POST /itineraries/:itineraryId/days/:dayId/activities
{
  "title": "Pyramids of Giza",
  "attractionId": "att-1",
  "startTime": "09:00",
  "durationMinutes": 180,
  "notes": "Tickets bought online.",
  "cost": 450
}
```

| Field | Rule |
|---|---|
| `title` | trimmed, 1–120 characters |
| `attractionId` | optional, 1–80 characters |
| `startTime` | optional `HH:mm`, 24-hour, `00:00`–`23:59` |
| `durationMinutes` | optional integer 1–1440 |
| `notes` | optional, up to 200 characters |
| `cost` | optional, ≥ 0, at most 2 decimals |

`PATCH /activities/:activityId` takes any subset; `DELETE` removes the activity
with its images. A day holds at most 20 activities.

Images are URL-only until Member 6's media service exists:

```json
POST /activities/:activityId/images
{ "url": "https://cdn.example.com/pyramids.png", "mimeType": "image/png", "sizeBytes": 204800 }
```

`url` is required and must be a URL of at most 2048 characters; `mimeType` is
`image/jpeg` or `image/png` only; `sizeBytes` is an integer from 1 to 5 MB
(5 242 880 bytes). An activity holds at most **5** images (`400` when exceeded).
Deleting an image removes only that image.

## 6. Budgets and transport costs (ITN-14, ITN-16)

```json
POST /itineraries/:itineraryId/days/:dayId/budgets
{ "category": "food", "amount": 200, "currency": "EGP", "note": "Lunch" }
```

- `category` is one of `food`, `accommodation`, `local_transport`, `activities`.
- `amount` is ≥ 0 with at most 2 decimals.
- `currency` is optional: the 3-letter code the amount is entered in, uppercased,
  from the supported list (the currencies of the reference countries). It defaults
  to the itinerary currency and is returned on every budget entry. A code the
  dataset cannot serve answers `400`.
- `note` is optional, up to 200 characters.
- The day must belong to the itinerary.

```json
POST /itineraries/:itineraryId/transport-costs
{ "mode": "flight", "fromCityId": "cairo", "toCityId": "dubai", "amount": 300, "currency": "USD", "date": "2026-12-02", "note": "Flight" }
```

- `mode` names how the leg is travelled (`flight`, `train`, `bus`, `car`, ...):
  trimmed, 1-40 characters, required on create and kept on edit.
- Both cities must differ and must already appear in the itinerary days.
- `currency` is optional, with the same rule and default as a budget entry
  (ITN-16 names it in the entry: mode, from-city, to-city, amount, currency, day).
- `date` is optional `YYYY-MM-DD`; `note` up to 200 characters.

An entry is stored with the currency it was entered in and is **not** rewritten
when the itinerary currency changes. Every total converts it into the itinerary
currency first, then into the display currency, so the original figure and its
currency stay visible.

Edit and delete routes find the parent itinerary by the nested subdocument id, so
`/budgets/:budgetId` needs no itinerary id in the path. A foreign parent answers
`403`; an unknown subdocument answers `404`.

## 7. Budget summary (ITN-14, ITN-18)

```
GET /itineraries/:id/budget-summary?currency=USD
```

```json
{
  "itineraryId": "…", "currency": "USD", "sourceCurrency": "EGP",
  "rateDate": "2026-11-15", "rateSource": "cached",
  "totals": {
    "categories": { "food": 11.0, "accommodation": 33.0, "local_transport": 2.2, "activities": 9.9 },
    "transport": 22.0,
    "grandTotal": 78.1
  },
  "byDay": [ { "dayId": "…", "dayNumber": 1, "date": "…", "cityId": "cairo", "categories": { … }, "total": 20.0 } ],
  "byCityGroup": [ { "cityId": "cairo", "cityName": "Cairo", "countryCode": "EG", "fromDay": 1, "toDay": 2, "dayCount": 2, "dateFrom": "…", "dateTo": "…", "categories": { … }, "total": 44.0 } ],
  "transportCosts": [ { "id": "…", "mode": "flight", "fromCityId": "cairo", "toCityId": "dubai", "date": "…", "currency": "EGP", "amount": 300, "convertedAmount": 22.0 } ]
}
```

Rules:

1. Day totals add budget entries per category **and** each activity `cost` to
   `activities`, so an activity is never invisible in the budget.
2. Transport costs are a separate list plus one `totals.transport` line; they are
   **not** part of any day or city group, only of `grandTotal`.
3. City-group totals use the consecutive-day grouping of ITN-09.
4. Display currency: `?currency`, else the caller's `users.preferredCurrency`
   (Member 1's schema defaults it to `USD`), else the itinerary currency. An
   explicit `?currency` must be a display currency (`400` otherwise); a profile
   preference that is not one is ignored in favour of the itinerary currency.
5. Every entry is converted from its own `currency` into the itinerary currency
   before it joins a sum; each source total is then converted **once** into the
   display currency and rounded to 2 decimals — never per entry, so no rounding
   drift. A `transportCosts` row keeps its own `amount` and `currency`, with
   `convertedAmount` in the summary currency.
6. `rateSource` is `same` (same currency, no FX call), `live`, `cached` or
   `stale`; `rateDate` is `null` when the currency is unchanged. No rate is
   fetched while every entry is already in the itinerary currency.

## 8. Exchange rates (ITN-18)

```
GET /currency/convert?amount=100&from=EGP&to=EUR
```

```json
{ "amount": 100, "from": "EGP", "to": "EUR", "rate": 0.0018, "convertedAmount": 0.18,
  "rateDate": "2026-11-15", "rateSource": "cached" }
```

- One `exchange_rates` document per UTC day, base USD, upserted on first use and
  served from Mongo afterwards.
- The client calls `GET /latest?base=USD` with a 5 s timeout and **one retry**.
  When it fails, the newest cached document is served as `stale`; when nothing
  is cached the route answers `503` rather than inventing a rate.
- Cross rates go through USD: `rate = rates[to] / rates[from]`.
- Both codes must be display currencies: the union of the distinct
  `countries.currency` values and the codes `SUPPORTED_CURRENCIES` declares, not
  Member 2's booking-side `PLATFORM_CURRENCY`.

| Env var | Meaning |
|---|---|
| `FX_RATES_API_BASE_URL` | defaults to `https://api.fxratesapi.com` |
| `FX_RATES_API_KEY` | optional; only sent when set |
| `FX_RATES_TIMEOUT_MS` | defaults to `5000` |

## 9. Public search, public detail, clone (ITN-20 … ITN-22)

```
GET /itineraries/public/search?q=cairo&country=EG&city=cairo&authorId=…&minDays=2&maxDays=10&sort=popular&page=1&limit=10
```

Only `visibility = "public"` and `isHidden != true` itineraries are ever matched.

| Query | Rule |
|---|---|
| `q` | case-insensitive, regex-escaped match on the title, a country code or name, or a city name |
| `country` | 2-letter code in the itinerary `countries` |
| `city` | city id used by at least one day |
| `authorId` | owner id |
| `minDays` / `maxDays` | day-count bounds (0–60) |
| `sort` | `newest` (default, `updatedAt`) or `popular` (`cloneCount`) |
| `page` / `limit` | default 1 / 10, `limit` ≤ 100 |

Each item is the itinerary summary plus `author: { id, name }`. Names come from
`users.name` only — email and other fields never leave the database.

```
GET /itineraries/public/:id
```

Answers `200` with title, countries, startDate, days (city object, activities
and budget entries), the budget in the itinerary currency (`currency`,
`categories`, `transport`, `grandTotal`, no display conversion), `author` and,
for a copy, `originalAuthor`. An entry written in another currency is converted
into the itinerary currency for these totals, while the entry itself still shows
its own `amount` and `currency`. Private and hidden itineraries answer `404`, not
`403`.

```
POST /itineraries/:id/clone
{ "title": "My Egypt trip", "startDate": "2027-03-01" }
```

- Source must be public and not hidden, **or** owned by the caller.
- The copy is private, owned by the caller, `cloneCount: 0`, and every day,
  activity, image, budget and transport cost is rebuilt with new ids.
- `clonedFrom` records the original itinerary, author id and author name.
- `title` defaults to `Copy of <source title>`; `startDate` keeps the source
  dates unless given, when every day date is recalculated.
- The source's `cloneCount` is incremented by 1.

## 10. Hotels and flights (ITN-25, ITN-26)

```
GET /itineraries/:id/hotels?guests=2&rooms=1
GET /itineraries/:id/flights?passengers=1&limit=3
GET /itineraries/:id/flights?originAirport=HRG&tripType=round-trip&returnDate=2026-11-25
```

Hotels: one entry per city group with `checkIn = dateFrom`,
`checkOut = dateTo + 1 day` and `nights`, and the requested `guests` (1-20) and
`rooms` (1-10, default 1) sent to the provider for every stay. The data comes
from the `HotelSearchPort` contract with Member 3. Until that module lands the
default provider returns nothing and every group is `available: false` with a
reason - no hotel is ever fabricated. A provider error degrades the same way
instead of failing the itinerary.

Flights have two modes, reported as `mode` in the response.

- `origin` (when `originAirport` is sent): searches from that airport to every
  airport of the first day city, outbound on the start date, and returns
  `tripType` (`one-way` or `round-trip`, default round-trip), `destination`,
  `departureDate`, `returnDate` and the cheapest `outbound` / `inbound` options.
  The return date defaults to the last day of the itinerary. An unknown airport
  or a return date before the start date is a `400`.
- `legs` (no `originAirport`): one leg per change of city, dated on the arrival
  day, airports resolved from the `airports` collection by `city_id` (at most 3
  per city, every pair searched).

Both modes return the cheapest cabins that can seat every passenger,
deduplicated by flight and limited to the cheapest few (`price` per passenger,
`totalPrice` for the whole party), with reasons instead of guesses when a city
has no airport or no flight matches.

## 11. Reference cities

```
GET /cities?country=EG&q=cai&page=1&limit=10
```

Read-only `{ city_id, name, country_code }` records sorted by name, `_id`
excluded, paginated. Used by the client when adding a day.

The seed (`npm run seed`) loads 8 countries, 8 cities and 8 airports. Only these
city ids are valid in a day: `cairo`, `dubai`, `london`, `new_york`, `paris`,
`tokyo`, `riyadh`, `frankfurt`; each has exactly one airport (`CAI`, `DXB`,
`LHR`, `JFK`, `CDG`, `HND`, `RUH`, `FRA`). Attractions: `att-1` … `att-8`, one
per city in that order (Cairo, Dubai, London, New York, Paris, Tokyo, Riyadh,
Frankfurt).

## 12. Status codes

| Code | When |
|---|---|
| `200` | read, edit or subdocument delete succeeded (`DELETE /itineraries/:id` is the only `204`) |
| `201` | created (itinerary, day, activity, budget, transport cost, image) |
| `204` | itinerary deleted |
| `400` | body/query validation failed, unknown reference code or city, unknown origin airport, return date before the start date, bad `startDate`, 60-day cap, 20-activity cap, 5-image cap, image not JPG/PNG or over 5 MB, transport city not in the itinerary, missing transport mode, unsupported currency (display or entry), rate missing for a code — the body names the code and the entries that need it, e.g. `rate missing for CAD (budget <id>)` |
| `401` | no session cookie, an expired session, or a write without the matching `x-csrf-token` |
| `403` | the itinerary belongs to another user (owner routes only) |
| `404` | itinerary/subdocument/public itinerary not found (also covers another user's private itinerary on clone and public detail) |
| `503` | exchange rates unavailable: API failed and nothing is cached |

Validation is enforced twice on purpose: DTOs own the shape and Swagger docs,
services own the semantic rules (calendar dates, `HH:mm`, city membership,
category enum, currency membership), so direct service calls are testable.

## 13. Limits

| Limit | Value |
|---|---|
| title | 100 characters |
| activity title | 120 characters |
| note | 200 characters |
| days per itinerary | 60 |
| activities per day | 20 |
| images per activity | 5 |
| image size | 1 byte - 5 MB, JPG or PNG only |
| rooms per hotel stay | 1-10, default 1 |
| money | ≥ 0, at most 2 decimals |
| entry currency | 3-letter ISO code from the display currencies (`countries.currency` union `SUPPORTED_CURRENCIES`); defaults to the itinerary currency |
| page size | 10 default, 100 max |
| countries per itinerary | 10 |
| airport pairs per leg | 3 × 3 |

These are enforced in the DTOs and services; the sizes and counts follow the
reviewed requirements workbook (ITN-01, ITN-05, ITN-14, ITN-25, GEN-08).

## 14. Responsibility coverage

The 25 responsibilities of the assignment, each with the test that proves it and
the Swagger route that exercises it. Suite names are under `backend/src/`.

| # | Responsibility | Test | Route |
|---|---|---|---|
| 1 | Itinerary creation, editing, deletion | `itineraries/itineraries.service.spec.ts` | 1, 4, 5 |
| 2 | Validate title, countries, start date | `itineraries/validation.spec.ts`, `itineraries.service.spec.ts` | 1 |
| 3 | Personal listing and details | `itineraries/itineraries.service.spec.ts` | 2, 3 |
| 4 | Day creation and management (city and notes) | `itineraries/days.service.spec.ts` | 10, 12 |
| 5 | Maximum 60 days per itinerary | `itineraries/days.service.spec.ts` | 10 |
| 6 | City selection from the reference dataset | `itineraries/days.service.spec.ts`, `reference-data` service | 27, 10 |
| 7 | Day deletion and automatic renumbering | `itineraries/days.service.spec.ts` | 13 |
| 8 | Day reordering and date recalculation | `itineraries/days.service.spec.ts`, `days-and-dates.spec.ts` | 11 |
| 9 | Group consecutive days by city, with day count and budget subtotal | `itineraries/city-groups.spec.ts`, `budget-summary.service.spec.ts` | 7 |
| 10 | Activity creation, editing, deletion | `itineraries/activities.service.spec.ts` | 14, 15, 16 |
| 11 | Activity image management (JPG/PNG, at most 5 MB) | `itineraries/activities.service.spec.ts` | 17, 18 |
| 12 | Daily budget entries, each in its own currency | `itineraries/budgets.service.spec.ts` | 19, 20, 21 |
| 13 | Transport cost entries between cities (mode, cities, amount, currency, date) | `itineraries/transport-costs.service.spec.ts` | 22, 23, 24 |
| 14 | Budgets by category, day, city group and itinerary, with foreign entries converted into the itinerary currency | `itineraries/budget-summary.service.spec.ts` | 7 |
| 15 | Activity costs included in budgets | `itineraries/budget-totals.spec.ts`, `budget-summary.service.spec.ts` | 7 |
| 16 | Exchange-rate API integration | `currency/fxrates.client.spec.ts` | 28 |
| 17 | Cache rates once daily in MongoDB | `currency/exchange-rates.service.spec.ts` | 28 |
| 18 | Use cached rates when the API fails | `currency/exchange-rates.service.spec.ts` | 28 |
| 19 | Public/private visibility | `itineraries/itineraries.service.spec.ts`, `itineraries-public.service.spec.ts` | 4, 25, 26 |
| 20 | Public search by keyword (title, country, city), duration and country/city, plus the read-only public detail with its budget | `itineraries/itineraries-public.service.spec.ts` | 25, 26 |
| 21 | Clone into an independent private copy | `itineraries/itineraries.service.spec.ts` | 6 |
| 22 | Preserve original-author attribution | `itineraries/itineraries.service.spec.ts`, `itineraries-public.service.spec.ts` | 6, 26 |
| 23 | Hotel search per city group and dates, with guest count and rooms | `itineraries/itinerary-hotels.service.spec.ts` | 8 |
| 24 | One-way or round-trip flight search from a chosen origin airport to the first day city, with default dates | `itineraries/itinerary-flights.service.spec.ts` | 9 |
| 25 | Ownership restrictions on private itineraries | `itineraries/itineraries.service.spec.ts`, `itinerary-hotels/flights.service.spec.ts` | 3–24 |

Shared requirements:

| ID | Where |
|---|---|
| GEN-02 server-side validation | DTOs plus service rules; `validation.spec.ts` |
| GEN-03 destructive actions still authorized | edit/delete re-check the parent owner (`403`), tested in every subdocument suite |
| GEN-04 useful empty results | empty itinerary returns zeroed summary and `[]` lists; hotels/flights return `available: false` with a reason |
| GEN-05 lists paginated, page size 10 | `GET /itineraries`, `GET /itineraries/public/search`, `GET /cities` |
| GEN-13 backend-enforced rules | service-level tests call the service directly, bypassing DTOs |

## 15. Known gaps

- The live Swagger pass ran on 2026-11-15 against a scratch database
  (`travel_planning_verify`) built two ways: the repo seed (`--seed=repo`) gave
  **62 passed, 0 failed, 5 skipped (67 checks)** — the five flight checks that
  need a real departure date skip because that seed writes no flights — and a
  mirror of the shared database (`--seed=existing --mirror`) gave **67 passed,
  0 failed, 0 skipped**. The
  scratch database was dropped and confirmed gone after each run. The seed
  configuration was run once more after the skip counter was corrected
  (`55679f1`), with the same 62/0/5 result. The
  `--seed=existing` path leaves out the `currencies` collection and the admin
  account, which is expected; the harness registered its own users. Route
  registration, the Swagger document, the cookie security of every route and the
  guest/owner split are also covered by
  `itineraries/itineraries.module.spec.ts`, which boots the module graph with a
  stubbed connection and the real `AuthModule`.
- `GET /itineraries/:id/flights` reuses Member 2's flight search, so its results
  depend on that module's data.
- Images are URLs; the field and size rules are enforced here, but the upload
  and storage belong to Member 6.
- `isHidden` is written by nobody yet; Member 6's moderation sets it.
- Hotels return an honest empty answer until Member 3's module lands; the query
  already carries the city, dates, guests and rooms it must answer.
- Airline names are not joined into flight options; only `airlineId` is returned.
- Currency conversion is display-only; bookings stay in `PLATFORM_CURRENCY`.
