import { PaymentSchema, PaymentStatus } from '../schemas/payment.schema';
import {
  PROCESSED_EVENT_TTL_SECONDS,
  ProcessedEventSchema,
} from '../schemas/processed-event.schema';
import { RefundSchema } from '../schemas/refund.schema';

type IndexDef = [Record<string, unknown>, Record<string, unknown>];
const find = (defs: IndexDef[], key: Record<string, unknown>) =>
  defs.find(([k]) => JSON.stringify(k) === JSON.stringify(key));

describe('payment schemas', () => {
  it('Payment: unique PI id and one Succeeded payment per booking', () => {
    const defs = PaymentSchema.indexes() as IndexDef[];
    expect(find(defs, { stripePaymentIntentId: 1 })?.[1]).toMatchObject({
      unique: true,
    });
    expect(
      find(defs, { bookingType: 1, bookingId: 1, status: 1 }),
    ).toBeDefined();
    expect(find(defs, { bookingType: 1, bookingId: 1 })?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { status: PaymentStatus.Succeeded },
    });
  });

  it('Payment: amount must be an integer number of minor units', () => {
    const path = PaymentSchema.path('amount') as unknown as {
      validators: Array<{ validator: (v: number) => boolean }>;
    };
    const isInt = path.validators.find((v) => v.validator === Number.isInteger);
    expect(isInt).toBeDefined();
  });

  it('Refund: one refund per booking, sparse unique Stripe refund id', () => {
    const defs = RefundSchema.indexes() as IndexDef[];
    expect(find(defs, { bookingType: 1, bookingId: 1 })?.[1]).toMatchObject({
      unique: true,
    });
    expect(find(defs, { stripeRefundId: 1 })?.[1]).toMatchObject({
      unique: true,
      sparse: true,
    });
  });

  it('ProcessedEvent: unique event id with a 30-day TTL', () => {
    const defs = ProcessedEventSchema.indexes() as IndexDef[];
    expect(find(defs, { eventId: 1 })?.[1]).toMatchObject({ unique: true });
    expect(find(defs, { processedAt: 1 })?.[1]).toMatchObject({
      expireAfterSeconds: PROCESSED_EVENT_TTL_SECONDS,
    });
    expect(PROCESSED_EVENT_TTL_SECONDS).toBe(2_592_000);
  });
});
