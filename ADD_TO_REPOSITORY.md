# Member 6 only

**Eyad El Safty — 16003613**

This is an add-on for the team's NestJS backend. It contains blog posts, comments, likes, tags, author pages, media, reporting/moderation, notifications and administrator audit logging. It includes your own schemas, DTOs, controllers, services, Swagger documentation and tests.

## 1. Copy your files

Work on your feature branch. Copy the contents of this ZIP into the repository, matching these paths:

| Included path | Destination in the team repository |
| --- | --- |
| `backend/src/community/` | `backend/src/community/` |
| `backend/test/member6/` | `backend/test/member6/` |
| `backend/tsconfig.member6-tests.json` | `backend/tsconfig.member6-tests.json` |
| `docs/member6/` | `docs/member6/` |

If the team's NestJS application uses another directory, place the contents of `backend/` inside that application directory instead. Keep the existing `main.ts`, `app.module.ts`, `package.json`, lockfile and other members' files. The `test/member6` files are isolated test support, not production account, hotel, flight or itinerary modules.

Append `docs/member6/AI_PROMPT_ENTRY.txt` to the team's existing AI prompt log. Keep everyone's earlier entries.

## 2. Check dependencies

Use the team's existing NestJS project and install only missing compatible packages. The community source requires `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/mongoose`, `@nestjs/swagger`, `mongoose`, `class-transformer`, `class-validator`, `multer`, `sharp`, `express`, `reflect-metadata` and `rxjs`. The default session adapter also needs the app's cookie parser.

Tested versions: NestJS common/core/platform-express **12.5.0**, NestJS Mongoose **12.0.1**, Swagger **12.1.2**, Mongoose **9.12.1**, Sharp **0.35.5**, Express **5.3.0**, class-validator **0.14.2**, class-transformer **0.5.1**, cookie-parser **1.4.7**, Multer **2.x**, RxJS **7.8.2**, reflect-metadata **0.2.2**. TypeScript was **5.9.3**, Node.js **24.22.1**. Align dependencies with the team's NestJS major version; do not replace its package manifest with a separate one.

## 3. Register the module

In the existing `src/app.module.ts`, add this import:

```ts
import { CommunityModule } from './community/community.module';
```

Add `CommunityModule.register()` to its existing `imports` array. Keep the existing `MongooseModule.forRoot(...)` connection to the team's shared Atlas database. This module uses MongoDB transactions and needs a replica set, which Atlas provides.

In the existing `src/main.ts`, keep the team's bootstrap and ensure these imports and settings exist once:

```ts
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { CommunityExceptionFilter } from './community/http';
```

After creating the Nest app, configure:

```ts
app.use(cookieParser());
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        message: 'Validation failed',
        errors: Object.fromEntries(
          errors.map((error) => [
            error.property,
            Object.values(error.constraints ?? {}),
          ]),
        ),
      }),
  }),
);
app.useGlobalFilters(new CommunityExceptionFilter());
```

If the team already has equivalent validation/error handling, merge these settings into it. The examples and tests use the existing global prefix `api`. Ensure the team's Swagger document includes `CommunityModule`; add `session` cookie authentication and an `X-CSRF-Token` header scheme named `csrf` to its `DocumentBuilder` when using the default session adapter:

```ts
.addCookieAuth('session', { type: 'apiKey', in: 'cookie' }, 'session')
.addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
```

Connect Member 1's verified login through `CommunityIdentity` or the included internal session service. Match the account, review and itinerary fields using `TeamBridge`. These are integration adapters for your endpoints; no registration or password-login API is included. The precise contracts, notification calls and audit calls are in [INTEGRATION.md](docs/member6/INTEGRATION.md).

## 4. Run your tests

The tests additionally need `mongodb-memory-server` **11.3.0**, `supertest` **7.x**, TypeScript, and the types packages for Node.js, Express, Multer, cookie-parser and Supertest. Install missing test dependencies in the team's backend.

From the backend directory:

```sh
npx tsc -p tsconfig.member6-tests.json
node --test --test-concurrency=1 .member6-test-dist/test/member6/community.test.js
```

These tests start a temporary MongoDB replica set; the first run downloads MongoDB and needs internet access. They do not use the team's Atlas database. Add `.member6-test-dist/` to the backend's `.gitignore` before committing.

Only commit your added files, prompt entry and the agreed integration edits. Open a pull request to the team's integration branch. The supplied repository archive had no other members' backend code, so their live authentication, schemas and event calls still need to be checked together.
