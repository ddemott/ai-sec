

---

## March 24, 2026 — Full Design Session Decisions

The following decisions were made during an extended design session between Dale and Claude (web interface). All decisions below supersede any conflicting entries above.

---

### Fonts: Bebas Neue + DM Sans — Universal, Locked
- Bebas Neue for all display/headers (page titles, stat numbers, logo, section headings)
- DM Sans for all body text, nav, labels, form fields
- Not swappable per business template — it's the SecretaryHQ brand
- All components must use `--font-display` and `--font-body` CSS variables

### Theme System: Add Font Variables, Dropdown Switcher
- Rebuild all 8 themes to include `--font-display` and `--font-body` alongside color variables
- Theme switcher must be a dropdown, not buttons (scales better, future-proofs custom themes)
- Custom theme creation planned for future: user picks base, adjusts accent, names it, saves it — appears in dropdown
- A soft rose/plum dark theme is planned for salon/spa verticals — same fonts, different palette

### Navigation: Keep Structure, Apply New Visual Style
- Keep existing Front Desk / Back Office two-tab layout exactly as-is
- Apply dark sidebar visual style from demo on top of existing structure
- No structural changes to navigation

### Sidebar Quick Book Button: Removed
- No Quick Book button in sidebar
- Replaced with "Go to Scheduler to book" navigation link
- Reason: can't book without seeing availability — double-booking risk

### Scheduler: Complete Redesign
See UI_UX_DESIGN.md for full spec. Summary:
- Rows = staff, columns = hours (flipped from original)
- Staff names in fixed left panel — always visible while scrolling horizontally
- Full 24-hour day, auto-scroll to 1hr before first appointment on load
- Business hours visually distinct (darker outside business hours, no labels)
- Zoom −/+ control in header
- Staff name click → read-only quick profile card (name, role, today's load, shift, skills as indented vertical list)
- Skills toggle (Hours | Skills mode) — replaces Coverage Map
- Drag to reorder rows — save/discard, default NOT saved on exit

### Coverage Map: Removed Entirely
- Removed from sidebar navigation
- Replaced by Skills toggle in Scheduler
- Reason: Gap analysis was patronizing, vague, and actionless. "50% covered" doesn't say which hours or what to do. Only the manager knows what's enough coverage. We show data, they decide.

### Detail Panel: Keep Existing Right-Side Pane
- Do not adopt floating bottom-right card from demo
- Keep List + Detail right-side pane (supports editing)
- Reskin to dark theme only

### Analytics: Rebuilt Around Real Business Questions
Old version was useless — numbers without context. New version:
- Call volume over time (marketing effectiveness signal — NOT vanity)
- Call to booking conversion by day and hour
- Busiest hours (calls in vs bookings made)
- Caller abandonment point (where do people hang up?)
- Return rate by first service
- No-show pattern by day

Deferred to Phase 2: staff request tracking, upsell attachment rate, AI call data (Vapi), revenue per customer lifetime.

### Two Demo Versions
- Public demo (landing page `/demo`): simple, impressive, 4 views
- Customer app (real dashboard): complete, all views, all functionality

### Logo: "Secretary HQ" (with space)

### General Philosophy (apply to all future decisions)
- We show data. They manage their business.
- No babysitting — don't tell them things they already know
- Managers are still needed to manage — we don't replace judgment
- Plain language everywhere — write for a tire shop owner, not a developer
