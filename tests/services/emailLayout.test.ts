/**
 * Email shell tests.
 *
 * These pin the properties that make an email RENDER, not just parse. Every
 * assertion here corresponds to a way HTML email fails in a real client, and
 * each one is a regression the shell was written to prevent.
 */
import { describe, it, expect } from 'vitest';
import {
  EMAIL_LOGO_CID,
  emailLogoAttachment,
  escapeHtml,
  renderDetailRows,
  renderEmailShell,
} from '../../src/services/communications/emailLayout';

describe('renderEmailShell', () => {
  // WHO: any recipient | WHAT: a complete HTML document, not a fragment | WHEN: every
  // send | WHERE: shell output | WHY: the old system emails emitted a bare <body> string;
  // a fragment without a doctype is what pushes some clients to render the text/plain
  // part instead — the exact "it looks like text" symptom this replaced.
  it('HAPPY: emits a complete HTML document with a doctype', () => {
    const html = renderEmailShell({ heading: 'Hello', bodyHtml: '<p>Body</p>' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  // WHO: Outlook users | WHAT: table-based layout | WHEN: every send | WHERE: shell |
  // WHY: Outlook renders through Word, which does not support flex/grid. A div-based
  // layout collapses to a single unstyled column there.
  it('HAPPY: lays out with tables, not flex or grid', () => {
    const html = renderEmailShell({ heading: 'H', bodyHtml: '<p>B</p>' });
    expect(html).toContain('<table role="presentation"');
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('display:grid');
  });

  // WHO: Gmail web users | WHAT: styling survives | WHEN: every send | WHERE: shell |
  // WHY: Gmail's web client strips <style> blocks. Styling that lives only in a head
  // block silently disappears and the mail reads as plain text.
  it('HAPPY: styles inline rather than in a <style> block', () => {
    const html = renderEmailShell({ heading: 'H', bodyHtml: '<p>B</p>' });
    expect(html).not.toContain('<style');
    expect(html).toContain('style="');
  });

  // WHO: any recipient with images blocked (the default in most clients) | WHAT: the
  // logo still renders | WHEN: first open | WHERE: header img | WHY: a hosted URL shows
  // a broken-image box until "load images" is clicked; a cid: part renders immediately.
  it('HAPPY: references the logo by cid, never by remote URL', () => {
    const html = renderEmailShell({ heading: 'H', bodyHtml: '<p>B</p>' });
    expect(html).toContain(`src="cid:${EMAIL_LOGO_CID}"`);
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
  });

  // WHO: screen-reader users and anyone with images off | WHAT: alt text + fixed
  // dimensions | WHEN: image blocked or slow | WHERE: header img | WHY: without
  // width/height a blocked image collapses the header and shifts the layout.
  it('HAPPY: header image carries alt text and explicit dimensions', () => {
    const html = renderEmailShell({ heading: 'H', bodyHtml: '<p>B</p>' });
    expect(html).toMatch(/<img[^>]+alt="SecretaryHQ"/);
    expect(html).toMatch(/<img[^>]+width="280"/);
    expect(html).toMatch(/<img[^>]+height="56"/);
  });

  // WHO: anyone scanning an inbox | WHAT: the preview line | WHEN: before opening |
  // WHERE: hidden preheader div | WHY: with no preheader the client scrapes whatever
  // text comes first, which is usually the logo's alt text.
  it('HAPPY: emits a hidden preheader, falling back to the heading', () => {
    const withPre = renderEmailShell({
      heading: 'H',
      bodyHtml: '<p>B</p>',
      preheader: 'Preview line here',
    });
    expect(withPre).toContain('Preview line here');
    expect(withPre).toMatch(/display:none[^"]*/);

    const withoutPre = renderEmailShell({ heading: 'Fallback heading', bodyHtml: '<p>B</p>' });
    // Appears twice: once hidden as the preheader, once as the visible <h1>.
    expect(withoutPre.match(/Fallback heading/g)?.length).toBeGreaterThanOrEqual(2);
  });

  // WHO: the owner | WHAT: markup injection via call-collected values | WHEN: a caller
  // says something containing '<' | WHERE: heading/preheader | WHY: these fields come
  // straight off a phone call; unescaped they inject into the owner's inbox.
  it('SAD: escapes the heading and preheader', () => {
    const html = renderEmailShell({
      heading: '<script>alert(1)</script>',
      preheader: '"><b>x</b>',
      bodyHtml: '<p>B</p>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('"><b>x</b>');
  });

  // WHO: recipient clicking through | WHAT: the CTA url is escaped | WHEN: a link
  // contains a quote | WHERE: cta href | WHY: an unescaped quote breaks out of the
  // attribute and can inject arbitrary markup.
  it('SAD: escapes the CTA url and label', () => {
    const html = renderEmailShell({
      heading: 'H',
      bodyHtml: '<p>B</p>',
      cta: { label: 'Go" onmouseover="x', url: 'https://x.test/a"onclick="y' },
    });
    expect(html).not.toContain('onmouseover="x');
    expect(html).not.toContain('onclick="y');
    expect(html).toContain('&quot;');
  });

  // WHO: caller-supplied body content | WHAT: bodyHtml is intentionally raw | WHEN:
  // callers compose markup | WHERE: card body | WHY: documents the contract — callers
  // escape their own interpolated values (renderDetailRows does it for them).
  it('HAPPY: passes bodyHtml through unescaped by design', () => {
    const html = renderEmailShell({ heading: 'H', bodyHtml: '<p id="keep">Body</p>' });
    expect(html).toContain('<p id="keep">Body</p>');
  });
});

describe('renderDetailRows', () => {
  // WHO: the owner reading a lead | WHAT: values escaped | WHEN: a company name has a
  // '<' | WHERE: detail table | WHY: job-inquiry fields are transcribed from speech and
  // land here verbatim.
  it('SAD: escapes both labels and values', () => {
    const html = renderDetailRows([['Caller <b>', 'Acme & Sons <script>']]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;b&gt;');
  });

  // WHO: the reader | WHAT: no doubled rule above the footer | WHEN: a table is followed
  // by footerHtml | WHERE: last row | WHY: the footer draws its own border-top; both
  // together render as a visible double line.
  it('HAPPY: drops the bottom rule on the final row', () => {
    const html = renderDetailRows([
      ['A', '1'],
      ['B', '2'],
    ]);
    // One row keeps its rule, the last does not.
    expect(html.match(/border-bottom:1px solid/g)).toHaveLength(2);
  });

  it('HAPPY: renders one row per pair', () => {
    const html = renderDetailRows([
      ['A', '1'],
      ['B', '2'],
      ['C', '3'],
    ]);
    expect(html.match(/<tr>/g)).toHaveLength(3);
  });
});

describe('emailLogoAttachment', () => {
  // WHO: every recipient | WHAT: real PNG bytes | WHEN: every send | WHERE: attachment |
  // WHY: the cid reference is inert without the part. Checking the PNG magic number
  // proves we attached an actual image, not an empty or corrupt buffer.
  it('HAPPY: returns decodable PNG bytes under the shell cid', () => {
    const a = emailLogoAttachment();
    expect(a.cid).toBe(EMAIL_LOGO_CID);
    expect(a.contentType).toBe('image/png');
    expect(a.contentDisposition).toBe('inline');
    expect(a.content.length).toBeGreaterThan(1000);
    // PNG signature: 89 50 4E 47.
    expect(a.content.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  // WHO: the recipient's attachment list | WHAT: the logo stays out of it | WHEN: every
  // send | WHERE: contentDisposition | WHY: a logo listed as an attachment looks like a
  // file the sender meant to include.
  it('HAPPY: marks the logo inline so it is not listed as a file', () => {
    expect(emailLogoAttachment().contentDisposition).toBe('inline');
  });
});

describe('escapeHtml', () => {
  it('HAPPY: escapes all five significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  // WHO: any value already containing an entity | WHAT: ampersand escaped first | WHEN:
  // input contains '&amp;' | WHERE: escape order | WHY: escaping '&' after the others
  // would double-escape and render literal "&amp;lt;" to the reader.
  it('SAD: escapes the ampersand first so entities are not double-escaped', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });
});
