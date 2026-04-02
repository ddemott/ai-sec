/**
 * Tests for remaining bug fixes: BUG-030, BUG-031, BUG-032, BUG-038
 * Each section has happy + sad paths with 5W diagnostic context.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── BUG-032: call_summaries.embedding population ─────────────────────

describe('BUG-032: call_summaries.embedding via n8n workflow', () => {
  const workflowPath = path.join(__dirname, '..', 'n8n', 'post_call_summarizer.json');
  let workflow: any;

  it('should load the n8n workflow JSON', () => {
    const raw = fs.readFileSync(workflowPath, 'utf-8');
    workflow = JSON.parse(raw);
    expect(workflow).toBeDefined();
    expect(workflow.name).toBe('SecretaryHQ: Post-Call Summarizer');
    // WHO: n8n workflow | WHAT: post-call processing | WHEN: after every call
    // WHERE: n8n/post_call_summarizer.json | WHY: ensures workflow is valid JSON
  });

  describe('Happy Paths', () => {
    it('should have an embedding generation node', () => {
      const embeddingNode = workflow.nodes.find((n: any) => n.name === 'OpenAI: Generate Embedding');
      expect(embeddingNode).toBeDefined();
      expect(embeddingNode.parameters.model).toBe('text-embedding-3-small');
      // WHO: n8n | WHAT: generates 1536-dim vector | WHEN: after summarization
      // WHERE: OpenAI embedding node | WHY: enables semantic search over call history
    });

    it('should include embedding column in Supabase insert', () => {
      const saveNode = workflow.nodes.find((n: any) => n.name === 'Supabase: Save Summary');
      expect(saveNode).toBeDefined();
      expect(saveNode.parameters.columns).toContain('embedding');
      // WHO: n8n | WHAT: INSERT with embedding | WHEN: after embedding generated
      // WHERE: Supabase insert node | WHY: BUG-032 — embedding was previously omitted
    });

    it('should chain Summarize -> Embedding -> Save in correct order', () => {
      const connections = workflow.connections;

      // Summarize -> Embedding
      const summarizeOutputs = connections['OpenAI: Summarize']?.main?.[0];
      expect(summarizeOutputs).toBeDefined();
      expect(summarizeOutputs[0].node).toBe('OpenAI: Generate Embedding');

      // Embedding -> Save
      const embeddingOutputs = connections['OpenAI: Generate Embedding']?.main?.[0];
      expect(embeddingOutputs).toBeDefined();
      expect(embeddingOutputs[0].node).toBe('Supabase: Save Summary');
      // WHO: n8n | WHAT: correct node ordering | WHEN: call processing
      // WHERE: workflow connections | WHY: embedding must be generated before save
    });

    it('should reference the embedding output in the save node values', () => {
      const saveNode = workflow.nodes.find((n: any) => n.name === 'Supabase: Save Summary');
      const embeddingValue = saveNode.parameters.values.embedding;
      expect(embeddingValue).toBeDefined();
      expect(embeddingValue).toContain('embedding');
      // WHO: n8n | WHAT: maps embedding output to DB column | WHEN: insert
      // WHERE: save node values | WHY: ensures vector data flows to the column
    });

    it('should include all required columns: summary, tenant_id, call_id, embedding', () => {
      const saveNode = workflow.nodes.find((n: any) => n.name === 'Supabase: Save Summary');
      const columns = saveNode.parameters.columns;
      expect(columns).toContain('summary');
      expect(columns).toContain('tenant_id');
      expect(columns).toContain('call_id');
      expect(columns).toContain('embedding');
    });
  });

  describe('Sad Paths', () => {
    it('should have exactly 4 nodes (webhook, summarize, embedding, save)', () => {
      expect(workflow.nodes).toHaveLength(4);
      // WHO: developer | WHAT: node count validation | WHEN: workflow change
      // WHERE: workflow definition | WHY: prevents accidental node deletion
    });

    it('should not have orphaned nodes (all must be connected)', () => {
      const nodeNames = new Set(workflow.nodes.map((n: any) => n.name));
      const connectedNodes = new Set<string>();

      // Source nodes (have outgoing connections)
      for (const [source, conns] of Object.entries(workflow.connections)) {
        connectedNodes.add(source);
        const main = (conns as any)?.main?.[0] || [];
        for (const conn of main) {
          connectedNodes.add(conn.node);
        }
      }

      // Every node except the webhook (entry point) should appear as a target
      for (const name of nodeNames) {
        expect(connectedNodes.has(name)).toBe(true);
      }
    });
  });
});

// ── BUG-030: link_orphaned_transcripts() wiring ──────────────────────

describe('BUG-030: link_orphaned_transcripts wiring', () => {
  describe('Happy Paths', () => {
    it('should have linkOrphanedTranscripts in IRepository interface', () => {
      const interfacePath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'interfaces.ts');
      const content = fs.readFileSync(interfacePath, 'utf-8');
      expect(content).toContain('linkOrphanedTranscripts');
      expect(content).toContain('tenantId: string');
      // WHO: edge function | WHAT: interface contract | WHEN: after call ends
      // WHERE: interfaces.ts | WHY: ensures repo implements the method
    });

    it('should implement linkOrphanedTranscripts in PostgresRepository', () => {
      const repoPath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'db', 'repository.ts');
      const content = fs.readFileSync(repoPath, 'utf-8');
      expect(content).toContain('async linkOrphanedTranscripts');
      expect(content).toContain('SELECT link_orphaned_transcripts');
      // WHO: PostgresRepository | WHAT: calls SQL function | WHEN: handleCallEnded
      // WHERE: repository.ts | WHY: links transcripts to customers via call_id match
    });

    it('should expose linkOrphanedTranscripts through AISecretaryService', () => {
      const servicePath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'service.ts');
      const content = fs.readFileSync(servicePath, 'utf-8');
      expect(content).toContain('linkOrphanedTranscripts');
      // WHO: service layer | WHAT: delegates to repo | WHEN: called by dispatcher
      // WHERE: service.ts | WHY: maintains service-layer abstraction
    });

    it('should call linkOrphanedTranscripts in handleCallEnded', () => {
      const dispatcherPath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'dispatcher.ts');
      const content = fs.readFileSync(dispatcherPath, 'utf-8');
      expect(content).toContain('linkOrphanedTranscripts');
      expect(content).toContain('handleCallEnded');
      // WHO: dispatcher | WHAT: triggers transcript linking | WHEN: end-of-call-report
      // WHERE: dispatcher.ts | WHY: call ended is the ideal time to link transcripts
    });
  });

  describe('Sad Paths', () => {
    it('should handle missing tenant_id gracefully in handleCallEnded', () => {
      const dispatcherPath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'dispatcher.ts');
      const content = fs.readFileSync(dispatcherPath, 'utf-8');
      // Should only attempt linking if tenantId is present
      expect(content).toContain('if (tenantId)');
      // WHO: dispatcher | WHAT: guards against missing tenant | WHEN: malformed call end
      // WHERE: dispatcher.ts | WHY: prevents crash if Vapi sends incomplete metadata
    });

    it('should catch and log errors without crashing the response', () => {
      const dispatcherPath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'dispatcher.ts');
      const content = fs.readFileSync(dispatcherPath, 'utf-8');
      // Should have try/catch around linkOrphanedTranscripts
      expect(content).toContain('Failed to link orphaned transcripts (non-fatal)');
      // WHO: dispatcher | WHAT: error isolation | WHEN: DB failure during linking
      // WHERE: dispatcher.ts | WHY: transcript linking failure must not break call flow
    });

    it('should still return 200 even if linking fails', () => {
      const dispatcherPath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'dispatcher.ts');
      const content = fs.readFileSync(dispatcherPath, 'utf-8');
      // After the try/catch block, should return 200
      const callEndedSection = content.substring(content.indexOf('handleCallEnded'));
      expect(callEndedSection).toContain('return new Response(null, { status: 200 })');
    });
  });
});

// ── BUG-031: check_availability_with_tz() usage ──────────────────────

describe('BUG-031: check_availability_with_tz in edge function', () => {
  describe('Happy Paths', () => {
    it('should have checkAvailabilityWithTz in IRepository interface', () => {
      const interfacePath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'interfaces.ts');
      const content = fs.readFileSync(interfacePath, 'utf-8');
      expect(content).toContain('checkAvailabilityWithTz');
      expect(content).toContain('tenant_timezone: string');
      expect(content).toContain('local_start: string');
      expect(content).toContain('local_end: string');
      // WHO: IRepository | WHAT: timezone-aware availability | WHEN: check_availability tool
      // WHERE: interfaces.ts | WHY: returns formatted local times for display
    });

    it('should implement checkAvailabilityWithTz in PostgresRepository', () => {
      const repoPath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'db', 'repository.ts');
      const content = fs.readFileSync(repoPath, 'utf-8');
      expect(content).toContain('async checkAvailabilityWithTz');
      expect(content).toContain('check_availability_with_tz');
      expect(content).toContain('timestamptz');
      // WHO: PostgresRepository | WHAT: calls RPC | WHEN: availability check
      // WHERE: repository.ts | WHY: delegates timezone logic to SQL
    });

    it('should use checkAvailabilityWithTz in service.checkAvailability', () => {
      const servicePath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'service.ts');
      const content = fs.readFileSync(servicePath, 'utf-8');
      // The service should call the new tz-aware method
      expect(content).toContain('checkAvailabilityWithTz');
      expect(content).toContain('BUG-031');
      // WHO: service | WHAT: uses tz-aware check | WHEN: check_availability tool call
      // WHERE: service.ts | WHY: replaces raw overlap SQL with timezone-aware RPC
    });

    it('should return timezone and local times in availability response', () => {
      const servicePath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'service.ts');
      const content = fs.readFileSync(servicePath, 'utf-8');
      expect(content).toContain('tenant_timezone');
      expect(content).toContain('local_start');
      expect(content).toContain('local_end');
    });
  });

  describe('Sad Paths', () => {
    it('should still validate date formats before calling RPC', () => {
      const servicePath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'service.ts');
      const content = fs.readFileSync(servicePath, 'utf-8');
      expect(content).toContain('isNaN(Date.parse(startTime))');
      expect(content).toContain('Invalid date format');
      // WHO: service | WHAT: validates input | WHEN: before DB call
      // WHERE: service.ts | WHY: prevents bad data from reaching the database
    });

    it('should still validate end time is after start time', () => {
      const servicePath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'core', 'service.ts');
      const content = fs.readFileSync(servicePath, 'utf-8');
      expect(content).toContain('end <= start');
      expect(content).toContain('End time must be after start time');
    });

    it('should have the SQL function in migrations', () => {
      const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260316600000_customer_tz_and_n8n.sql');
      const content = fs.readFileSync(migrationPath, 'utf-8');
      expect(content).toContain('CREATE OR REPLACE FUNCTION check_availability_with_tz');
      expect(content).toContain('p_tenant_id UUID');
      expect(content).toContain('p_resource_id UUID');
      expect(content).toContain('p_start_time TIMESTAMPTZ');
      // WHO: migration | WHAT: RPC definition | WHEN: schema setup
      // WHERE: migration SQL | WHY: function must exist before edge function calls it
    });
  });
});

// ── BUG-038: Soft delete filtering in edge function ──────────────────

describe('BUG-038: Soft delete filtering in edge function queries', () => {
  const repoPath = path.join(__dirname, '..', 'supabase', 'functions', 'vapi-tools', 'db', 'repository.ts');
  let repoContent: string;

  it('should load repository source', () => {
    repoContent = fs.readFileSync(repoPath, 'utf-8');
    expect(repoContent).toBeDefined();
  });

  describe('Happy Paths — queries filter soft-deleted records', () => {
    it('findCustomerByPhone should filter is_deleted', () => {
      const method = extractMethod(repoContent, 'findCustomerByPhone');
      expect(method).toContain('is_deleted');
      // WHO: voice AI | WHAT: customer lookup | WHEN: get_customer_context tool
      // WHERE: repository.ts | WHY: must not return deleted customers to callers
    });

    it('checkOverlap should filter is_deleted', () => {
      const method = extractMethod(repoContent, 'checkOverlap');
      expect(method).toContain('is_deleted');
      // WHO: voice AI | WHAT: overlap check | WHEN: check_availability tool
      // WHERE: repository.ts | WHY: deleted appointments shouldn't block scheduling
    });

    it('getSchedulingResources should filter is_deleted', () => {
      const method = extractMethod(repoContent, 'getSchedulingResources');
      expect(method).toContain('is_deleted');
      // WHO: scheduling engine | WHAT: resource loading | WHEN: get_scheduling_options
      // WHERE: repository.ts | WHY: deleted resources must not receive appointments
    });

    it('getSchedulingEmployees should filter is_deleted', () => {
      const method = extractMethod(repoContent, 'getSchedulingEmployees');
      expect(method).toContain('is_deleted');
      // WHO: scheduling engine | WHAT: employee loading | WHEN: booking
      // WHERE: repository.ts | WHY: deleted employees must not be assigned
    });

    it('getExistingAppointments should filter is_deleted', () => {
      const method = extractMethod(repoContent, 'getExistingAppointments');
      expect(method).toContain('is_deleted');
      // WHO: scheduling engine | WHAT: existing apt check | WHEN: scheduling
      // WHERE: repository.ts | WHY: deleted appointments should not cause conflicts
    });

    it('getEmployees should filter is_deleted', () => {
      const method = extractMethod(repoContent, 'getEmployees');
      expect(method).toContain('is_deleted');
      // WHO: admin CRUD | WHAT: list employees | WHEN: any employee listing
      // WHERE: repository.ts | WHY: UI should not show deleted employees
    });

    it('getAvailableSlots appointments query should filter is_deleted', () => {
      const method = extractMethod(repoContent, 'getAvailableSlots');
      expect(method).toContain('is_deleted');
      // WHO: voice AI | WHAT: slot computation | WHEN: get_available_slots tool
      // WHERE: repository.ts | WHY: deleted appointments should not consume slots
    });
  });

  describe('Happy Paths — soft deletes instead of hard deletes', () => {
    it('deleteEmployee should use UPDATE (soft delete) not DELETE', () => {
      const method = extractMethod(repoContent, 'deleteEmployee');
      expect(method).toContain('UPDATE employees SET is_deleted = true');
      expect(method).toContain('deleted_at = now()');
      expect(method).not.toContain('DELETE FROM employees');
      // WHO: admin | WHAT: soft delete | WHEN: employee removal
      // WHERE: repository.ts | WHY: hard deletes break foreign key refs in history
    });
  });

  describe('Sad Paths — uses IS NULL OR pattern for safety', () => {
    it('should use (is_deleted IS NULL OR is_deleted = false) pattern for backwards compat', () => {
      // Older records may not have is_deleted column populated (NULL)
      // The IS NULL OR pattern ensures they're still included
      const matches = repoContent.match(/is_deleted IS NULL OR [\w.]*is_deleted = false/g);
      expect(matches).toBeDefined();
      expect(matches!.length).toBeGreaterThanOrEqual(7);
      // WHO: any query | WHAT: null-safe filter | WHEN: querying soft-deletable tables
      // WHERE: repository.ts | WHY: NULL is_deleted means "not deleted" (backwards compat)
    });
  });
});

// ── Helper: extract a method body from source code ───────────────────

function extractMethod(source: string, methodName: string): string {
  const idx = source.indexOf(`async ${methodName}`);
  if (idx === -1) return '';
  // Find the next method or end of class
  const nextMethodRegex = /\n  async [a-zA-Z]/g;
  nextMethodRegex.lastIndex = idx + 10;
  const nextMatch = nextMethodRegex.exec(source);
  const endIdx = nextMatch ? nextMatch.index : source.length;
  return source.substring(idx, endIdx);
}
