/**
 * UsageTrackingService Tests
 * Tests SMS, call, and email usage tracking with happy + sad paths.
 * Each section has 5W diagnostic context.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { UsageTrackingService, usageTracker } from './UsageTrackingService.js'
import { Provider } from '../../types/usage.js'

describe('UsageTrackingService', () => {
  let service: UsageTrackingService

  beforeEach(() => {
    service = new UsageTrackingService()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Happy Paths', () => {
    describe('trackSMS', () => {
      test('tracks outbound SMS with Twilio provider', async () => {
        await service.trackSMS('tenant-1', 'outbound', 'SM123456', Provider.TWILIO)

        const records = await service.getUsageByTenant('tenant-1')
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
          tenantId: 'tenant-1',
          provider: Provider.TWILIO,
          type: 'sms',
          direction: 'outbound',
          externalId: 'SM123456',
        })
        expect(records[0].timestamp).toBeDefined()
        // WHO: tenants sending SMS | WHAT: outbound SMS tracking
        // WHEN: message sent | WHERE: UsageTrackingService
        // WHY: track usage for billing and analytics
      })

      test('tracks inbound SMS with default provider', async () => {
        await service.trackSMS('tenant-2', 'inbound', 'SM789012')

        const records = await service.getUsageByTenant('tenant-2')
        expect(records[0]).toMatchObject({
          direction: 'inbound',
          provider: Provider.TWILIO, // Default
        })
        // WHO: customers texting in | WHAT: inbound SMS tracking
        // WHEN: message received | WHERE: SMS service
        // WHY: track all communication for records
      })

      test('logs SMS tracking event', async () => {
        await service.trackSMS('tenant-1', 'outbound', 'SM123')

        expect(console.log).toHaveBeenCalledWith(
          '[UsageTracking] SMS tracked: outbound via twilio (SM123)'
        )
        // WHO: operators | WHAT: console logging
        // WHEN: SMS tracked | WHERE: service logs
        // WHY: observability for debugging
      })
    })

    describe('trackCall', () => {
      test('tracks outbound call with duration', async () => {
        await service.trackCall('tenant-1', 'outbound', 'CA123456', Provider.TWILIO, 120)

        const records = await service.getUsageByTenant('tenant-1')
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
          tenantId: 'tenant-1',
          provider: Provider.TWILIO,
          type: 'call',
          direction: 'outbound',
          externalId: 'CA123456',
          metadata: { durationSeconds: 120 },
        })
        // WHO: tenants making calls | WHAT: outbound call tracking
        // WHEN: call completed | WHERE: voice service
        // WHY: track call minutes for billing
      })

      test('tracks inbound call without duration', async () => {
        await service.trackCall('tenant-1', 'inbound', 'CA789012', Provider.TWILIO)

        const records = await service.getUsageByTenant('tenant-1')
        expect(records[0]).toMatchObject({
          type: 'call',
          direction: 'inbound',
          metadata: undefined,
        })
        // WHO: customers calling in | WHAT: inbound call tracking
        // WHEN: call received | WHERE: voice service
        // WHY: track all calls even without duration
      })

      test('logs call tracking event', async () => {
        await service.trackCall('tenant-1', 'inbound', 'CA123', Provider.TWILIO)

        expect(console.log).toHaveBeenCalledWith(
          '[UsageTracking] Call tracked: inbound via twilio (CA123)'
        )
      })
    })

    describe('trackEmail', () => {
      test('tracks outbound email', async () => {
        await service.trackEmail('tenant-1', 'outbound', 'MSG123456')

        const records = await service.getUsageByTenant('tenant-1')
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
          tenantId: 'tenant-1',
          provider: Provider.MOCK, // Email uses MOCK provider
          type: 'email',
          direction: 'outbound',
          externalId: 'MSG123456',
        })
        // WHO: tenants sending emails | WHAT: email tracking
        // WHEN: email sent | WHERE: email service
        // WHY: track email usage for analytics
      })

      test('tracks inbound email', async () => {
        await service.trackEmail('tenant-1', 'inbound', 'MSG789012')

        const records = await service.getUsageByTenant('tenant-1')
        expect(records[0]).toMatchObject({
          type: 'email',
          direction: 'inbound',
        })
        // WHO: customers emailing | WHAT: inbound email tracking
        // WHEN: email received | WHERE: email service
        // WHY: track all communication channels
      })

      test('logs email tracking event', async () => {
        await service.trackEmail('tenant-1', 'outbound', 'MSG123')

        expect(console.log).toHaveBeenCalledWith(
          '[UsageTracking] Email tracked: outbound (MSG123)'
        )
      })
    })

    describe('getUsageByTenant', () => {
      test('returns only records for specified tenant', async () => {
        await service.trackSMS('tenant-1', 'outbound', 'SM1')
        await service.trackSMS('tenant-2', 'outbound', 'SM2')
        await service.trackCall('tenant-1', 'inbound', 'CA1')

        const tenant1Records = await service.getUsageByTenant('tenant-1')
        expect(tenant1Records).toHaveLength(2)
        expect(tenant1Records.every(r => r.tenantId === 'tenant-1')).toBe(true)
        // WHO: billing system | WHAT: tenant-specific usage
        // WHEN: generating invoice | WHERE: usage queries
        // WHY: billing is per-tenant
      })

      test('returns empty array for tenant with no records', async () => {
        const records = await service.getUsageByTenant('nonexistent')
        expect(records).toEqual([])
        // WHO: new tenants | WHAT: empty usage
        // WHEN: querying before any activity | WHERE: usage queries
        // WHY: handle edge case gracefully
      })
    })

    describe('getUsageSummary', () => {
      test('returns counts by type', async () => {
        await service.trackSMS('tenant-1', 'outbound', 'SM1')
        await service.trackSMS('tenant-1', 'inbound', 'SM2')
        await service.trackCall('tenant-1', 'inbound', 'CA1')
        await service.trackEmail('tenant-1', 'outbound', 'EM1')
        await service.trackEmail('tenant-1', 'outbound', 'EM2')
        await service.trackEmail('tenant-1', 'outbound', 'EM3')

        const summary = await service.getUsageSummary('tenant-1')
        expect(summary).toEqual({
          sms: 2,
          calls: 1,
          emails: 3,
        })
        // WHO: dashboard users | WHAT: usage summary
        // WHEN: viewing analytics | WHERE: summary endpoint
        // WHY: quick overview of communication volume
      })

      test('returns zeros for tenant with no records', async () => {
        const summary = await service.getUsageSummary('empty-tenant')
        expect(summary).toEqual({
          sms: 0,
          calls: 0,
          emails: 0,
        })
        // WHO: new tenants | WHAT: empty summary
        // WHEN: no activity yet | WHERE: summary endpoint
        // WHY: clean initial state
      })
    })
  })

  describe('Sad Paths', () => {
    test('handles numeric tenant ID', async () => {
      await service.trackSMS(123 as unknown as string, 'outbound', 'SM1')

      const records = await service.getUsageByTenant(123 as unknown as string)
      expect(records).toHaveLength(1)
      expect(records[0].tenantId).toBe(123)
      // WHO: legacy systems | WHAT: numeric tenant ID support
      // WHEN: mixed ID types | WHERE: tenant identification
      // WHY: backward compatibility with numeric IDs
    })

    test('handles empty externalId', async () => {
      await service.trackSMS('tenant-1', 'outbound', '')

      const records = await service.getUsageByTenant('tenant-1')
      expect(records[0].externalId).toBe('')
      // WHO: failed sends | WHAT: empty external ID
      // WHEN: provider doesn't return ID | WHERE: tracking
      // WHY: still track even if external ID missing
    })

    test('handles undefined duration in call tracking', async () => {
      await service.trackCall('tenant-1', 'outbound', 'CA1', Provider.TWILIO, undefined)

      const records = await service.getUsageByTenant('tenant-1')
      expect(records[0].metadata).toBeUndefined()
      // WHO: failed/abandoned calls | WHAT: no duration
      // WHEN: call never connected | WHERE: call tracking
      // WHY: track call attempts without duration
    })

    test('handles zero duration in call tracking', async () => {
      await service.trackCall('tenant-1', 'outbound', 'CA1', Provider.TWILIO, 0)

      const records = await service.getUsageByTenant('tenant-1')
      // Zero is falsy, so metadata should be undefined
      expect(records[0].metadata).toBeUndefined()
      // WHO: instant hangups | WHAT: zero duration
      // WHEN: call connected but hung up | WHERE: call tracking
      // WHY: zero duration treated as no duration
    })
  })

  describe('Edge Cases', () => {
    test('tracks multiple records in sequence', async () => {
      for (let i = 0; i < 100; i++) {
        await service.trackSMS('tenant-1', 'outbound', `SM${i}`)
      }

      const records = await service.getUsageByTenant('tenant-1')
      expect(records).toHaveLength(100)
    })

    test('timestamps are ISO format strings', async () => {
      await service.trackSMS('tenant-1', 'outbound', 'SM1')

      const records = await service.getUsageByTenant('tenant-1')
      expect(records[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    test('different providers are tracked correctly', async () => {
      await service.trackSMS('tenant-1', 'outbound', 'SM1', Provider.TWILIO)
      await service.trackSMS('tenant-1', 'outbound', 'SM2', Provider.MOCK)

      const records = await service.getUsageByTenant('tenant-1')
      expect(records.find(r => r.externalId === 'SM1')?.provider).toBe(Provider.TWILIO)
      expect(records.find(r => r.externalId === 'SM2')?.provider).toBe(Provider.MOCK)
    })

    test('getUsageSummary only counts specified tenant', async () => {
      await service.trackSMS('tenant-1', 'outbound', 'SM1')
      await service.trackSMS('tenant-2', 'outbound', 'SM2')
      await service.trackSMS('tenant-2', 'outbound', 'SM3')

      const summary1 = await service.getUsageSummary('tenant-1')
      const summary2 = await service.getUsageSummary('tenant-2')

      expect(summary1.sms).toBe(1)
      expect(summary2.sms).toBe(2)
    })
  })

  describe('Singleton Instance', () => {
    test('usageTracker is an instance of UsageTrackingService', () => {
      expect(usageTracker).toBeInstanceOf(UsageTrackingService)
      // WHO: application code | WHAT: singleton pattern
      // WHEN: importing service | WHERE: module exports
      // WHY: single instance for consistent tracking
    })

    test('usageTracker can track usage', async () => {
      await usageTracker.trackSMS('singleton-test', 'outbound', 'SM1')

      const records = await usageTracker.getUsageByTenant('singleton-test')
      expect(records).toHaveLength(1)
    })
  })
})
