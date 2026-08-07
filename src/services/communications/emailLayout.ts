/**
 * The one branded HTML shell every SecretaryHQ email renders through.
 *
 * WHY: before this, emails came in two shapes. `emailTemplates.ts` produced a
 * styled customer-facing template; `systemEmail.ts` (job inquiry, password
 * reset, invite, port request) hand-rolled a bare `<body style="font-family:
 * system-ui">` with a heading and a table. The second kind is technically HTML
 * but reads as plain text in a client — no header, no colour, no logo — which
 * is exactly what it was mistaken for. And NO email had an image at all: the
 * single `<img>` in the codebase was gated on `logoUrl`, which `emailService`
 * hardcoded to `undefined // Not currently stored`.
 *
 * Email HTML is not web HTML. The rules encoded here, and why:
 *   - TABLE layout, not flex/grid. Outlook renders through Word's engine.
 *   - INLINE styles. `<style>` blocks are stripped by Gmail's web client and
 *     others; only inline survives everywhere.
 *   - The logo is a CID ATTACHMENT, not a hosted URL. Most clients block remote
 *     images by default, so a hosted logo shows as a broken-image box on first
 *     open — worse than no logo. A CID part renders without the "load images"
 *     click. See `emailLogoAttachment()`.
 *   - Every image carries width/height/alt. A blocked or slow image must not
 *     collapse the layout, and alt text is what a screen reader announces.
 *   - A PREHEADER is emitted: the hidden first line an inbox shows next to the
 *     subject. Without one, clients scrape whatever text comes first — usually
 *     "View this email" or the logo's alt text.
 */

import { EMAIL_LOGO_PNG_BASE64 } from './emailLogo';

/** Content-ID the shell's `<img src="cid:…">` refers to. */
export const EMAIL_LOGO_CID = 'secretaryhq-logo';

const NAVY_DEEP = '#111C33';
const NAVY = '#1B2B4B';
const ACCENT = '#5E8DD6';
const INK = '#1A2233';
const MUTED = '#5B6577';
const HAIRLINE = '#E3E7EF';
const CANVAS = '#F4F6FA';

/**
 * The logo as a nodemailer attachment. Must be included on every send that uses
 * `renderEmailShell`, or the header image resolves to nothing.
 *
 * `cid` makes it an inline part rather than a download; `contentDisposition`
 * keeps it out of the recipient's "attachments" list, where a logo looks like
 * a file the sender meant to send.
 */
export function emailLogoAttachment(): {
  filename: string;
  content: Buffer;
  cid: string;
  contentType: string;
  contentDisposition: 'inline';
} {
  return {
    filename: 'secretaryhq.png',
    content: Buffer.from(EMAIL_LOGO_PNG_BASE64, 'base64'),
    cid: EMAIL_LOGO_CID,
    contentType: 'image/png',
    contentDisposition: 'inline',
  };
}

/** Escape a value for safe interpolation into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailShellOptions {
  /** Headline inside the card. Plain text — escaped for you. */
  heading: string;
  /** Card body. Raw HTML: callers escape their own interpolated values. */
  bodyHtml: string;
  /**
   * Hidden inbox preview line. Falls back to the heading. Keep under ~90 chars
   * — that is roughly what a phone shows.
   */
  preheader?: string;
  /** Optional call-to-action button under the body. */
  cta?: { label: string; url: string };
  /** Small print under the card. Raw HTML. */
  footerHtml?: string;
}

/** Wrap body content in the branded shell. Returns a complete HTML document. */
export function renderEmailShell(opts: EmailShellOptions): string {
  const preheader = escapeHtml(opts.preheader ?? opts.heading);

  const cta = opts.cta
    ? `
              <tr>
                <td style="padding:8px 0 4px">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td style="background:${NAVY};border-radius:6px">
                      <a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;padding:12px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none">${escapeHtml(opts.cta.label)}</a>
                    </td>
                  </tr></table>
                </td>
              </tr>`
    : '';

  const footer = opts.footerHtml
    ? `
              <tr>
                <td style="padding:18px 0 0;border-top:1px solid ${HAIRLINE};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${MUTED}">${opts.footerHtml}</td>
              </tr>`
    : '';

  // The preheader span is followed by wide whitespace so the client does not
  // pull the NEXT line of copy into the preview alongside it.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-font-smoothing:antialiased">
<div style="display:none;font-size:1px;color:${CANVAS};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS}">
  <tr>
    <td align="center" style="padding:32px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">
        <tr>
          <td style="padding:0 0 20px">
            <img src="cid:${EMAIL_LOGO_CID}" width="280" height="56" alt="SecretaryHQ" style="display:block;width:280px;height:56px;border:0;outline:none;text-decoration:none">
          </td>
        </tr>
        <tr>
          <td style="background:#FFFFFF;border:1px solid ${HAIRLINE};border-radius:10px;padding:0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="height:4px;background:${NAVY};border-radius:10px 10px 0 0;font-size:0;line-height:0">&nbsp;</td>
              </tr>
              <tr>
                <td style="padding:28px 32px 8px">
                  <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.3;font-weight:bold;color:${NAVY_DEEP}">${escapeHtml(opts.heading)}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:0 32px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK}">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${INK}">${opts.bodyHtml}</td></tr>
${cta}
${footer}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${MUTED}">
            Sent by <span style="color:${NAVY_DEEP};font-weight:bold">Secretary</span><span style="color:${ACCENT};font-weight:bold">HQ</span> — your AI receptionist.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * Render a label/value table for the card body.
 *
 * Values are escaped here — these carry caller-supplied strings straight off a
 * phone call (company names, addresses), so an unescaped `<` would inject
 * markup into the owner's inbox.
 */
export function renderDetailRows(rows: Array<[string, string]>): string {
  const cells = rows
    .map(([k, v], i) => {
      // The final row drops its rule: the footer draws its own border-top, and
      // the two stack into a visible double line.
      const rule = i === rows.length - 1 ? '' : `border-bottom:1px solid ${HAIRLINE};`;
      return (
        `<tr>` +
        `<td style="padding:7px 16px 7px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED};white-space:nowrap;vertical-align:top;${rule}">${escapeHtml(k)}</td>` +
        `<td style="padding:7px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};font-weight:bold;vertical-align:top;${rule}">${escapeHtml(v)}</td>` +
        `</tr>`
      );
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;border-collapse:collapse">${cells}</table>`;
}
