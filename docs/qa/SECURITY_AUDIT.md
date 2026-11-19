# Security audit

Generated 2026-11-19 16:33 UTC. Black-box checks (59/59 passed) plus code review.

## Findings fixed in this pass

| Area | Finding | Fix |
|---|---|---|
| Authorization (ACC-15) | Flights of a deactivated airline could still be booked through the hold endpoint (search hid them). | Booking creation now rejects outbound and return flights of inactive airlines. |
| Audit (GEN-07) | Admin suspensions, reactivations, provider (de)activation, moderator creation and password resets were not audited. | Each admin action is written to the shared audit log. |
| Injection | Admin account search passed user input into a MongoDB $regex unescaped (regex injection / ReDoS). | Input escaped with the shared escapeRegex helper; verified with ".", "(a+)+$". |
| Booking gate (ACC-02) | Unverified accounts could book. | Global guard blocks booking routes until the email is verified. |
| Error responses | Some date-validation errors returned 409 instead of 400. | Hotel calendar/block date validation returns 400. |

## Verified controls

| Control | Evidence |
|---|---|
| Password storage | bcrypt (12 rounds); hash never returned; checked in DB. |
| Session cookies | Access/refresh tokens only in httpOnly, SameSite=Lax cookies; never in JSON bodies. Secure flag in production. |
| CSRF | Double-submit token (csrf_token cookie + x-csrf-token header) required on every authenticated write; wrong header rejected. |
| Session lifetime | 15-minute access token, refresh rotation, revocation on logout, 30-minute inactivity expiry, 5-attempt / 15-minute lockout. |
| Roles and ownership | Guards verified for user, airline moderator, hotel moderator and admin on every module; cross-owner reads return 403/404. |
| Input validation | Global ValidationPipe with whitelist + forbidNonWhitelisted; operator objects ({"$gt":""}) and unknown fields rejected; malformed JSON -> 400. |
| Error leakage | Uniform error body {statusCode, message, timestamp, path}; no stack traces in responses. |
| Uploads (GEN-08) | JPG/PNG only, checked by file signature (fake PNG rejected), 5 MB per image, 5 per post/activity; private itinerary images not served to others. |
| Payments | Card data never reaches the backend (Stripe PaymentIntents); only payment id, amount, currency, status stored; webhook signature verified; duplicate and concurrent events processed once; test-mode key enforced (live keys refused). |
| Internal endpoint | Hotel maintenance endpoint requires x-internal-api-key (constant-time compare). |
| Secrets | .env git-ignored; git history checked: no Stripe secret, webhook secret or MongoDB password was ever committed; .env.example lists every variable without values. |

## Open items (not fixed)

- No HTTP security headers middleware (e.g. helmet) and no global rate limiter; login is protected by the per-account lockout only.
- Secure cookie flag depends on NODE_ENV=production.
- The MongoDB connection string with password was shared in a public ChatGPT link earlier; rotating the database user's password is recommended.
- Reference datasets: the repository's Countries/Cities/Airports/Attractions CSVs were seeded and used, but could not be compared with the official dataset link (not available offline).
