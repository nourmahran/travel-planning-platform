# Confirmed flight changes (FLT-27 bonus)

The owner may change one Confirmed booking once, before departure, to another future Scheduled flight on the same route and cabin. A round-trip booking may change either leg while preserving the order of the two flights. The replacement flight's seats are held for ten minutes. A changed booking keeps its reference and ownership.

1. `GET /bookings/:id/change-preview?flightId=<new flight ID>&leg=outbound|return` returns the stored leg fare, replacement fare, amount due or refund, and seats required. This is read-only.
2. `POST /bookings/:id/change` with `{ "flightId": "...", "leg": "outbound" }` reserves replacement seats. If the replacement costs more, the response contains `payment: { bookingType: "flight_change", bookingId: "<change ID>" }`.
3. Use that object with `POST /api/payments` and confirm its PaymentIntent through Stripe. Only the verified `payment_intent.succeeded` webhook switches the booked flight, releases the old seats and updates the total. If the hold expired or the original booking changed, the replacement seats are released and a late charge is refunded.
4. A zero or lower fare switches flights immediately. A lower fare creates an idempotent Stripe refund for the difference; failures are retained for retry.

After a paid increase, cancellation previews and user/provider cancellation refunds include both the original and extra payments. The change can be requested once per booking to keep the refund ledger bounded to one adjustment. The original accepted cancellation policy remains attached to the booking. This flow needs a live Stripe test-mode run when the test key and webhook secret are available; automated tests use a simulated Stripe client and real MongoDB replica set.
