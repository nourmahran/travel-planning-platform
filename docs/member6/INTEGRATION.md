# Member 6 integration

Owner: **Eyad El Safty, 16003613**

## What must be agreed before the team merge

The uploaded repository contains no other members' backend code. The following defaults are explicit integration contracts, not claims about an existing implementation.

| Member | Integration needed |
| --- | --- |
| Member 1 | Connect verified authentication to CommunityIdentity or CommunitySessionsService. Use the exported audit and notification services in account/provider actions. Avoid duplicate admin moderation routes. |
| Flights / bookings owner | Send booking confirmation/cancellation and schedule-change notifications after verified state changes. Use MediaService for airline logos. |
| Hotels / reviews owner | Match the review/hotel contract or adapt TeamBridge. Use the shared media limit and apply hidden-review visibility and rating rules. |
| Payments owner | Send refund notifications with stable event IDs after refund state changes. |
| Itineraries owner | Match the itinerary/activity contract or adapt TeamBridge. Enforce hidden/private access in itinerary endpoints and use MediaService. |

Do not register parallel models with conflicting schemas for posts, comments, likes, media, reports, notifications or audit_logs.

## NestJS registration

Add CommunityModule.register() to the imports in the existing team AppModule. Keep the team's single shared Mongoose root connection. This add-on deliberately provides no AppModule, main.ts or package.json.

The module exports BlogService, ContentService, MediaService, ReportsService, NotificationsService, AuditService, CommunitySessionsService, CommunityStore, CommunityIdentity and TeamBridge.

CommunityModule.register() accepts imports, identityProvider and bridgeProvider. These allow Member 1 and the other domain owners to replace integration adapters while keeping Member 6's API and business logic.

## Authentication

### Default integration

The default MongoSessionIdentity accepts an opaque **session** cookie. Only its SHA-256 hash is stored in community_sessions. It checks the current account on every request, rejects suspended/deactivated accounts and pending mandatory password changes, and expires a session after 30 minutes without an authenticated request. Sessions also have a 24-hour absolute lifetime.

After Member 1 verifies the password and completes any required password change:

    const session = await this.communitySessions.issue(user._id.toString());
    this.communitySessions.setCookies(response, session);

Call issue only from trusted backend authentication logic. It does not verify a password and is not a public login API.

The session cookie is httpOnly and SameSite=Strict. Secure is enabled outside explicit development/test mode. The separate csrf cookie is readable because it contains a CSRF value, not an authentication token. Send it in the X-CSRF-Token header for writes. Do not return the session token in browser-readable JSON or store it in localStorage/sessionStorage.

Logout must revoke the token through CommunitySessionsService.revoke() and clear both cookies. Member 1 continues to own registration, password hashes, login lockout, refresh-token lifecycle, password changes and account administration.

### Existing Member 1 cookie authentication

If Member 1 has a different session or JWT implementation, provide an adapter extending CommunityIdentity:

    @Injectable()
    export class TeamIdentity extends CommunityIdentity {
      constructor(private readonly auth: AuthService) {
        super();
      }

      async resolve(request: Request): Promise<Actor | undefined> {
        return this.auth.resolveVerifiedCommunityActor(request);
      }
    }

Register it using:

    CommunityModule.register({
      imports: [AuthCoreModule],
      identityProvider: { provide: CommunityIdentity, useClass: TeamIdentity },
    })

The adapter must verify the actual cookie, expiry/revocation, inactivity, account status and CSRF on writes. Return undefined only for a guest. Never derive identity or roles from request bodies, query parameters, X-User-Id or X-Role headers. The default CommunityGuard ignores those identity claims.

## Account contract

TeamBridge reads public/safe fields from the **users** collection. MongoDB IDs are ObjectId values, not strings.

| Field | Expected value |
| --- | --- |
| _id | ObjectId |
| name | Current public name |
| role | user, admin, hotel_moderator or airline_moderator |
| status | active, suspended or deactivated |
| createdAt | Date, used as the author's join date |
| mustChangePassword | Optional boolean |
| assignedHotelId | ObjectId for a hotel moderator |
| assignedAirlineId | ObjectId for an airline moderator |

No user schema is registered or written by the production community module. Registration and password security remain with Member 1. The isolated test fixtures have no usable password login.

Public post search joins the collection named by TeamBridge.accountsCollection and uses name/status. If your account collection or field names differ, adapt this join and TeamBridge.account together. Author names are read live, not copied permanently into posts.

Deactivated authors' posts and public itineraries are hidden. Their comments and reviews use the Deleted user label through TeamBridge.authorLabel(). Suspension by itself does not hide already-public content.

## External content contract

These defaults are centralized in TeamBridge. Adapt this class if the owning member uses different collections, field names or embedded structures.

| Collection | Fields needed by Member 6 |
| --- | --- |
| itineraries | _id, authorId, title, visibility (Public/Private), hidden, countries, startDate, createdAt, updatedAt |
| activities | _id, itineraryId |
| reviews | _id, authorId, hotelId, rating, body, hidden |
| hotels | _id, active, averageRating, ratingCount |
| airlines | _id, active |
| itinerary_days, budgets, transport_costs | itineraryId for cascade deletion |

