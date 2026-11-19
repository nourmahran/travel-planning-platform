import { INestApplication, RequestMethod } from '@nestjs/common';

/** Every REST route is served under /api, matching the project description (section 8). */
export const API_GLOBAL_PREFIX = 'api';

export function applyApiPrefix(app: INestApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX, {
    // The root health/hello route stays at "/" so Swagger UI can own GET /api.
    exclude: [{ path: '/', method: RequestMethod.GET }],
  });
}
