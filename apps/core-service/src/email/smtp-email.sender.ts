import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { EmailSender, SendEmailVerificationInput } from './email-sender.port';

const DEFAULT_SMTP_HOST = '127.0.0.1';
const DEFAULT_SMTP_PORT = 1025;
const DEFAULT_SMTP_FROM = 'MoneyFlow <no-reply@moneyflow.local>';
const DEFAULT_FRONTEND_URL = 'http://localhost:3001';

function parseSmtpPort(rawPort: string | undefined): number {
  if (rawPort === undefined || rawPort.trim().length === 0) {
    return DEFAULT_SMTP_PORT;
  }

  const parsed = Number(rawPort.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid SMTP_PORT value: must be an integer between 1 and 65535`);
  }

  return parsed;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly logger = new Logger(SmtpEmailSender.name);
  private readonly transporter: Transporter;
  private readonly fromAddress: string;
  private readonly frontendUrl: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST')?.trim() || DEFAULT_SMTP_HOST;
    const port = parseSmtpPort(this.configService.get<string>('SMTP_PORT'));

    this.fromAddress = this.configService.get<string>('SMTP_FROM')?.trim() || DEFAULT_SMTP_FROM;
    this.frontendUrl = (
      this.configService.get<string>('FRONTEND_URL')?.trim() || DEFAULT_FRONTEND_URL
    ).replace(/\/+$/, '');

    this.transporter = createTransport({
      host,
      port,
      secure: false,
      ignoreTLS: true,
    });
  }

  async sendEmailVerification(input: SendEmailVerificationInput): Promise<void> {
    const verificationUrl = `${this.frontendUrl}/verify-email?token=${encodeURIComponent(input.rawToken)}`;
    const safeName = escapeHtml(input.fullName);

    const text = [
      `Hola ${input.fullName},`,
      '',
      'Gracias por registrarte en MoneyFlow. Para verificar tu correo electrónico, abre el siguiente enlace:',
      verificationUrl,
      '',
      `Este enlace expirará en ${input.expiresInHours} horas.`,
      'Si no creaste esta cuenta, puedes ignorar este mensaje.',
    ].join('\n');

    const html = [
      `<p>Hola <strong>${safeName}</strong>,</p>`,
      '<p>Gracias por registrarte en MoneyFlow. Para verificar tu correo electrónico, haz clic en el siguiente enlace:</p>',
      `<p><a href="${verificationUrl}">Verificar correo electrónico</a></p>`,
      `<p>Este enlace expirará en ${input.expiresInHours} horas.</p>`,
      '<p>Si no creaste esta cuenta, puedes ignorar este mensaje.</p>',
    ].join('');

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: input.to,
        subject: 'Verifica tu correo en MoneyFlow',
        text,
        html,
      });
    } catch (error) {
      const rawCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      const safeErrorCode =
        typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : 'SMTP_ERROR';
      this.logger.warn(
        `SMTP delivery failed during email verification dispatch (code=${safeErrorCode})`,
      );
      throw new Error(`SMTP delivery failed (${safeErrorCode})`);
    }
  }
}
