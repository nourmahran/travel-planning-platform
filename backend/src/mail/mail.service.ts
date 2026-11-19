import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** sent: handed to the SMTP server; logged: no SMTP configured (dev only); failed: SMTP error. */
export type MailResult = 'sent' | 'logged' | 'failed';

/**
 * Outgoing email for the optional bonuses ACC-02, ACC-07 and GEN-01-B.
 *
 * Email goes only to the SMTP server named in backend/.env (SMTP_HOST, ...).
 * Without SMTP_HOST nothing is sent: outside production the message is
 * written to the server log so the flows can still be tried from Swagger.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('SMTP_HOST')?.trim();
    const user = config.get<string>('SMTP_USER')?.trim();
    this.from =
      config.get<string>('MAIL_FROM')?.trim() ||
      'Travel Planning Platform <no-reply@travel-platform.test>';
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: Number(config.get<string>('SMTP_PORT') ?? 587),
          secure: config.get<string>('SMTP_SECURE') === 'true',
          auth: user
            ? { user, pass: config.get<string>('SMTP_PASS') ?? '' }
            : undefined,
        })
      : null;
  }

  /** True when an SMTP server is configured. */
  get enabled(): boolean {
    return this.transporter !== null;
  }

  /** Base URL used in links inside emails (the backend unless set). */
  publicUrl(): string {
    return (
      this.config.get<string>('APP_PUBLIC_URL')?.replace(/\/+$/, '') ||
      `http://localhost:${this.config.get<string>('PORT') ?? 3000}`
    );
  }

  async send(message: MailMessage): Promise<MailResult> {
    if (!this.transporter) {
      if (this.config.get<string>('NODE_ENV') !== 'production') {
        this.logger.log(
          `SMTP not configured; email not sent.\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
        );
      }
      return 'logged';
    }
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
      return 'sent';
    } catch (error) {
      this.logger.warn(
        `Email to ${message.to} failed: ${(error as Error).message}`,
      );
      return 'failed';
    }
  }
}
