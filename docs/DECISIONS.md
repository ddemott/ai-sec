# AI Secretary — Decision Log

Decisions that have been made but may not be implemented yet. Each entry has a status, context, and clear next steps. This prevents decisions from getting lost in session notes, TODO lists, or chat history.

---

## Adopted (implementing now)

### Pricing: $129 / $279 / $449 / $1,200+
- **Decision**: Replace $29/$59/$99 pricing with higher tiers
- **Tiers**: Solo $129/mo (150 calls, 1 staff, 1 resource) | Growth $279/mo (500 calls, 5 staff, 3 resources) | Professional $449/mo (unlimited + BI) | Enterprise $1,200+/mo (multi-location, white label — not yet defined)
- **Rationale**: $29/mo doesn't cover infrastructure costs and signals "cheap tool." A 24/7 AI receptionist replaces a $1,200/mo part-time human.
- **Validate with**: DynaTire before committing. If they balk, $99 may be Solo sweet spot.

### HIPAA: Permanently removed
- **Decision**: No medical/dental/veterinary/chiropractic anywhere in the UI. No "coming soon." No greyed-out tiles.
- **Rationale**: "Coming soon" creates liability expectations before legal infrastructure exists.
- **Action**: Remove any remaining "coming soon" language in docs.

### Services table: subtitle + description columns
- **Decision**: Add `subtitle TEXT` and `description TEXT` to services table.
- **Use**: subtitle = what AI reads to caller. description = knowledge base detail.
- **Collection**: Dashboard only (not wizard). Day 2, not Day 0.

### Two-layer knowledge system
- **Decision**: Database tool calls for facts (pricing, availability, booking). RAG for policies only (cancellation, service area, payment terms).
- **Key principle**: AI never halluculates pricing or availability — that's from the database.
- **Implementation**: New `getServiceCatalog` tool in vapi-tools Edge Function.
- **Marketing**: "No hallucinations. Ever."

### Solo wizard branching
- **Decision**: team_size = 1 → SoloWizard (2 steps: services + availability). team_size > 1 → SetupWizard (6 steps).
- **Auto-created on solo completion**: 1 employee (the owner), 1 personal resource, all services assigned.
- **Design reference**: SoloWizard.html mockup from March 18 session.

---

## Deferred (decided but not building yet)

### Query routing normalization
- **Decision**: GPT-4o-mini call before every caller question (~150ms, temp 0.1). Returns `{ normalized, route: "database" | "rag" | "booking" }`. Main LLM never makes routing decisions. Falls back to "rag" on failure.
- **Why defer**: Optimization, not launch-blocking. The current system works without it.
- **When to build**: After beta testing reveals routing accuracy issues.
- **Related**: `shared/normalizeForEmbedding.ts` already does similar normalization for RAG.

### Travel buffer
- **Decision**: `buffer_minutes` field for mobile businesses (time between appointments for driving).
- **Open question**: Goes on employee or tenant table? Different employees might need different buffers.
- **Solo wizard had**: None / 15 / 30 / 45 / 60 min picker. DynaTire default: 30 min.
- **When to build**: When onboarding a mobile business that needs it.

### Zero-duration services (fee-only)
- **Decision**: Duration of 0 is a valid service entry (e.g., Tire Disposal, Environmental Fee). No time slot allocated.
- **Open question**: How does the booking engine handle zero-duration? Skip scheduling entirely? Just add to invoice?
- **When to build**: When a business needs it during onboarding.

### 8 industry categories (Financial Services, IT Services)
- **Decision**: Expand from 6 to 8 categories.
- **Blocker**: No templates exist for Financial Services or IT Services yet. Don't show empty categories.
- **When to build**: When the first financial or IT customer signs up, or when templates are ready.

### Enterprise tier ($1,200+/mo)
- **Decision**: Multi-location, white label, dedicated support. Not yet defined.
- **When to build**: When enterprise prospect appears. Don't build speculatively.

### Landing page
- **Design reference**: LandingPage.html from March 18 session. Dark industrial aesthetic, Bebas Neue / DM Sans fonts.
- **Contains**: Hero with live phone mockup, $126K missed call stat, competitor comparison, pricing cards, 8 categories.
- **When to build**: Before public launch. Separate project from the app.

### Sign-up page (6-step progressive reveal)
- **Design reference**: SignUpPage.html from March 18 session.
- **Flow**: Category → Type → Specialty → Size → Services → Account.
- **Routes to**: SoloWizard (team_size=1) or SetupWizard (team_size>1).
- **When to build**: After solo wizard and pricing are implemented.

---

## Source Files

All design references from the March 18 Claude web session are preserved at:
- `/mnt/c/Users/Dale/Downloads/MARCH_18_SESSION.zip` (HTML mockups + updated docs)
- `/mnt/c/Users/Dale/Downloads/CLAUDE_CODE_HANDOFF.md` (7,154-line master handoff)

The zip contains: LandingPage.html, SignUpPage.html, SoloWizard.html, SetupWizard.html, SESSION_AUDIT.md (35 action items, 18 open decisions).
