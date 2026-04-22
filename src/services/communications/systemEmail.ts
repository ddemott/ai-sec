import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (process.env.NODE_ENV === 'test' || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    transporter = { sendMail: async () => ({ messageId: 'test-message-id' }) } as unknown as Transporter;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  return transporter;
}

export async function sendPasswordResetEmail(to: string, resetLink: string, ttlMinutes: number): Promise<void> {
  const subject = 'Reset your SecretaryHQ password';
  const text = `Someone requested a password reset for your SecretaryHQ account.

If this was you, follow the link below to set a new password (expires in ${ttlMinutes} minutes):

${resetLink}

If you did not request this, you can safely ignore this email — your password will not change.`;

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">Reset your SecretaryHQ password</h2>
<p>Someone requested a password reset for your SecretaryHQ account.</p>
<p style="margin:24px 0"><a href="${resetLink}" style="background:#0066cc;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">Set a new password</a></p>
<p style="color:#666;font-size:14px">This link expires in ${ttlMinutes} minutes. If the button doesn't work, paste this URL into your browser:<br><span style="word-break:break-all">${resetLink}</span></p>
<p style="color:#666;font-size:14px">If you did not request this, you can safely ignore this email — your password will not change.</p>
</body></html>`;

  await getTransporter().sendMail({
    from: `"SecretaryHQ" <${process.env.EMAIL_USER ?? 'no-reply@secretaryhq.com'}>`,
    to,
    subject,
    text,
    html,
  });
}
