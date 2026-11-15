import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { WebhookAckDto } from './dto/responses.dto';
import { Public } from '../auth/decorators/public.decorator';
import { API_PREFIX } from './payments.config';
import { ApiErrors } from './swagger';
import { WebhookService } from './webhook.service';

@ApiTags('Payments')
@Controller(`${API_PREFIX}/payments`)
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post('webhook')
  @Public() // ACC-19 global JwtAuthGuard: Stripe calls this without a login cookie
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PAY-01: Stripe webhook (called by Stripe, not by users)',
    description:
      'PAY-01 / PAY-03 — Receives Stripe events. No login: authenticity is proven by the stripe-signature header (HMAC of the raw body with the webhook secret). Handles payment_intent.succeeded (confirms the booking, or refunds 100% if the hold already expired), payment_intent.payment_failed, payment_intent.canceled and refund status updates. Each event is processed once. Calling this from Swagger without a valid signature returns 400.',
  })
  @ApiHeader({
    name: 'stripe-signature',
    required: true,
    description: 'Set by Stripe',
  })
  @ApiOkResponse({ type: WebhookAckDto })
  @ApiErrors(
    [400, 'Missing Stripe signature'],
    [400, 'Invalid signature'],
    [500, 'Webhook handling failed (Stripe will retry)'],
  )
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    const event: Stripe.Event = this.webhooks.verify(req.rawBody, signature);
    return this.webhooks.process(event);
  }
}
