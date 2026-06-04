# Thinking Hammer LLC — Business, Tax & Compliance Setup Summary

> **Not legal or tax advice.** This is a planning summary capturing decisions and open items for the formation and launch of Thinking Hammer LLC (entity for AI Secretary). Items flagged for **counsel** or **CPA** should be confirmed with a licensed professional before you rely on them.

*Prepared: June 2026 · Jurisdiction: Illinois*

---

## 1. Entity decision

- **Entity:** Thinking Hammer LLC — a **standard** (not series) LLC, formed in Illinois.
- **Why standard, not series:** In Illinois the series structure costs *more* up front ($550 vs $450 for three entities) and the same to maintain ($75 + $50/series annually), so it offers no cost advantage here. It also creates friction against the goal of selling products individually — acquirers and investors prefer clean standalone entities, inter-series liability is less court-tested, and out-of-state recognition is inconsistent. Each future product gets its own separate standard LLC.
- **Management:** member-managed (solo owner).
- **Registered agent:** self, at 331 Ridley St, North Aurora, IL 60542. *(Note: this address becomes public record — a commercial registered agent ~$100–150/yr is the privacy alternative if that matters.)*

---

## 2. Formation checklist

1. **File Articles of Organization (Form LLC-5.5)** through the Illinois SOS online portal (ilsos.gov → Business Services → LLC). Select **"standard."** Fee **$150**. Keep purpose as the default "all lawful business" and add no custom provisions — a specific purpose or custom provisions forces a slower mail filing. Duration: leave perpetual.
   - Processing ~5–10 business days online; +$100 for 1–2 day expedited.
2. **BOI / FinCEN: nothing to file.** Under the March 2025 interim rule (still in effect), domestic US entities are exempt from beneficial-ownership reporting. *(Interim rule — re-check before filing in case it flips.)*
3. **Get an EIN** from the IRS — free, instant, at irs.gov. Don't pay a third-party site.
4. **Sign the Operating Agreement** (companion .docx) *after* the Articles are approved, since it ratifies the filing. Internal document — never filed with the state or anyone else; produced only when a bank/lawyer/investor/court asks.
5. **Open a dedicated business bank account.** Non-negotiable: commingling personal and business funds is the fastest way to pierce the liability shield. Keep funds fully separate from day one.
6. **Bookkeeping from day one** (QuickBooks/Xero) so the CPA inherits clean books.

**Ongoing:** annual report, **$75**, due by the first day of the formation-anniversary month.

---

## 3. Tax structure & roadmap

- **Now:** single-member LLC is a **disregarded entity** — business income flows to personal return. All net profit is subject to ~15.3% self-employment tax.
- **Later — S-corp election:** "S-corp" is a **tax election, not an entity.** You stay an LLC and file **IRS Form 2553** to be taxed as an S-corp. No re-forming.
- **Why/when:** savings come from the gap between **net profit and a reasonable salary** — you pay yourself a defensible salary (payroll-taxed) and take the rest as distributions (not SE-taxed). It only pays once that gap × ~15.3% beats the added overhead (payroll service, Form 1120-S, more bookkeeping). Rough crossover lands in the neighborhood of ~$60K **profit** (not revenue), but it's driven by the salary gap, not a fixed threshold. **[CPA decision]**
- **Reasonable salary** is the audit-risk piece — set it with the CPA, not a blog post.
- **Quarterly estimated taxes:** once profitable you owe estimated federal + Illinois tax quarterly; missing them triggers underpayment penalties. **[CPA]**

---

## 4. Sales tax

- SaaS sales-tax obligations begin only once you cross a state's **economic nexus** threshold (real multi-state revenue) — not at launch.
- **§174 software-cost trap is lifted:** under OBBBA / new §174A, domestic software-development costs are immediately expensable again for tax years beginning after Dec 31, 2024 (the 2022–2024 5-year-amortization trap is gone for domestic R&E). **[CPA confirm for your situation]**
- **Tooling:** **Stripe Tax** is the default — it's a toggle inside your existing Stripe billing, handles calculation/collection/nexus-monitoring, leaves registration (manual) and filing (via partners) to you. Single-channel SaaS = its nexus tracking is complete. **Anrok** (SaaS-specific, end-to-end registration+filing+remittance, correct SaaS taxability by state) is the upgrade if multi-state filing becomes a burden.
- **Turn Stripe Tax on with your first real charge**, not later — enabling it after billing for a while creates a historical-liability gap.
- The **CPA handles judgment** (is the product taxable in a given state, exemption certs, historical exposure); the **tool handles mechanics**.

