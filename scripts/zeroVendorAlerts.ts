/**
 * Zero-vendor SMS alerts — ALERTS.md §3.9, no Prometheus, no vendor.
 *
 * A GitHub Action curls GET /metrics once. Prometheus `rate()` needs two
 * scrapes; this evaluates the boot-lifetime ratio instead, which is the
 * signal that caught the deleted TELNYX_PHONE_NUMBER (ratio pinned at 1.0).
 *
 *   SmsSendFailureRate: failed / (sent + failed) > 0.2
 *     rate_limited is excluded from both sides (retried, not an incident).
 *   SystemSmsSendFailed: errors_total{event="system_sms_send_failed"} > 0
 */
import { pathToFileURL } from 'node:url';

export type AlertBreach = { name: string; summary: string };

export type AlertResult = { breaches: AlertBreach[] };

type Sample = { name: string; labels: Record<string, string>; value: number };

function parseLabels(raw: string | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!raw) return labels;
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

export function parsePrometheusText(text: string): Sample[] {
  const samples: Sample[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([0-9.eE+-]+)/.exec(trimmed);
    if (!match) continue;
    samples.push({
      name: match[1],
      labels: parseLabels(match[2]),
      value: Number(match[3]),
    });
  }
  return samples;
}

function sum(
  samples: Sample[],
  name: string,
  labelFilter: (labels: Record<string, string>) => boolean
): number {
  return samples
    .filter((s) => s.name === name && labelFilter(s.labels))
    .reduce((acc, s) => acc + s.value, 0);
}

export function evaluateZeroVendorAlerts(text: string): AlertResult {
  const samples = parsePrometheusText(text);
  const breaches: AlertBreach[] = [];

  const failed = sum(samples, 'sms_sends_total', (l) => l.outcome === 'failed');
  const sent = sum(samples, 'sms_sends_total', (l) => l.outcome === 'sent');
  const denom = sent + failed;
  if (denom > 0) {
    const ratio = failed / denom;
    if (ratio > 0.2) {
      breaches.push({
        name: 'SmsSendFailureRate',
        summary: `>20% of SMS sends failing since boot (${ratio.toFixed(2)}; failed=${failed} sent=${sent}) — check TELNYX_PHONE_NUMBER is still owned`,
      });
    }
  }

  const systemFailed = sum(samples, 'errors_total', (l) => l.event === 'system_sms_send_failed');
  if (systemFailed > 0) {
    breaches.push({
      name: 'SystemSmsSendFailed',
      summary: `An opt-out confirmation SMS failed (errors_total{event="system_sms_send_failed"}=${systemFailed}) — TCPA exposure, no DB record exists`,
    });
  }

  return { breaches };
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? process.env.METRICS_URL;
  const token = process.env.METRICS_TOKEN;
  if (!url) {
    console.error('usage: npx tsx scripts/zeroVendorAlerts.ts <metrics-url>');
    process.exit(2);
  }
  if (!token) {
    console.log('SKIP: METRICS_TOKEN unset — not paging.');
    process.exit(0);
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error(`GET ${url} → ${res.status}`);
    process.exit(1);
  }
  const text = await res.text();
  const { breaches } = evaluateZeroVendorAlerts(text);
  if (breaches.length === 0) {
    console.log('OK — no §3.9 SMS breaches.');
    process.exit(0);
  }
  for (const b of breaches) {
    console.log(`BREACH ${b.name}: ${b.summary}`);
  }
  process.exit(10);
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
