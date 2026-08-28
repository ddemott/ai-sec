/**
 * Unit tests for the website-scan SSRF guard.
 *
 * 5W:
 *   WHO  — an authenticated owner posting POST /knowledge/import-website
 *   WHAT — fetchAndExtractSiteText must refuse non-http(s) schemes and
 *          loopback / private / link-local targets before calling fetch
 *   WHEN — onboarding website scan (owner-typed URL + same-origin crawl)
 *   WHERE— src/services/knowledge/siteScrape.ts
 *   WHY  — Zod only checks "looks like a URL". file:, localhost, 127.0.0.1,
 *          and 169.254.169.254 were legal inputs, so an owner could scan
 *          the host's own metadata endpoint through our backend.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertSafeSiteFetchUrl,
  fetchAndExtractSiteText,
  type AddressLookup,
} from '../../../src/services/knowledge/siteScrape';

const publicLookup: AddressLookup = async () => ['93.184.216.34'];
const loopbackLookup: AddressLookup = async () => ['127.0.0.1'];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assertSafeSiteFetchUrl — scheme', () => {
  it('HAPPY: https is allowed', async () => {
    const result = await assertSafeSiteFetchUrl('https://example.com/about', publicLookup);
    expect(result.ok).toBe(true);
  });

  it('HAPPY: http is allowed', async () => {
    const result = await assertSafeSiteFetchUrl('http://example.com', publicLookup);
    expect(result.ok).toBe(true);
  });

  it('SAD: file: is refused before any fetch', async () => {
    const result = await assertSafeSiteFetchUrl('file:///etc/passwd', publicLookup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/http or https/i);
  });

  it('SAD: ftp: is refused', async () => {
    const result = await assertSafeSiteFetchUrl('ftp://example.com', publicLookup);
    expect(result.ok).toBe(false);
  });
});

describe('assertSafeSiteFetchUrl — loopback / private / link-local literals', () => {
  const blocked = [
    'http://127.0.0.1',
    'http://127.0.0.1:8080/',
    'http://localhost',
    'http://localhost:3000/knowledge',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1',
    'http://192.168.1.1',
    'http://172.16.0.1',
    'http://0.0.0.0',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[0:0:0:0:0:ffff:a9fe:a9fe]/', // uncompressed IPv4-mapped; WHATWG compresses to ::ffff:a9fe:a9fe
    'http://2130706433', // Node canonicalizes to 127.0.0.1
  ];

  it('SAD: private and link-local literals are refused', async () => {
    for (const raw of blocked) {
      const result = await assertSafeSiteFetchUrl(raw, publicLookup);
      expect(result.ok, raw).toBe(false);
      if (!result.ok) expect(result.error, raw).toMatch(/not allowed/i);
    }
  });
});

describe('assertSafeSiteFetchUrl — resolved address', () => {
  it('SAD: a public-looking hostname that resolves to loopback is refused', async () => {
    const result = await assertSafeSiteFetchUrl('https://evil.example', loopbackLookup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not allowed/i);
  });

  it('SAD: a hostname that resolves to uncompressed IPv4-mapped link-local is refused', async () => {
    // WHAT: DNS can return 0:0:0:0:0:ffff:a9fe:a9fe (169.254.169.254) without :: compression
    // WHY: ipv4Mapped() only matched the compressed ::ffff: form; BlockList must still catch it
    const mappedLookup: AddressLookup = async () => ['0:0:0:0:0:ffff:a9fe:a9fe'];
    const result = await assertSafeSiteFetchUrl('https://evil.example', mappedLookup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not allowed/i);
  });

  it('HAPPY: a public hostname that resolves publicly is allowed', async () => {
    const result = await assertSafeSiteFetchUrl('https://example.com', publicLookup);
    expect(result.ok).toBe(true);
  });
});

describe('fetchAndExtractSiteText — does not fetch blocked targets', () => {
  it('SAD: never calls fetch for 169.254.169.254', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAndExtractSiteText(
      'http://169.254.169.254/latest/meta-data/',
      publicLookup
    );

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('SAD: does not follow a redirect onto link-local metadata', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = url.toString();
        fetched.push(href);
        if (href.startsWith('https://example.com')) {
          return {
            ok: false,
            status: 302,
            headers: {
              get: (name: string) =>
                name.toLowerCase() === 'location'
                  ? 'http://169.254.169.254/latest/meta-data/'
                  : null,
            },
            text: async () => '',
          } as unknown as Response;
        }
        return {
          ok: true,
          text: async () => `<html><body>${'ssrf-payload '.repeat(40)}</body></html>`,
        } as unknown as Response;
      })
    );

    const result = await fetchAndExtractSiteText('https://example.com/about', publicLookup);

    expect(fetched.some((u) => u.includes('169.254'))).toBe(false);
    expect(result.success).toBe(false);
  });
});
