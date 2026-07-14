import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (process.env.NODE_ENV === 'test' || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    transporter = {
      sendMail: () => Promise.resolve({ messageId: 'test-message-id' }),
    } as unknown as Transporter;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  return transporter;
}

/**
 * Invite a new user to a tenant. The invite reuses the password-reset
 * token flow under the hood (the user "sets" their password rather than
 * "resets" it), but the framing is different: the recipient hasn't been
 * here before, so the copy welcomes them and tells them which business
 * invited them and what role they'll have when they sign in.
 */
export async function sendUserInviteEmail(
  to: string,
  resetLink: string,
  ttlMinutes: number,
  businessName: string,
  role: 'owner' | 'front_desk'
): Promise<void> {
  const roleLabel = role === 'front_desk' ? 'Front Desk' : 'Owner';
  const subject = `You're invited to ${businessName} on SecretaryHQ`;
  const text = `${businessName} invited you to join their SecretaryHQ workspace as ${roleLabel}.

Set your password to sign in (link expires in ${ttlMinutes} minutes):

${resetLink}

If you weren't expecting this invitation, you can safely ignore this email — no account will be created against your name.`;

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">You're invited to ${businessName}</h2>
<p>${businessName} added you to their SecretaryHQ workspace as <strong>${roleLabel}</strong>. Set a password to sign in.</p>
<p style="margin:24px 0"><a href="${resetLink}" style="background:#0066cc;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">Set my password</a></p>
<p style="color:#666;font-size:14px">This link expires in ${ttlMinutes} minutes. If the button doesn't work, paste this URL into your browser:<br><span style="word-break:break-all">${resetLink}</span></p>
<p style="color:#666;font-size:14px">If you weren't expecting this, you can safely ignore the email — no account will be created against your name.</p>
</body></html>`;

  await getTransporter().sendMail({
    from: `"SecretaryHQ" <${process.env.EMAIL_USER ?? 'no-reply@secretaryhq.com'}>`,
    to,
    subject,
    text,
    html,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  resetLink: string,
  ttlMinutes: number
): Promise<void> {
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

/** Structured fields captured during a voice job-inquiry intake. */
export interface JobInquiryFields {
  /** Where the work would actually happen — the end client. */
  clientCompany?: string | null;
  /** The agency that rang. Who you will actually be negotiating with. */
  callerCompany?: string | null;
  representsCompany?: boolean | null;
  employmentType?: string | null;
  rateRange?: string | null;
  duration?: string | null;
  locationType?: string | null;
  address?: string | null;
  timezone?: string | null;
  callerName?: string | null;
  callbackPhone?: string | null;
}

/**
 * Notify the business owner that a recruiter called asking about availability
 * for work. This is an OWNER notification (same class as password-reset /
 * invite), NOT a customer marketing message — it deliberately uses this
 * consent-free path rather than EmailService.sendEmail (which consent-gates).
 *
 * The caller is separately asked to email a full job description; this email is
 * the structured summary of what the agent collected on the call so the owner
 * has the gist before the JD arrives.
 */
export async function sendJobInquiryEmail(to: string, fields: JobInquiryFields): Promise<void> {
  const yesNo = (v: boolean | null | undefined): string =>
    v === true ? 'Yes' : v === false ? 'No' : 'Not stated';
  const orDash = (v: string | null | undefined): string => (v && v.trim() ? v : '—');

  const employment =
    fields.employmentType === 'full_time' ? 'Full time' : orDash(fields.employmentType);
  const rateLabel = fields.employmentType === 'full_time' ? 'Salary range' : 'Rate range';

  // Build the field list, omitting position fields irrelevant to the branch
  // (duration only for contract; address for onsite/hybrid; timezone for remote).
  const rows: Array<[string, string]> = [
    ['Caller', orDash(fields.callerName)],
    ['Callback', orDash(fields.callbackPhone)],
    // BOTH companies, labelled so they cannot be confused at a glance. A lead that
    // says only "Blue Cross" leaves the owner ringing back an agency he cannot name.
    ['Client (where the work is)', orDash(fields.clientCompany)],
    ['Caller works for', orDash(fields.callerCompany)],
    ['In-house at the client', yesNo(fields.representsCompany)],
    ['Employment type', employment],
    [rateLabel, orDash(fields.rateRange)],
  ];
  if (fields.employmentType !== 'full_time' && fields.duration) {
    rows.push(['Contract length', orDash(fields.duration)]);
  }
  rows.push(['Location', orDash(fields.locationType)]);
  if (fields.address) rows.push(['Address', fields.address]);
  if (fields.timezone) rows.push(['Timezone', fields.timezone]);

  // The subject line is what he sees on his phone, so it leads with the CLIENT (is
  // this work I want?) and names the agency second (who is asking?).
  const subject =
    `New job inquiry` +
    (fields.clientCompany ? ` — ${fields.clientCompany}` : '') +
    (fields.callerCompany && fields.callerCompany !== fields.clientCompany
      ? ` (via ${fields.callerCompany})`
      : '');
  const text =
    `A caller asked whether you're available for work. Details collected on the call:\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nThe caller was asked to email a full job description to your inbox with their name and company in the subject line.`;

  // Escape caller-provided values before embedding in HTML — fields like
  // company/caller name/address come straight from the call, so an unescaped
  // '<' or '"' could inject markup into the owner's notification email.
  const esc = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const htmlRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`
    )
    .join('');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">New job inquiry</h2>
<p>A caller asked whether you're available for work. Details collected on the call:</p>
<table style="border-collapse:collapse;margin:16px 0">${htmlRows}</table>
<p style="color:#666;font-size:14px">The caller was asked to email a full job description with their name and company in the subject line.</p>
</body></html>`;

  await getTransporter().sendMail({
    from: `"SecretaryHQ" <${process.env.EMAIL_USER ?? 'no-reply@secretaryhq.com'}>`,
    to,
    subject,
    text,
    html,
  });
}

