-- PER-TENANT QUESTION TREES — the call's questions become DATA IN THE DATABASE.
--
-- WHAT CHANGES. Until now every question the agent could ask lived in
-- agent/src/checklist/trees.ts, and per-tenant configuration could only
-- SUBTRACT from it (disable a block, make a field optional/required, reword an
-- approved question). There was no ADD verb anywhere in the system, which is
-- precisely how the `job` tree became unreachable for every tenant on
-- 2026-08-13: a preset omission was an outage nobody could fix from the
-- dashboard. Onboarding a client whose intake differs from the platform's meant
-- editing TypeScript and shipping a deploy.
--
-- THE MODEL THIS ESTABLISHES. A vertical (law_firm, auto_shop, salon, …) owns a
-- TEMPLATE set of trees — the generic starting point. Provisioning a tenant
-- COPIES that template into the tenant's own rows. From then on the tenant's
-- rows are the truth for their calls, and editing them changes what their phone
-- line asks without touching another client and without a deploy.
--
-- WHY COPY AT PROVISIONING RATHER THAN INHERIT. An inherited template means a
-- platform edit silently changes what an existing client's callers are asked.
-- This codebase has been burned repeatedly by exactly that shape of invisible
-- change (the greeting that reached prod through a template rewrite; the preset
-- that silently fell back). After the copy, what the owner can read in their own
-- rows IS what the call will run. No hidden inheritance, no spooky action.
--
-- STORAGE IS NORMALIZED, NOT A JSON BLOB. A tree is recursive — choice nodes
-- nest their follow-ups — so the nesting is carried by parent_*_node_id plus
-- option_key (which branch of the parent choice this child hangs from) and
-- sort_order (the ask order, which IS the call's order). The cost is a
-- recursive CTE on read and a multi-row transaction on write. The benefit is
-- that a single question is addressable, queryable and editable on its own,
-- which is what "configure this client's intake" actually means in practice.
--
-- THE TS LIBRARY IS NOT DELETED. It remains the source of the template CONTENT
-- (seeded by scripts/seed-question-tree-templates.ts, so the questions are
-- authored in one place and reviewed in code) and the runtime FALLBACK for any
-- tenant with no rows yet. A tenant with zero rows behaves exactly as it does
-- today — this migration cannot change any existing call on its own.

-- ── Platform templates: the generic starting point per vertical ─────────────
--
-- No tenant dimension, so no RLS — same posture as business_templates. The
-- `vertical` 'platform' holds trees every vertical shares (identity, booking,
-- message, qa, schedule_change); a named vertical holds the trees specific to
-- it (law_firm → case_intake).

CREATE TABLE IF NOT EXISTS question_tree_templates (
  vertical      TEXT        NOT NULL,
  tree_id       TEXT        NOT NULL,
  description   TEXT        NOT NULL,
  sort_order    INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite natural key: two short, stable columns that ARE the identity.
  -- No surrogate — "what makes a row unique" is enforced at the PK level.
  PRIMARY KEY (vertical, tree_id),
  CONSTRAINT question_tree_templates_vertical_chk CHECK (vertical <> ''),
  CONSTRAINT question_tree_templates_tree_id_chk CHECK (tree_id <> '')
);

CREATE TABLE IF NOT EXISTS question_tree_template_nodes (
  -- Surrogate PK: the natural key (vertical, tree_id, node_id) is three
  -- columns, which the house rule sends to a surrogate — and the self-FK below
  -- needs a single column to point at anyway.
  template_node_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical                TEXT        NOT NULL,
  tree_id                 TEXT        NOT NULL,
  node_id                 TEXT        NOT NULL,
  -- Nesting. NULL parent = a top-level node of the tree. A child hangs off ONE
  -- branch of its parent choice, named by option_key.
  parent_template_node_id UUID        NULL REFERENCES question_tree_template_nodes(template_node_id) ON DELETE CASCADE,
  option_key              TEXT        NULL,
  sort_order              INT         NOT NULL DEFAULT 0,
  node_type               TEXT        NOT NULL,
  -- text/choice nodes: what to collect, phrased for the model.
  ask                     TEXT        NULL,
  -- Listen-only: never asked, never gates the goodbye — recorded if volunteered.
  listen                  BOOLEAN     NOT NULL DEFAULT false,
  -- choice nodes: the option keys, including ones with no children (a branch
  -- that exists but asks nothing further still has to be selectable).
  choice_options          TEXT[]      NULL,
  -- action nodes: the real tool whose success id completes the node.
  tool                    TEXT        NULL,
  action_description      TEXT        NULL,
  requires                TEXT[]      NULL,
  await_tree              BOOLEAN     NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT question_tree_template_nodes_type_chk
    CHECK (node_type IN ('text', 'choice', 'action')),
  CONSTRAINT question_tree_template_nodes_tree_fk
    FOREIGN KEY (vertical, tree_id)
    REFERENCES question_tree_templates(vertical, tree_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_question_tree_template_nodes_tree
  ON question_tree_template_nodes (vertical, tree_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_question_tree_template_nodes_parent
  ON question_tree_template_nodes (parent_template_node_id);

-- A NODE ID IS *NOT* UNIQUE WITHIN A TREE, AND THAT IS DELIBERATE.
--
-- The first cut of this schema enforced UNIQUE (vertical, tree_id, node_id) on
-- the reasoning that a duplicate id inside one tree would be a mistake. Seeding
-- the real library proved otherwise immediately:
--
--   Key (vertical, tree_id, node_id)=(owner_for_hire, job, rate_range) already exists
--
-- The job tree lists `rate_range` under BOTH the `contract` and
-- `contract_to_hire` branches on purpose — "one question, two paths to
-- relevance; an early 'it pays 65 to 80' survives either answer." The tracker
-- merges them to a single node. A constraint that rejected it would have forced
-- either a mangled seed or an invented second node id.
--
-- What IS a mistake is the same node id twice in the SAME branch, which would
-- be a genuine duplicate question. That is what this index forbids. COALESCE
-- because a top-level node has a NULL parent and NULL never equals NULL in a
-- unique index — without it the rule would silently not apply to exactly the
-- nodes most likely to be duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS question_tree_template_nodes_unique_in_branch
  ON question_tree_template_nodes (
    vertical,
    tree_id,
    COALESCE(parent_template_node_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(option_key, ''),
    node_id
  );

-- ── Tenant copies: what a given client's calls actually run ─────────────────

CREATE TABLE IF NOT EXISTS tenant_question_trees (
  tenant_id       UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  tree_id         TEXT        NOT NULL,
  description     TEXT        NOT NULL,
  -- Which vertical template this was copied from, kept for provenance: "where
  -- did this client's intake come from before they edited it".
  source_vertical TEXT        NULL,
  -- Flipped by the first edit. Lets support answer "has this client diverged
  -- from the generic template?" without diffing every node.
  is_customized   BOOLEAN     NOT NULL DEFAULT false,
  -- A tenant can retire a tree without deleting their edits to it.
  is_enabled      BOOLEAN     NOT NULL DEFAULT true,
  sort_order      INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, tree_id),
  CONSTRAINT tenant_question_trees_tree_id_chk CHECK (tree_id <> '')
);

CREATE TABLE IF NOT EXISTS tenant_question_nodes (
  tenant_question_node_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                      UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  tree_id                        TEXT        NOT NULL,
  node_id                        TEXT        NOT NULL,
  parent_tenant_question_node_id UUID        NULL REFERENCES tenant_question_nodes(tenant_question_node_id) ON DELETE CASCADE,
  option_key                     TEXT        NULL,
  sort_order                     INT         NOT NULL DEFAULT 0,
  node_type                      TEXT        NOT NULL,
  ask                            TEXT        NULL,
  listen                         BOOLEAN     NOT NULL DEFAULT false,
  choice_options                 TEXT[]      NULL,
  tool                           TEXT        NULL,
  action_description             TEXT        NULL,
  requires                       TEXT[]      NULL,
  await_tree                     BOOLEAN     NOT NULL DEFAULT false,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_question_nodes_type_chk
    CHECK (node_type IN ('text', 'choice', 'action')),
  CONSTRAINT tenant_question_nodes_tree_fk
    FOREIGN KEY (tenant_id, tree_id)
    REFERENCES tenant_question_trees(tenant_id, tree_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_question_nodes_tree
  ON tenant_question_nodes (tenant_id, tree_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_tenant_question_nodes_parent
  ON tenant_question_nodes (parent_tenant_question_node_id);

-- Same rule, same reason as the template side: unique WITHIN A BRANCH, not
-- within a tree. See the note above the template index.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_question_nodes_unique_in_branch
  ON tenant_question_nodes (
    tenant_id,
    tree_id,
    COALESCE(parent_tenant_question_node_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(option_key, ''),
    node_id
  );

-- ── updated_at triggers (house fn_set_updated_at) ───────────────────────────

DROP TRIGGER IF EXISTS trg_question_tree_templates_updated_at ON question_tree_templates;
CREATE TRIGGER trg_question_tree_templates_updated_at
  BEFORE UPDATE ON question_tree_templates
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_question_tree_template_nodes_updated_at ON question_tree_template_nodes;
CREATE TRIGGER trg_question_tree_template_nodes_updated_at
  BEFORE UPDATE ON question_tree_template_nodes
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_question_trees_updated_at ON tenant_question_trees;
CREATE TRIGGER trg_tenant_question_trees_updated_at
  BEFORE UPDATE ON tenant_question_trees
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_tenant_question_nodes_updated_at ON tenant_question_nodes;
CREATE TRIGGER trg_tenant_question_nodes_updated_at
  BEFORE UPDATE ON tenant_question_nodes
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── RLS on the tenant-scoped tables ────────────────────────────────────────
--
-- Policies read the context through tenant_ctx_uuid() rather than casting the
-- raw GUC: a cold pool connection has it NULL and clearTenantContext() sets it
-- to the empty string, and ''::uuid raises on every request. Both landmines
-- were paid for on 2026-07-24 (migration 20260724000000).

ALTER TABLE tenant_question_trees ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_question_trees FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_question_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_question_nodes FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenant_question_trees'
      AND policyname = 'tenant_question_trees_tenant_isolation'
  ) THEN
    CREATE POLICY tenant_question_trees_tenant_isolation ON tenant_question_trees
      USING (tenant_id = tenant_ctx_uuid())
      WITH CHECK (tenant_id = tenant_ctx_uuid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenant_question_trees'
      AND policyname = 'tenant_question_trees_admin_bypass'
  ) THEN
    CREATE POLICY tenant_question_trees_admin_bypass ON tenant_question_trees
      USING (tenant_ctx() = '')
      WITH CHECK (tenant_ctx() = '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenant_question_nodes'
      AND policyname = 'tenant_question_nodes_tenant_isolation'
  ) THEN
    CREATE POLICY tenant_question_nodes_tenant_isolation ON tenant_question_nodes
      USING (tenant_id = tenant_ctx_uuid())
      WITH CHECK (tenant_id = tenant_ctx_uuid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenant_question_nodes'
      AND policyname = 'tenant_question_nodes_admin_bypass'
  ) THEN
    CREATE POLICY tenant_question_nodes_admin_bypass ON tenant_question_nodes
      USING (tenant_ctx() = '')
      WITH CHECK (tenant_ctx() = '');
  END IF;
END $$;

-- ── Provisioning copy ──────────────────────────────────────────────────────
--
-- SECURITY DEFINER because it reads the platform template tables (no tenant
-- dimension, no RLS) and writes tenant rows in one step, and because tenant
-- creation runs before any tenant context is set.
--
-- IDEMPOTENCY IS AT TREE GRANULARITY, AND THAT IS THE POINT. A tree the tenant
-- already has is skipped ENTIRELY — not merged, not topped up. Re-running this
-- after a client has customized their intake must never reintroduce a question
-- they deleted or restore wording they rewrote, and a node-level upsert would do
-- exactly that. If a client genuinely wants the generic tree back, that is a
-- deliberate delete-then-recopy, not a side effect of provisioning running twice.
--
-- The copy carries a MAPPING TABLE from template node to tenant node so the
-- parent links can be rebuilt. It cannot be rebuilt by matching on
-- (tree_id, node_id): a node id legitimately appears in more than one branch of
-- the same tree (job.rate_range under both `contract` and `contract_to_hire`),
-- so that match is ambiguous exactly where the nesting matters.

CREATE OR REPLACE FUNCTION copy_question_tree_templates_to_tenant(
  p_tenant_id UUID,
  p_verticals TEXT[]
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_copied INT := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_verticals IS NULL OR array_length(p_verticals, 1) IS NULL THEN
    RETURN 0;
  END IF;

  CREATE TEMP TABLE _copy_trees ON COMMIT DROP AS
  SELECT t.vertical, t.tree_id, t.description, t.sort_order
    FROM question_tree_templates t
   WHERE t.vertical = ANY (p_verticals)
     AND NOT EXISTS (
       SELECT 1 FROM tenant_question_trees existing
        WHERE existing.tenant_id = p_tenant_id AND existing.tree_id = t.tree_id
     );

  IF NOT EXISTS (SELECT 1 FROM _copy_trees) THEN
    RETURN 0;
  END IF;

  INSERT INTO tenant_question_trees (tenant_id, tree_id, description, source_vertical, sort_order)
  SELECT p_tenant_id, c.tree_id, c.description, c.vertical, c.sort_order
    FROM _copy_trees c;

  -- One tenant node per template node, remembering where it came from.
  CREATE TEMP TABLE _copy_nodes ON COMMIT DROP AS
  SELECT n.template_node_id,
         n.parent_template_node_id,
         gen_random_uuid() AS tenant_question_node_id,
         n.tree_id, n.node_id, n.option_key, n.sort_order, n.node_type,
         n.ask, n.listen, n.choice_options, n.tool, n.action_description,
         n.requires, n.await_tree
    FROM question_tree_template_nodes n
    JOIN _copy_trees c ON c.vertical = n.vertical AND c.tree_id = n.tree_id;

  INSERT INTO tenant_question_nodes (
    tenant_question_node_id, tenant_id, tree_id, node_id,
    parent_tenant_question_node_id, option_key, sort_order, node_type,
    ask, listen, choice_options, tool, action_description, requires, await_tree
  )
  SELECT cn.tenant_question_node_id,
         p_tenant_id,
         cn.tree_id,
         cn.node_id,
         parent.tenant_question_node_id,
         cn.option_key,
         cn.sort_order,
         cn.node_type,
         cn.ask,
         cn.listen,
         cn.choice_options,
         cn.tool,
         cn.action_description,
         cn.requires,
         cn.await_tree
    FROM _copy_nodes cn
    LEFT JOIN _copy_nodes parent
      ON parent.template_node_id = cn.parent_template_node_id;

  GET DIAGNOSTICS v_copied = ROW_COUNT;
  RETURN v_copied;
END;
$$;

COMMENT ON TABLE question_tree_templates IS
  'Platform question-tree templates per vertical — the generic starting point copied into a tenant at provisioning. Content is authored in agent/src/checklist/trees.ts and seeded by scripts/seed-question-tree-templates.ts.';

COMMENT ON TABLE tenant_question_trees IS
  'A tenant OWN copy of the question trees their calls run. Copied from question_tree_templates at provisioning; edits here change that client''s calls only.';

COMMENT ON COLUMN tenant_question_nodes.option_key IS
  'Which branch of the parent CHOICE node this child hangs from. NULL for top-level nodes and for children of non-choice parents.';

COMMENT ON FUNCTION copy_question_tree_templates_to_tenant(UUID, TEXT[]) IS
  'Copy the named verticals'' template trees into a tenant. Idempotent: existing tenant trees/nodes are never overwritten, so a re-run cannot revert a customized intake.';
