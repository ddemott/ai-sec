-- wizard-vocab-examples: per-industry placeholder examples for the
-- StepResources wizard input (the StepServices side already had
-- `example_services text[]` populated; this finishes the pair).
--
-- Origin: 2026-05-18 UX audit — placeholders like "e.g. Bay 1, Chair A,
-- Room 3" cram three different industries into one example string. By
-- the time the wizard reaches these steps the user has already picked
-- a business type via BusinessTypePicker, so the vocab system knows
-- the industry. Adapt the placeholder.
--
-- Column shape mirrors `example_services` (existing). The UPDATE
-- generates per-row defaults from each template's `resource_label` so
-- a "Wash Bay" template gets ["Wash Bay 1", "Wash Bay 2", "Wash Bay 3"]
-- and an "Office" template gets ["Office 1", "Office 2", "Office 3"].
-- Real customers rename these when they configure their actual rows;
-- the goal is to show the SHAPE of a sensible name, not a curated list.

ALTER TABLE business_templates
    ADD COLUMN IF NOT EXISTS example_resources text[] DEFAULT '{}'::text[];

UPDATE business_templates
SET example_resources = ARRAY[
    resource_label || ' 1',
    resource_label || ' 2',
    resource_label || ' 3'
]
WHERE example_resources IS NULL OR example_resources = '{}';
