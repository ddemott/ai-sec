---
name: Testing standards - happy/sad paths with 5W diagnostics
description: Tests must cover both happy and sad paths. Sad path errors must include who/what/where/when/how context.
type: feedback
---

Tests must always cover both happy paths AND sad paths.

**Why:** User wants comprehensive test coverage that helps debug failures quickly. Sad paths are just as important as happy paths — they verify error handling works and produces actionable diagnostics.

**How to apply:**
- Every test file should have both success and failure scenarios
- Sad path tests should verify error messages contain 5W diagnostic context: WHO (tenant/user), WHAT (operation that failed), WHERE (route/function), WHEN (timestamp or context), HOW (root cause or fix guidance)
- Don't just test that an error is thrown — test that the error message is useful for debugging
- Example: instead of `expect(res.status).toBe(400)`, also check `expect(res.body.error).toContain('tenant_id')` to verify the error tells the caller what went wrong