/** Fields captured when an owner asks to port their existing number into Telnyx. */
export interface PortRequestFields {
  tenantId: string;
  tenantName: string;
  phoneNumber: string;
  notes?: string | null;
}

/**
 * Notify the platform admin (Dale) that an owner wants to port their real
 * number into Telnyx, replacing forwarding entirely. This is a PLATFORM
 * notification (same class as password-reset/invite), not a tenant-facing
 * email — no porting API is invoked here or anywhere; a real LNP port always
 * needs a human (LOA + carrier cutover), so this is just the structured
 * heads-up that starts that manual process. Deliberately no credentials or
 * carrier-account details are collected or emailed — see design doc
 * (docs/superpowers/specs/2026-07-05-wizard-phase-b-design.md §3) for why
 * that was cut from the original proposal.
 */
export async function sendPortRequestEmail(to: string, fields: PortRequestFields): Promise<void> {
  const orDash = (v: string | null | undefined): string => (v && v.trim() ? v : '—');

  const subject = `Port request — ${fields.tenantName}`;
  const text =
    `${fields.tenantName} (tenant ${fields.tenantId}) wants to port their existing number ` +
    `${fields.phoneNumber} into Telnyx instead of forwarding.\n\n` +
    `Notes: ${orDash(fields.notes)}\n\n` +
    `This requires a manual port in the Telnyx portal — no automated action was taken.`;

  const escPort = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const portHtml = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">Port request — ${escPort(fields.tenantName)}</h2>
<p><strong>${escPort(fields.tenantName)}</strong> (tenant <code>${escPort(fields.tenantId)}</code>) wants to port their existing number into Telnyx instead of forwarding.</p>
<table style="border-collapse:collapse;margin:16px 0">
<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap">Number to port</td><td style="padding:4px 0"><strong>${escPort(fields.phoneNumber)}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap">Notes</td><td style="padding:4px 0">${escPort(orDash(fields.notes))}</td></tr>
</table>
<p style="color:#666;font-size:14px">This requires a manual port in the Telnyx portal — no automated action was taken.</p>
</body></html>`;

  await getTransporter().sendMail({
    from: `"SecretaryHQ" <${process.env.EMAIL_USER ?? 'no-reply@secretaryhq.com'}>`,
    to,
    subject,
    text,
    html: portHtml,
  });
}
