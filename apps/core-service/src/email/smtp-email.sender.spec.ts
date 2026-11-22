import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { SmtpEmailSender } from './smtp-email.sender';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('SmtpEmailSender', () => {
  const mockedCreateTransport = createTransport as jest.MockedFunction<typeof createTransport>;
  const sendMailMock = jest.fn();

  function buildConfigService(overrides: Record<string, string | undefined> = {}): ConfigService {
    const values: Record<string, string | undefined> = {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_FROM: 'MoneyFlow <no-reply@moneyflow.local>',
      FRONTEND_URL: 'http://localhost:3001',
      ...overrides,
    };

    return {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    sendMailMock.mockResolvedValue({ messageId: 'msg-1' });
    mockedCreateTransport.mockReturnValue({
      sendMail: sendMailMock,
    } as unknown as ReturnType<typeof createTransport>);
  });

  it('creates transporter with configured Mailpit host/port and sends verification link', async () => {
    const sender = new SmtpEmailSender(buildConfigService());

    await sender.sendEmailVerification({
      to: 'ana@example.com',
      fullName: 'Ana <MoneyFlow>',
      rawToken: 'abc123token',
      expiresInHours: 24,
    });

    expect(mockedCreateTransport).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 1025,
      secure: false,
      ignoreTLS: true,
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mailCall = sendMailMock.mock.calls[0] as [
      {
        from: string;
        to: string;
        text: string;
        html: string;
      },
    ];
    const mailArgs = mailCall[0];
    expect(mailArgs.from).toBe('MoneyFlow <no-reply@moneyflow.local>');
    expect(mailArgs.to).toBe('ana@example.com');
    expect(mailArgs.text).toContain('http://localhost:3001/verify-email?token=abc123token');
    expect(mailArgs.html).toContain('Ana &lt;MoneyFlow&gt;');
  });

  it('rejects invalid SMTP_PORT values outside 1..65535', () => {
    expect(() => new SmtpEmailSender(buildConfigService({ SMTP_PORT: '99999' }))).toThrow(
      'Invalid SMTP_PORT value: must be an integer between 1 and 65535',
    );
    expect(() => new SmtpEmailSender(buildConfigService({ SMTP_PORT: 'not-a-port' }))).toThrow(
      'Invalid SMTP_PORT value: must be an integer between 1 and 65535',
    );
  });

  it('sanitizes SMTP errors and never leaks rawToken or verification URL', async () => {
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1025'), { code: 'ECONNREFUSED' }),
    );
    const sender = new SmtpEmailSender(buildConfigService());

    await expect(
      sender.sendEmailVerification({
        to: 'ana@example.com',
        fullName: 'Ana',
        rawToken: 'super-secret-raw-token',
        expiresInHours: 24,
      }),
    ).rejects.toThrow('SMTP delivery failed (ECONNREFUSED)');
  });

  it('sends password reset link with escaped fullName and sanitizes SMTP errors', async () => {
    const sender = new SmtpEmailSender(buildConfigService());

    await sender.sendPasswordReset({
      to: 'ana@example.com',
      fullName: 'Ana <Admin>',
      rawToken: 'reset-secret-token',
      expiresInMinutes: 60,
    });

    const mailCall = sendMailMock.mock.calls[0] as [
      {
        from: string;
        to: string;
        text: string;
        html: string;
      },
    ];
    const mailArgs = mailCall[0];
    expect(mailArgs.to).toBe('ana@example.com');
    expect(mailArgs.text).toContain(
      'http://localhost:3001/reset-password?token=reset-secret-token',
    );
    expect(mailArgs.text).toContain('60 minutos');
    expect(mailArgs.html).toContain('Ana &lt;Admin&gt;');

    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error('ETIMEDOUT super-secret-reset-token'), { code: 'ETIMEDOUT' }),
    );

    await expect(
      sender.sendPasswordReset({
        to: 'ana@example.com',
        fullName: 'Ana',
        rawToken: 'super-secret-reset-token',
        expiresInMinutes: 60,
      }),
    ).rejects.toThrow('SMTP delivery failed (ETIMEDOUT)');
  });
});
