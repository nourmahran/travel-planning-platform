import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { applyApiPrefix } from '../common/http/api-prefix';
import { MailService, type MailMessage, type MailResult } from './mail.service';
import { NotificationEmailService } from './notification-email.service';

/** Records emails instead of sending them. */
class CapturingMail {
  sent: MailMessage[] = [];
  enabled = true;
  publicUrl() {
    return 'http://localhost:3000';
  }
  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return 'sent';
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

describe('Email bonuses (ACC-02, ACC-07, GEN-01-B)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication;
  let db: Connection;
  const mail = new CapturingMail();
  const saved = { ...process.env };

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      binary: { version: '7.0.24' },
      replSet: { count: 1 },
    });
    process.env.MONGODB_URI = mongo.getUri('email_features_test');
    process.env.JWT_SECRET = 'email-features-test-secret';
    process.env.STRIPE_SECRET_KEY = 'sk_test_email_features';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_email_features';
    process.env.NODE_ENV = 'test';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    applyApiPrefix(app);
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = app.get<Connection>(getConnectionToken());
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    process.env = saved;
  });

  const http = () => request(app.getHttpServer());
  const tokenFrom = (text: string, pattern: RegExp) => {
    const match = pattern.exec(text);
    if (!match) throw new Error(`No token in email: ${text}`);
    return decodeURIComponent(match[1]);
  };
  const register = (email: string) =>
    http()
      .post('/api/auth/register')
      .send({
        name: 'Mail Tester',
        email,
        password: 'Start123!',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
      })
      .expect(201);

  it('ACC-02 emails a single-use verification link on registration', async () => {
    await register('verify@example.com');
    const message = mail.last();
    expect(message.to).toBe('verify@example.com');
    const token = tokenFrom(message.text, /verify-email\?token=(\S+)/);

    const user = await db.collection('users').findOne({ email: 'verify@example.com' });
    expect(user?.emailVerified).toBe(false);
    expect(user?.emailVerificationTokenHash).not.toBe(token); // stored hashed

    await http().get('/api/auth/verify-email').query({ token }).expect(200);
    const verified = await db.collection('users').findOne({ email: 'verify@example.com' });
    expect(verified?.emailVerified).toBe(true);

    await http().get('/api/auth/verify-email').query({ token }).expect(400);
  });

  it('ACC-02 blocks login of unverified accounts only when required', async () => {
    await register('gate@example.com');
    const login = () =>
      http().post('/api/auth/login').send({ email: 'gate@example.com', password: 'Start123!' });

    await login().expect(200);
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    try {
      await login().expect(403);
    } finally {
      delete process.env.REQUIRE_EMAIL_VERIFICATION;
    }
  });

  it('ACC-02 resend answers the same for unknown emails and respects the cooldown', async () => {
    const before = mail.sent.length;
    const unknown = await http()
      .post('/api/auth/resend-verification')
      .send({ email: 'nobody@example.com' })
      .expect(200);
    const known = await http()
      .post('/api/auth/resend-verification')
      .send({ email: 'gate@example.com' })
      .expect(200);
    expect(known.body).toEqual(unknown.body);
    // gate@example.com was emailed at registration less than a minute ago.
    expect(mail.sent.length).toBe(before);
  });

  it('ACC-07 resets a password with the emailed code exactly once', async () => {
    await register('reset@example.com');
    await http().post('/api/auth/login').send({ email: 'reset@example.com', password: 'Start123!' }).expect(200);

    const unknown = await http().post('/api/auth/forgot-password').send({ email: 'ghost@example.com' }).expect(200);
    const known = await http().post('/api/auth/forgot-password').send({ email: 'reset@example.com' }).expect(200);
    expect(known.body).toEqual(unknown.body);

    const code = tokenFrom(mail.last().text, /minutes\):\n\n(\S+)/);
    await http()
      .post('/api/auth/reset-password')
      .send({ token: code, newPassword: 'weak' })
      .expect(400);
    await http()
      .post('/api/auth/reset-password')
      .send({ token: code, newPassword: 'Changed456!' })
      .expect(200);
    await http()
      .post('/api/auth/reset-password')
      .send({ token: code, newPassword: 'Another789!' })
      .expect(400);

    const sessions = await db.collection('refreshsessions').countDocuments({ revokedAt: null });
    expect(sessions).toBe(1); // only gate@example.com's session is still active
    await http().post('/api/auth/login').send({ email: 'reset@example.com', password: 'Start123!' }).expect(401);
    await http().post('/api/auth/login').send({ email: 'reset@example.com', password: 'Changed456!' }).expect(200);
  });

  it('GEN-01-B emails new notifications once and honours the opt-out', async () => {
    const users = db.collection('users');
    const optedIn = await users.findOne({ email: 'verify@example.com' });
    const optedOut = await users.findOne({ email: 'gate@example.com' });
    await users.updateOne({ _id: optedOut!._id }, { $set: { emailNotifications: false } });

    const notifications = db.collection('notifications');
    const now = new Date();
    const base = { type: 'booking.confirmed', message: 'Your flight is confirmed.', link: '/api/flight-bookings/x', createdAt: now, updatedAt: now };
    const inId = new Types.ObjectId();
    const outId = new Types.ObjectId();
    await notifications.insertMany([
      { _id: inId, recipientId: optedIn!._id, eventId: 'e-in', title: 'Booking confirmed', ...base },
      { _id: outId, recipientId: optedOut!._id, eventId: 'e-out', title: 'Booking confirmed', ...base },
    ]);

    const before = mail.sent.length;
    const outbox = app.get(NotificationEmailService);
    await outbox.deliverPending();
    await outbox.deliverPending(); // second run must not resend

    const emails = mail.sent.slice(before);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: 'verify@example.com', subject: 'Booking confirmed' });
    expect(emails[0].text).toContain('http://localhost:3000/api/flight-bookings/x');
    expect((await notifications.findOne({ _id: inId }))?.email?.status).toBe('sent');
    expect((await notifications.findOne({ _id: outId }))?.email?.status).toBe('skipped');
  });
});