The default itinerary deletion removes its own days, activities, budgets, transport costs and activity images. It does not delete clones owned by other users. If these are embedded in the itinerary document or use another relation, adapt TeamBridge.remove().

Review hide/delete recalculates the hotel's average from visible reviews. It leaves bookings and review eligibility to the hotel module. The owning member must apply the same visible-review rule on their own review endpoints.

### Apply visibility in the owning modules

Hidden is separate from a post's Draft/Published state or an itinerary's Public/Private visibility.

Before returning an individual itinerary or review:

    await this.contentService.readable(ContentType.Itinerary, itineraryId, actor);

Use ContentType.Review for reviews. A hidden item is returned only to its author or an administrator. Private itineraries are not public even when hidden is false.

Public lists/searches in other modules must filter hidden != true. Public itineraries must also have visibility=Public and a non-deactivated author. Do not expose drafts, private itineraries or hidden content through alternative endpoints, static media folders or aggregations.

Activity images inherit the itinerary's privacy and moderation state. Blog images inherit the post's state. Media bytes are served only through the guarded /api/media/:id route.

### Coordinate concurrent writes

Member 6 serializes changes using transactions and an increment of communityVersion on the parent content record. When another member edits/deletes a shared parent, use the same connection and transaction protocol:

    await this.store.transaction(async (session) => {
      await this.contentService.lock(ContentType.Itinerary, itineraryId, session);
      await this.itineraries.updateOne(filter, update, { session });
    });

Activity changes should lock the parent itinerary before the activity. Review mutations that affect ratings must update/lock the parent hotel and recalculate visible ratings within the same transaction. This keeps moderation, deletion and uploads consistent with the owning module.

## Mandatory notifications

Notification creation is an internal backend service, not an HTTP endpoint users can call. Call NotificationsService.send() from verified business events.

| NotificationType | Required trigger |
| --- | --- |
| BookingConfirmed | Successful flight/hotel payment verification and confirmation |
| BookingCancelled | User/provider booking cancellation |
| RefundUpdated | Refund creation or status change |
| FlightScheduleChanged | Time change affecting Confirmed bookings |
| AccountSuspended | Account suspension |
| ProviderSuspended | Hotel/airline deactivation affecting users/moderators |

Example:

    await this.notifications.send({
      recipientId: booking.userId.toString(),
      eventId: 'booking:' + booking._id + ':confirmed',
      type: NotificationType.BookingConfirmed,
      title: 'Booking confirmed',
      message: 'Your booking ' + booking.reference + ' is confirmed.',
      link: '/bookings/' + booking._id,
    }, session);

Use one stable eventId per actual event and recipient. Retrying the same event will not duplicate the notification or reset its read status. A new refund status or schedule revision needs its own event ID.

Pass the existing MongoDB ClientSession to make notification persistence atomic with the business change. Never send a confirmation before payment verification. Pass descriptive booking details in message; do not include card details or credentials.

Suspension notifications can be stored for unavailable accounts. Those users can read them after their account becomes accessible again.

## Audit logging for Member 1

Moderation actions are already logged atomically by ReportsService. Member 1 must call AuditService.record for suspensions, reactivations and other important administrator actions.

    await this.audit.record(actor, {
      action: 'account.suspended',
      targetType: 'account',
      targetId: userId,
      details: {
        previousStatus: 'active',
        nextStatus: 'suspended',
        note: reason,
      },
    }, session);

Use the verified administrator actor and the same transaction as the account/provider change. Details should contain status changes and reasons, never passwords, tokens or connection strings.

Audit APIs are read-only. No update/delete audit endpoint is exposed.

## Media storage and limits

Images are stored server-side as individual MongoDB binary documents. At most 5 MB per image keeps each document below MongoDB's document-size limit. This makes media and parent deletion transactional and allows every image request to enforce current visibility. There is no publicly readable upload directory.

The shared validator decodes and normalizes real JPG/PNG bytes, verifies the MIME and extension, removes metadata, and rejects corrupted content. It rejects images over 40 megapixels as a memory safeguard, in addition to the required 5 MB size limit.

Post/activity/hotel limits are five images; an airline may have one logo. These totals are checked inside the parent transaction, including simultaneous uploads.

Use POST /api/posts/:id/images for posts, POST /api/activities/:id/images for activities, or POST /api/media/:targetType/:targetId/images for any supported target. Use multipart field **images**.

## Confirmations and frontend responsibilities

Destructive content/image delete and moderation hide/delete APIs require a JSON body with confirm=true. The Milestone 2 frontend must show the actual confirmation dialog before sending it. This flag does not replace ownership or administrator checks.

The frontend must render blog/comment text safely, display field errors, use the server's ten-item pagination, handle empty lists, and introduce the required loading/responsive states. These UI requirements are outside this backend delivery.
