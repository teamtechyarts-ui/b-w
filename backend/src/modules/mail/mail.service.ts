import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: nodemailer.SendMailOptions['attachments'];
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly smtpUser?: string;
  private readonly smtpAppPassword?: string;
  private readonly smtpFromName: string;

  constructor(private readonly config: ConfigService) {
    this.smtpUser = this.config.get<string>('SMTP_USER')?.trim();
    this.smtpAppPassword = this.config.get<string>('SMTP_APP_PASSWORD')?.trim();
    this.smtpFromName =
      this.config.get<string>('SMTP_FROM_NAME')?.trim() || 'Bright & White Laundry';

    if (this.smtpUser && this.smtpAppPassword) {
      // Clean any accidental spaces from Google App Password (e.g., 'xxxx yyyy zzzz wwww')
      const sanitizedPassword = this.smtpAppPassword.replace(/\s+/g, '');
      this.transporter = nodemailer.createTransport({
        pool: true,
        service: 'gmail',
        maxConnections: 3,
        maxMessages: 100,
        auth: {
          user: this.smtpUser,
          pass: sanitizedPassword,
        },
      });
      this.logger.log('Nodemailer Gmail SMTP pooled transport initialized.');
    } else {
      const missing: string[] = [];
      if (!this.smtpUser) missing.push('SMTP_USER');
      if (!this.smtpAppPassword) missing.push('SMTP_APP_PASSWORD');
      this.logger.warn(
        `SMTP service is unconfigured. Missing environment variable(s): ${missing.join(', ')}.`,
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.transporter && this.smtpUser && this.smtpAppPassword);
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn('SMTP verification skipped: transport is not configured.');
      return false;
    }

    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified successfully.');
      return true;
    } catch (error: any) {
      this.logger.error(`SMTP verification failed: ${error?.message || 'Unknown error'}`);
      return false;
    }
  }

  private cachedLogoAttachment: nodemailer.SendMailOptions['attachments'] | null = null;
  private logoSearched = false;

  getLogoAttachment(): nodemailer.SendMailOptions['attachments'] {
    if (this.logoSearched) {
      return this.cachedLogoAttachment || undefined;
    }

    const candidates = [
      path.resolve(__dirname, '../../assets/bw_logo.png'),
      path.resolve(__dirname, '../assets/bw_logo.png'),
      path.resolve(__dirname, 'assets/bw_logo.png'),
      path.resolve(process.cwd(), 'src/assets/bw_logo.png'),
      path.resolve(process.cwd(), 'dist/src/assets/bw_logo.png'),
      path.resolve(process.cwd(), 'dist/assets/bw_logo.png'),
      'd:/techyArts/B-W/backend/src/assets/bw_logo.png',
    ];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          this.cachedLogoAttachment = [
            {
              filename: 'bw_logo.png',
              path: candidate,
              cid: 'bwlogo',
            },
          ];
          break;
        }
      } catch {
        // Continue searching
      }
    }
    this.logoSearched = true;
    return this.cachedLogoAttachment || undefined;
  }

  async sendMail(options: SendMailOptions): Promise<void> {
    if (!this.transporter || !this.smtpUser) {
      throw new ServiceUnavailableException(
        'Email delivery is currently unavailable. SMTP credentials are not configured.',
      );
    }

    const fromAddress = `"${this.smtpFromName}" <${this.smtpUser}>`;

    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
      });

      // Mask email for privacy in logs (e.g. jo***@example.com)
      const maskedTo = this.maskEmail(options.to);
      this.logger.log(`Email successfully dispatched to ${maskedTo} [Subject: "${options.subject}"]`);
    } catch (error: any) {
      const maskedTo = this.maskEmail(options.to);
      this.logger.error(
        `Failed to dispatch email to ${maskedTo}: ${error?.message || 'SMTP delivery failed'}`,
      );
      throw new ServiceUnavailableException('Failed to deliver email. Please try again later.');
    }
  }

  /**
   * Send Email Verification OTP to newly registered user
   */
  async sendEmailVerificationOtp(to: string, otp: string, expiresInMinutes: number = 10): Promise<void> {
    const subject = 'Verify Your Email Address — Bright & White Laundry';
    const text = this.buildEmailVerificationText(otp, expiresInMinutes);
    const html = this.buildEmailVerificationHtml(otp, expiresInMinutes);
    const attachments = this.getLogoAttachment();

    await this.sendMail({
      to,
      subject,
      text,
      html,
      attachments,
    });
  }

  /**
   * Send Password Reset OTP
   */
  async sendPasswordResetOtp(to: string, otp: string, expiresInMinutes: number = 10): Promise<void> {
    const subject = 'Your Password Reset Code — Bright & White Laundry';
    const text = this.buildPasswordResetText(otp, expiresInMinutes);
    const html = this.buildPasswordResetHtml(otp, expiresInMinutes);
    const attachments = this.getLogoAttachment();

    await this.sendMail({
      to,
      subject,
      text,
      html,
      attachments,
    });
  }

  private buildEmailVerificationText(otp: string, expiresInMinutes: number): string {
    return [
      'Bright & White Laundry — Verify Your Email Address',
      '',
      'Thank you for registering with Bright & White Laundry!',
      '',
      `Your verification code is: ${otp}`,
      '',
      `This code will expire in ${expiresInMinutes} minutes.`,
      '',
      'Please enter this 6-digit code in the application to complete your email verification.',
      '',
      'For your security, never share this code with anyone. Bright & White staff will never ask for your verification code.',
      '',
      'If you did not register for an account with Bright & White Laundry, please disregard this email. Your email address will remain unverified.',
      '',
      '— Bright & White Laundry Platform',
    ].join('\n');
  }

  private buildEmailVerificationHtml(otp: string, expiresInMinutes: number): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email Address</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1E293B;
      line-height: 1.6;
    }
    .wrapper {
      width: 100%;
      background-color: #F8FAFC;
      padding: 40px 16px;
      box-sizing: border-box;
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      background-color: #FFFFFF;
      border-radius: 16px;
      border: 1px solid #E2E8F0;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
    }
    .header {
      background: #FFFFFF;
      padding: 32px 24px 20px;
      text-align: center;
      border-bottom: 1px solid #F1F5F9;
    }
    .brand-logo {
      max-width: 160px;
      height: auto;
      display: inline-block;
      margin-bottom: 8px;
    }
    .content {
      padding: 36px 32px;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      color: #0F172A;
      margin-top: 0;
      margin-bottom: 12px;
      text-align: center;
    }
    .description {
      font-size: 15px;
      color: #475569;
      margin-bottom: 24px;
      text-align: center;
    }
    .otp-container {
      background-color: #F0F9FF;
      border: 2px dashed #38BDF8;
      border-radius: 12px;
      padding: 24px 16px;
      text-align: center;
      margin: 28px 0;
    }
    .otp-code {
      font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: 10px;
      color: #0284C7;
      margin: 0;
      padding-left: 10px;
    }
    .otp-expiry {
      font-size: 13px;
      color: #0369A1;
      font-weight: 600;
      margin-top: 10px;
    }
    .instruction-notice {
      background-color: #F8FAFC;
      border: 1px solid #E2E8F0;
      padding: 14px 16px;
      border-radius: 8px;
      font-size: 13px;
      color: #334155;
      margin: 20px 0;
      text-align: center;
    }
    .security-notice {
      background-color: #FEF3C7;
      border-left: 4px solid #F59E0B;
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 13px;
      color: #92400E;
      margin: 24px 0;
    }
    .disclaimer {
      font-size: 13px;
      color: #64748B;
      margin-top: 24px;
      border-top: 1px solid #F1F5F9;
      padding-top: 20px;
    }
    .footer {
      background-color: #F8FAFC;
      border-top: 1px solid #E2E8F0;
      padding: 20px 24px;
      text-align: center;
      font-size: 12px;
      color: #94A3B8;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <img src="cid:bwlogo" alt="Bright &amp; White Laundry" class="brand-logo" />
      </div>
      <div class="content">
        <h2 class="title">Verify Your Email Address</h2>
        <p class="description">
          Thank you for joining <strong>Bright &amp; White Laundry</strong>! Please enter the 6-digit verification code below in the app to activate your account.
        </p>
        <div class="otp-container">
          <div class="otp-code">${otp}</div>
          <div class="otp-expiry">&#9200; Code expires in ${expiresInMinutes} minutes</div>
        </div>
        <div class="instruction-notice">
          Enter this code directly in the application. Do not share or forward this email.
        </div>
        <div class="security-notice">
          <strong>Security Notice:</strong> Never share this code with anyone. Bright &amp; White representatives will never ask for your code.
        </div>
        <div class="disclaimer">
          If you did not initiate this account registration with Bright &amp; White Laundry, please disregard this email. Your email address will remain unverified.
        </div>
      </div>
      <div class="footer">
        &copy; ${new Date().getFullYear()} Bright &amp; White Laundry. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  private buildPasswordResetText(otp: string, expiresInMinutes: number): string {
    return [
      'Bright & White Laundry — Password Reset Verification',
      '',
      `Your verification code is: ${otp}`,
      '',
      `This code will expire in ${expiresInMinutes} minutes.`,
      '',
      'For your security, never share this code with anyone. Bright & White staff will never ask for your verification code.',
      '',
      'If you did not request a password reset, you can safely ignore this email. Your account remains secure.',
      '',
      '— Bright & White Laundry Platform',
    ].join('\n');
  }

  private buildPasswordResetHtml(otp: string, expiresInMinutes: number): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset Code</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1E293B;
      line-height: 1.6;
    }
    .wrapper {
      width: 100%;
      background-color: #F8FAFC;
      padding: 40px 16px;
      box-sizing: border-box;
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      background-color: #FFFFFF;
      border-radius: 16px;
      border: 1px solid #E2E8F0;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
    }
    .header {
      background: #FFFFFF;
      padding: 32px 24px 20px;
      text-align: center;
      border-bottom: 1px solid #F1F5F9;
    }
    .brand-logo {
      max-width: 160px;
      height: auto;
      display: inline-block;
      margin-bottom: 8px;
    }
    .content {
      padding: 36px 32px;
    }
    .title {
      font-size: 20px;
      font-weight: 700;
      color: #0F172A;
      margin-top: 0;
      margin-bottom: 12px;
      text-align: center;
    }
    .description {
      font-size: 15px;
      color: #475569;
      margin-bottom: 24px;
      text-align: center;
    }
    .otp-container {
      background-color: #EFF6FF;
      border: 2px dashed #93C5FD;
      border-radius: 12px;
      padding: 20px 16px;
      text-align: center;
      margin: 28px 0;
    }
    .otp-code {
      font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: 8px;
      color: #1D4ED8;
      margin: 0;
      padding-left: 8px;
    }
    .otp-expiry {
      font-size: 13px;
      color: #3B82F6;
      font-weight: 600;
      margin-top: 8px;
    }
    .security-notice {
      background-color: #FEF3C7;
      border-left: 4px solid #F59E0B;
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 13px;
      color: #92400E;
      margin: 24px 0;
    }
    .disclaimer {
      font-size: 13px;
      color: #64748B;
      margin-top: 24px;
      border-top: 1px solid #F1F5F9;
      padding-top: 20px;
    }
    .footer {
      background-color: #F8FAFC;
      border-top: 1px solid #E2E8F0;
      padding: 20px 24px;
      text-align: center;
      font-size: 12px;
      color: #94A3B8;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <img src="cid:bwlogo" alt="Bright &amp; White Laundry" class="brand-logo" />
      </div>
      <div class="content">
        <h2 class="title">Password Reset Verification</h2>
        <p class="description">
          We received a request to reset your password. Use the verification code below to complete the reset process:
        </p>
        <div class="otp-container">
          <div class="otp-code">${otp}</div>
          <div class="otp-expiry">&#9200; Valid for ${expiresInMinutes} minutes</div>
        </div>
        <div class="security-notice">
          <strong>Security Notice:</strong> Never share this code with anyone. Bright &amp; White personnel will never ask for your verification code.
        </div>
        <div class="disclaimer">
          If you did not request a password reset, you can safely ignore this email. Your password will not change and your account remains secure.
        </div>
      </div>
      <div class="footer">
        &copy; ${new Date().getFullYear()} Bright &amp; White Laundry. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return '***';
    const name = parts[0];
    const domain = parts[1];
    if (name.length <= 2) {
      return `${name[0]}***@${domain}`;
    }
    return `${name.substring(0, 2)}***${name[name.length - 1]}@${domain}`;
  }
}
