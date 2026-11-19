import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { MailService } from './mail.service';

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MS = 10 * 60 * 1000;

interface NotificationDoc {
  _id: unknown;
  recipientId: unknown;
  title?: string;
  message?: string;
  link?: string;
  email?: { attempts?: number };
}

interface RecipientDoc {
  email?: string;
  name?: string;
  status?: string;
  emailNotifications?: boolean;
}

/**
 * GEN-01-B (optional): emails a copy of each in-app notification.
 *
 * Every module writes notifications straight into the shared "notifications"
 * collection, so instead of changing each writer this job works as an outbox:
 * it atomically claims notifications that have no email status yet, emails
 * the recipient (unless they turned email notifications off) and records the
 * outcome on the notification. Only notifications created after the server
 * started are emailed, so an old backlog is never sent.
 */
@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);
  private readonly startedAt = new Date();
  private running = false;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly mail: MailService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'email-notifications' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.deliverPending();
    } catch (error) {
      this.logger.warn(
        `Notification email run failed: ${(error as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Processes up to one batch; returns how many notifications it handled. */
  async deliverPending(now = new Date()): Promise<number> {
    const notifications = this.connection.collection<NotificationDoc>(
      'notifications',
    );
    const users = this.connection.collection<RecipientDoc>('users');
    let handled = 0;

    for (; handled < BATCH_SIZE; handled++) {
      const claimed = await notifications.findOneAndUpdate(
        {
          createdAt: { $gte: this.startedAt },
          $or: [
            { 'email.status': { $exists: false } },
            {
              'email.status': 'sending',
              'email.claimedAt': {
                $lt: new Date(now.getTime() - STALE_CLAIM_MS),
              },
            },
          ],
        },
        { $set: { 'email.status': 'sending', 'email.claimedAt': now } },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      );
      if (!claimed) break;

      const recipient = await users.findOne(
        { _id: claimed.recipientId as never },
        { projection: { email: 1, name: 1, status: 1, emailNotifications: 1 } },
      );

      let status: string;
      if (
        !recipient?.email ||
        recipient.status !== 'active' ||
        recipient.emailNotifications === false
      ) {
        status = 'skipped';
      } else {
        const result = await this.mail.send({
          to: recipient.email,
          subject: claimed.title ?? 'New notification',
          text: this.body(recipient.name, claimed),
        });
        const attempts = (claimed.email?.attempts ?? 0) + 1;
        if (result === 'failed' && attempts < MAX_ATTEMPTS) {
          await notifications.updateOne(
            { _id: claimed._id as never },
            { $unset: { 'email.status': '' }, $set: { 'email.attempts': attempts } },
          );
          continue;
        }
        status = result;
      }
      await notifications.updateOne(
        { _id: claimed._id as never },
        { $set: { 'email.status': status, 'email.at': new Date() } },
      );
    }
    return handled;
  }

  private body(name: string | undefined, notification: NotificationDoc) {
    const link = notification.link
      ? `\n\nOpen: ${this.mail.publicUrl()}${notification.link}`
      : '';
    return (
      `Hello ${name ?? 'traveller'},\n\n` +
      `${notification.message ?? notification.title ?? ''}${link}\n\n` +
      'You can turn these emails off with PATCH /api/users/me {"emailNotifications": false}.'
    );
  }
}
