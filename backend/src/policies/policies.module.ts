import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';

/** PAY-02 — provider policies shown and accepted before payment. */
@Module({
  imports: [PaymentsModule],
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
