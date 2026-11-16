# Member 6 requirements and coverage

**Eyad El Safty — 16003613**

Sources read in full: the supplied 14-page project description, the user's Member 6 assignment and shared rules, the original repository README/AI prompt log, and the official workbook including mandatory and bonus tabs.

Official workbook: https://drive.google.com/file/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1

Mandatory requirements take priority. HTL-26 moderator review replies, BLG-13 itinerary attachment, ITN-27 booked travel links, ITN-28 PDF export, FLT-28 numbered seat selection, BON-01 provider analytics and BON-02 favourites are implemented in the backend. Email notification delivery (GEN-01-B), email verification (ACC-02), password reset email (ACC-07) and flight change with fare adjustment (FLT-27) remain open. The email worker requires an approved SMTP destination before it can send account or notification content externally.

## Requirement traceability

| ID | Implemented behavior | Main location |
| --- | --- | --- |
| BLG-01 | Required title/body; optional tags; Draft/Published; image attachment through the upload endpoint | BlogService.create, CreatePostDto |
| BLG-02 | Public listing/detail; title, current author, dates, body, tags, images, counts, paginated comments | BlogService.list/detail |
| BLG-03 | Own posts including drafts/hidden posts; title/status/date/like/comment counts | GET /api/posts/mine |
| BLG-04 | Author-only edit/delete; confirmed deletion cascades dependent data | BlogService.update/remove |
| BLG-05 | Non-empty comments, maximum 500 Unicode characters, chronological order | CommentDto, BlogService.comments/addComment |
| BLG-06 | Like once, remove like, accurate count, unique database index, concurrent request coverage | BlogService.like, LikeSchema |
| BLG-07 | Own-comment edit/delete, including retaining moderation state on edits | BlogService.editComment/deleteComment |
| BLG-08 | At most five normalized distinct tags, maximum 30 characters each; editable and searchable tag route | CreatePostDto, TagParamDto, DiscoveryController |
| BLG-09 | Keyword in title/tags/current author name; excerpts; no-results state; likes plus visible comments descending, newest publication first on ties | BlogService.list |
| BLG-10 | Owner image upload/removal with inherited visibility | PostsController, MediaService |
| BLG-12 | Author name/join date, published posts and public itineraries; separate ten-item pages | BlogService.author, TeamBridge |
| GEN-01 | All six mandatory notification event types; own list/unread/read operations; idempotent internal event creation | NotificationsService/Controller |
| GEN-07 | Administrator audit records; atomic moderation logging; read-only paginated administrator API | AuditService, ReportsService |
| GEN-08 | Real JPG/PNG decoding, maximum 5 MB per image; five per post/activity/hotel, one per airline; URL serving and ownership | MediaService, ContentService |
| GEN-09 | Reports for post/comment/review/itinerary with a reason, at most once per user/item, including after resolution | ReportsService.create, unique index |
| GEN-10 | Open report list; dismiss/hide/delete; direct hide/delete; hidden access only for author/admin; audit transaction | ReportsService, ModerationController |
| GEN-02 | Global server validation, trimmed input, unknown-field rejection, field-level messages | Host validation setup, DTOs, CommunityExceptionFilter |
| GEN-03 | confirm=true on destructive content/media actions; independent authorization | ConfirmDto, HideContentDto |
| GEN-04 | Empty items array, zero totals, friendly No results found message | pageResult |
| GEN-05 | Every unbounded API list uses page size 10 | PageDto, all list services |
| GEN-13 | Ownership, roles, account status, privacy and business rules enforced on the server | CommunityGuard, services, schemas |

Password hashing and account authentication implementation remain Member 1's responsibility. The default integration accepts only server-issued opaque sessions after trusted login; it does not add a password/login API or store plaintext credentials.

## All 24 assigned responsibilities

| Number | Responsibility | Coverage / dependency |
| --- | --- | --- |
| 1 | Post creation and management | Implemented |
| 2 | Draft and Published statuses | Implemented and tested through publish/unpublish |
| 3 | Viewing/searching published posts | Implemented |
| 4 | Personal post management | Implemented |
| 5 | Editing/deleting with ownership | Implemented |
| 6 | Comments up to 500 characters | Implemented, including Unicode tests |
| 7 | Comment editing/deletion | Implemented |
| 8 | Duplicate-safe likes | Unique index plus transactional operations |
| 9 | Five tags per post | Implemented, 30 characters per tag |
| 10 | Search title/tags/author | Implemented |
| 11 | Sort by interaction score | Implemented; newest publication is the tie-breaker |
| 12 | Author pages | Implemented against documented users/itineraries contracts |
| 13 | Blog image upload/removal | Implemented |
| 14 | Shared JPG/PNG and 5 MB validation | Implemented |
| 15 | All entity image quantity limits | Implemented and tested |
| 16 | Reporting all four content types | Implemented against the shared content contracts |
| 17 | Duplicate report prevention | Unique index; a resolved report cannot be duplicated |
| 18 | Reporting/moderation logic | Implemented |
| 19 | Dismiss/hide/delete | Implemented, including direct moderation |
| 20 | Mandatory in-app notifications | Shared service implemented; owning modules must call it on their actual events |
| 21 | List/unread/read operations | Implemented |
| 22 | Administrator audit logging | Moderation wired; shared recording API available to Member 1 |
| 23 | Integrate with Member 1 | Contracts and adapters implemented; actual Member 1 code was absent and must be connected |
| 24 | Services for other members | Exported from CommunityModule; integration guide included |

## Shared project rules

- Schemas, DTOs, controllers, services and Swagger operations are included.
- Database-backed tests exercise success, failure, authorization and concurrency.
- A private .env supplies the single shared MongoDB Atlas URI. No Atlas credentials were available or used in this task.
- Code is prepared for a feature branch; no direct main/develop writes were made.
- AI_PROMPT_ENTRY.txt contains only Eyad's entry; append it to the existing team log.
- Dependencies on the other members are documented in INTEGRATION.md. No teammate messages were sent.
- GEN-14–GEN-17 frontend design/responsiveness and actual confirmation dialogs remain Milestone 2 work.
- Whole-team integration must be checked against the current develop branch before the deadline.

## Additional implementation choices

Post titles are capped at 300 characters, bodies at 100,000 characters, report reasons at 2,000 characters, and uploaded images at 40 megapixels as practical input/memory limits. Tags are trimmed, lowercased and deduplicated by validation. Lists use stable IDs as a final sort key.

Media bytes are stored as separate server-side MongoDB documents and served through access-controlled URLs. Text is returned as JSON; the frontend must render it safely.

Comment interaction scores count visible comments. Hiding a comment removes it from public counts and ranking, while its own author and admins may still view it.

Hide/delete resolves all currently open reports for the same target. Dismiss resolves only the selected report. Deleting a post also resolves reports on its deleted comments.
