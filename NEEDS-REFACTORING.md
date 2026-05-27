# NEEDS-REFACTORING (Historical)

**Status (2026-05-27):** This document is archived.

Most major structural refactors it originally tracked (CRM adapter deletion, UsageTrackingService removal, `employee_shifts` retirement, tenant-config wiring, CLAUDE.md drift detector, etc.) have been completed and documented in `RESOLVED.md`.

## Resolution Lens (Preserved Philosophy)

The core decision framework from this document remains valuable:

Every “wire this dormant layer or delete it” decision should be evaluated through this lens (see `CLAUDE.md` → Build Principles):

1. **Can it be tested against a real external surface today?** A real CRM account, a real Stripe metered-billing event, a real provider API. Mocked-API tests don’t count.
2. **Is there a real customer or sales conversation asking for it?** “Pro tier roadmap” and “we might need this someday” don’t qualify.

If the answer to both is no, the default answer is **delete**. Speculative scaffolding is more expensive than re-adding the layer when a real consumer arrives.

This philosophy continues to guide mechanical cleanup work in `REFACTORING_TODO.md`.

---

See `RESOLVED.md` for the completed major refactors and `docs/README.md` → Documentation Principles for the current model.

_This file is retained only for its historical “Resolution lens” philosophy._
