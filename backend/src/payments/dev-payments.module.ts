import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  DevPaymentsController,
  DevPaymentsEnabledGuard,
} from './dev-payments.controller';
import { assertDevFlagSafe, isDevPaymentsEnabled } from './payments.config';
import { PaymentsModule } from './payments.module';

/**
 * Registers the dev confirm endpoint (Task 12) ONLY when
 * ENABLE_DEV_PAYMENT_ENDPOINTS=true and NODE_ENV != production.
 *
 * It is a dynamic module because the decision depends on .env, which
 * ConfigModule loads at startup — we wait for that before deciding.
 * When disabled, the route does not exist at all (and is not in Swagger).
 */
@Module({})
export class DevPaymentsModule {
  static async register(): Promise<DynamicModule> {
    await ConfigModule.envVariablesLoaded;
    const env = { get: <T>(key: string) => process.env[key] as T | undefined };
    assertDevFlagSafe(env);
    const enabled = isDevPaymentsEnabled(env);
    return {
      module: DevPaymentsModule,
      imports: [PaymentsModule],
      controllers: enabled ? [DevPaymentsController] : [],
      providers: [DevPaymentsEnabledGuard],
    };
  }
}
