/**
 * WHO: the scheduled GitHub Action that pages without a vendor | WHAT: the
 * two ALERTS.md §3.9 thresholds on a single /metrics scrape | WHEN: a dead
 * TELNYX_PHONE_NUMBER pins failure ratio at 1.0 | WHERE:
 * scripts/zeroVendorAlerts.ts | WHY: Prometheus rate() needs two scrapes;
 * a GitHub Action gets one. The boot-lifetime ratio is the signal that
 * caught the deleted from-number on 2026-07-09. A test that only checks
 * happy-path zeros would green-light a parser that never sees labels.
 */
import { describe, it, expect } from 'vitest';
import { evaluateZeroVendorAlerts } from '../../scripts/zeroVendorAlerts';

const SAMPLE = `
# HELP sms_sends_total SMS send attempts
# TYPE sms_sends_total counter
sms_sends_total{provider="telnyx",outcome="sent"} 80
sms_sends_total{provider="telnyx",outcome="failed"} 20
sms_sends_total{provider="telnyx",outcome="rate_limited"} 50
sms_sends_total{provider="mock",outcome="failed"} 0
# TYPE errors_total counter
errors_total{event="voice_session_reaped"} 3
errors_total{event="system_sms_send_failed"} 0
`;

describe('evaluateZeroVendorAlerts', () => {
  it('HAPPY: 20% exact is not a breach (threshold is strictly greater)', () => {
    const result = evaluateZeroVendorAlerts(SAMPLE);
    expect(result.breaches).toEqual([]);
  });

  it('SAD: a dead from-number (all failed) trips SmsSendFailureRate', () => {
    const text = `
sms_sends_total{provider="telnyx",outcome="failed"} 12
sms_sends_total{provider="telnyx",outcome="sent"} 0
errors_total{event="system_sms_send_failed"} 0
`;
    const result = evaluateZeroVendorAlerts(text);
    expect(result.breaches.map((b) => b.name)).toEqual(['SmsSendFailureRate']);
    expect(result.breaches[0].summary).toMatch(/1\.00/);
  });

  it('SAD: any system_sms_send_failed increment is a page', () => {
    const text = `
sms_sends_total{provider="telnyx",outcome="sent"} 10
sms_sends_total{provider="telnyx",outcome="failed"} 0
errors_total{event="system_sms_send_failed"} 1
`;
    const result = evaluateZeroVendorAlerts(text);
    expect(result.breaches.map((b) => b.name)).toEqual(['SystemSmsSendFailed']);
  });

  it('PIN: rate_limited is excluded from the failure ratio', () => {
    const text = `
sms_sends_total{outcome="failed"} 1
sms_sends_total{outcome="sent"} 9
sms_sends_total{outcome="rate_limited"} 90
errors_total{event="system_sms_send_failed"} 0
`;
    const result = evaluateZeroVendorAlerts(text);
    expect(result.breaches).toEqual([]);
  });

  it('PIN: zero SMS volume is silence, not a divide-by-zero page', () => {
    const result = evaluateZeroVendorAlerts('errors_total{event="booking_failed"} 2\n');
    expect(result.breaches).toEqual([]);
  });
});
