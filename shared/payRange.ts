/**
 * Display helper for captured pay/salary text.
 *
 * The voice path stores the caller's words verbatim (their-words capture is
 * by design). Owners still need a compact $ form on the inbox and in email.
 * Unparseable copy is left alone — never invent a number.
 */

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const TEENS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/\$/g, ' ')
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t && t !== 'and' && t !== 'to' && t !== 'a' && t !== 'an' && t !== 'hr');
}

function parseSpokenChunk(tokens: string[]): number | null {
  if (tokens.length === 0) return null;

  const numeric = tokens.filter((t) => /^\d+(\.\d+)?k?$/.test(t));
  // Two+ digit tokens in one chunk (e.g. "between 65 and 82") would sum
  // and invent a number. Unparseable — leave verbatim.
  if (numeric.length > 1) return null;
  if (numeric.length === 1 && numeric.length === tokens.length) {
    const t = numeric[0];
    return t.endsWith('k') ? Number(t.slice(0, -1)) * 1000 : Number(t);
  }

  let total = 0;
  let current = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (t === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
      continue;
    }
    if (t === 'hundred') {
      current = (current || 1) * 100;
      continue;
    }
    // "one forty" = 140 (ones then a tens word, no "hundred")
    if (t in ONES && next && next in TENS) {
      current += ONES[t] * 100 + TENS[next];
      i += 1;
      continue;
    }
    if (t in TEENS) {
      current += TEENS[t];
      continue;
    }
    if (t in TENS) {
      current += TENS[t];
      continue;
    }
    if (t in ONES) {
      current += ONES[t];
      continue;
    }
    if (/^\d+(\.\d+)?k?$/.test(t)) {
      current += t.endsWith('k') ? Number(t.slice(0, -1)) * 1000 : Number(t);
    }
  }
  total += current;
  return total > 0 ? total : null;
}

function splitRange(raw: string): [string, string] | null {
  const m = raw.split(/\bto\b|[–—-]|(?:\s+-\s+)/i);
  if (m.length === 2 && m[0].trim() && m[1].trim()) return [m[0].trim(), m[1].trim()];
  return null;
}

export function normalizePayRange(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const hourly = /\bhour\b|\bhr\b|\/hr/i.test(text);
  const parts = splitRange(text) ?? ([text, text] as [string, string]);
  const a = parseSpokenChunk(tokenize(parts[0]));
  const b = parseSpokenChunk(tokenize(parts[1]));
  if (a == null || b == null) return null;

  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  // "one forty" (140) next to "160 thousand" (160000) means 140k.
  if (!hourly && hi >= 1000 && lo > 0 && lo < 1000) lo *= 1000;
  if (lo === 0 || hi === 0) return null;

  const asThousands = !hourly && lo >= 1000 && hi >= 1000;
  if (lo === hi && !splitRange(text)) {
    return hourly
      ? `$${Math.round(lo)}/hr`
      : asThousands || lo >= 1000
        ? `$${Math.round(lo / 1000)}k`
        : `$${Math.round(lo)}`;
  }
  if (hourly) {
    return `$${Math.round(lo)}–${Math.round(hi)}/hr`;
  }
  if (asThousands) {
    return `$${Math.round(lo / 1000)}–${Math.round(hi / 1000)}k`;
  }
  return `$${Math.round(lo)}–${Math.round(hi)}`;
}

export function formatPayRangeDisplay(raw: string): string {
  const normalized = normalizePayRange(raw);
  if (!normalized || normalized === raw.replace(/-/g, '–')) return raw;
  if (raw === normalized) return raw;
  // Already-numeric copy ($180k-200k) is only a hyphen/k cosmetic away from
  // the compact form. Wrapping would be noise; wrap spoken words only.
  const looksSpoken = /[a-z]/i.test(raw.replace(/k\b|hr\b|hour\b/gi, ''));
  if (!looksSpoken) return normalized;
  return `${normalized} (${raw})`;
}