---

## 5. Liability & compliance layer (the blind-side prevention)

This is where a product that speaks to the public for other businesses is most exposed. **Most of this is a one-time tech/startup attorney consult.**

- **Tech E&O / professional liability + cyber insurance** — highest priority. When the AI mis-books or gives a wrong answer and a client business loses money, or data leaks, it lands on you. General liability alone doesn't cover this.
- **Terms of Service + Privacy Policy that limit liability** — disclaim responsibility for AI errors, cap damages, disclose data handling, pass through vendor (Telnyx/LiveKit/LLM) outages. The other half of the E&O shield.
- **Call-recording consent** — Illinois is an **all-party consent** state, and callers are nationwide, so the strictest applicable state governs. Recording/transcription and routing audio through third-party vendors can implicate eavesdropping/wiretap law. See companion consent doc.
- **Illinois BIPA** — voiceprints can be biometric identifiers requiring **written** consent + retention policy, with per-violation statutory damages and aggressive litigation. Keep any model-training to **de-identified text transcripts only** to stay clear of it. **[Counsel]**
- **TCPA / outbound calling** — attaches only if the agent calls *out* (confirmations, callbacks). Inbound-only is much lower risk.
- **Data Processing Agreements (DPAs)** — business customers (esp. higher tiers) may require a signed DPA; you're a processor of their callers' data.
- **Local:** check for any North Aurora / Kane County home-business license; register with IDOR when you start collecting IL sales tax.

---

## 6. Voice-product consent & disclosure (summary)

Full language is in the companion doc **"AI Secretary — Consent & Privacy Language."** Key decisions captured there:

- **Recommended launch posture:** record **off**, training **off.** A spoken AI disclosure + the required core consent checkbox is a complete, defensible setup for a working receptionist, with the fewest legal rocks.
- Spoken line discloses the AI and (if recording) says **"quality and service,"** never "AI training." Recording must start only *after* the line plays.
- Consents are **unbundled** (core required / recording optional / training optional, opt-in, default off) — granular opt-in holds up better than blanket consent.
- The business customer carries the **caller-notification obligation**; Thinking Hammer supplies the **disclosure mechanism**. Correct processor split.

---

## 7. Open decisions

1. Record calls at launch — **yes/no** (recommend no). If yes, set retention period.
2. Train on call data at launch — **yes/no** (recommend no). If yes, de-identified text only, with reviewed BIPA wording.
3. Which privacy policy the caller is referred to — yours, the customer's, or both.
4. Commercial registered agent vs. self (privacy of home address).
5. Trademark: clear the name on the Illinois SOS database before filing; separate USPTO search if you want to protect the mark later.

---

## 8. Advisors & what each covers

- **CPA** (tax layer): S-corp timing & reasonable salary, quarterly estimates, §174 treatment, sales-tax judgment, clean books. *Note: a consulting-focused CPA can handle all of this; the only SaaS-specific gap is sales-tax nexus, which is increasingly handled by software (Stripe Tax/Anrok) anyway.*
- **Tech/startup attorney** (liability layer): ToS + Privacy Policy, E&O/insurance posture, recording-consent wording, BIPA, DPA, final consent language.

---

## Documents in this set

1. **Thinking_Hammer_LLC_Setup_Summary.md** — this file.
2. **AI_Secretary_Consent_and_Privacy_Language.md** — spoken script, signup-consent checkboxes, privacy-notice section.
3. **Thinking_Hammer_LLC_Operating_Agreement.docx** — sign-able operating agreement (fill brackets; sign after Articles are approved).

---

*This summary reflects general information as of June 2026 and decisions made during planning. It is a starting map, not a substitute for the CPA and attorney passes noted throughout.*
