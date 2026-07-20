# Client Onboarding Runbook

The exact order of operations to take a new client from "signed up" to "their AI answers the phone" — and the cleanup tools around it. Every destructive script here is **dry-run by default** and refuses non-local databases without `--force`.

## The scripts at a glance

| Script                  | What it does                                                                                                                      | Safety                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `onboard-tenant.ts`     | Tenant + secured owner login (+ optional voice preset) in one shot                                                                | Local-only guard; temp password printed once |
| `setup-voice-script.ts` | Install a business-type voice script preset (`--list` to see them)                                                                | Diffs + prints what it replaces; `--dry-run` |
| `install-script.ts`     | Fully bespoke voice script from a JSON composition                                                                                | Same diff behavior                           |
| `remove-customer.ts`    | Remove ONE customer + everything of theirs                                                                                        | Dry-run default; `--execute --yes` to act    |
| `clear-call-data.ts`    | Wipe ALL transactional data (customers, appointments, calls, audit trails) leaving the business shape intact; `--tenant` to scope | Dry-run default; `--execute --yes` to act    |
| `purge-soft-deleted.ts` | Hard-destroy soft-deleted tenants (maintenance window act)                                                                        | Dry-run default                              |

## Onboarding a client, step by step

### 1. Create the tenant + owner login

```bash
npx tsx scripts/onboard-tenant.ts \
  --name "Bella's Hair Studio" --type salon \
  --owner-email bella@bellashair.com --owner-name "Bella Ramos" \
  --owner-phone "+16305551234" \
  --voice-preset salon --assistant-name Bella
```

This prints a **one-time temporary password**. Security rules baked into the flow:

- Deliver the temp password over a trusted channel (phone/in person — not email).
- The owner changes it at first login. Sessions expire after 8h; changing the password invalidates old tokens.
- Staff never share the owner login — invite them from **Setup → Team Access** with role `front_desk` (they see only Home/Schedule/Customers/Calls).
- Tenant isolation is middleware-enforced; there is nothing per-client to configure.

### 2. Business shape — run the Setup Wizard WITH the owner

Log in as the owner and walk the dashboard **Setup Wizard**. It seeds services/resources from the business-type template, collects staff and working days, and expands the weekly schedule. Don't script around it — the wizard is the product's onboarding UX and asking the vertical's questions with the client in the room is where you catch the "oh, we also do X" surprises.

### 3. Voice script (if not done in step 1)

```bash
npx tsx scripts/setup-voice-script.ts --list                       # see presets
npx tsx scripts/setup-voice-script.ts --tenant <id> --type salon   # install
```

Presets: `staffing` (real intake block, capture_job_inquiry), `automotive`, `auto_bays`, `mobile_tire`, `salon` (vertical intake questions), `generic` (booking + messages only). A business that fits none of them gets a JSON composition via `install-script.ts` — the universal rungs are never rewritten, only persona + intake.

### 4. Teach the AI + pick the voice

- **Phone Assistant → Knowledge Base**: website scan / FAQ upload / Teach-Your-AI questionnaire.
- **Phone Assistant → AI Persona**: voice (6 options), speed, style toggles, greeting, caller disclosure (attestation-gated).
- If ANY TTS setting changes at the engine level: `cd agent && npm run verify:tts` is **mandatory** before prod ("it compiles" ≠ "it makes noise").

### 5. Verify before go-live (no phone needed)

```bash
./scripts/simulate.sh status --env local      # systems up
./scripts/simulate.sh tools                   # agent-tools journey works
./scripts/simulate.sh toolselect              # LLM picks the right tools
./scripts/simulate.sh call --tenant <id>      # talk to it in a browser with a mic
```

### 6. Go-live

- Provision their number: `POST /provisioning/activate` (search → purchase → assign to SIP connection).
- Make a **real PSTN test call** from a different carrier before handing over.
- Billing: attach Stripe from the Billing sub-tab when they subscribe.
- SMS stays **off** until that tenant's own 10DLC brand+campaign is registered (per-tenant legal name/EIN/address; ~$12-13/mo; 1–3 business days). Until then the agent makes no texting promises — don't either.

## Cleanup tools

```bash
# Reset the whole (local) system to just-set-up: keeps tenants/users/staff/services/shifts/KB,
# removes customers, appointments, calls, messages, reminders, and audit trails.
npx tsx scripts/clear-call-data.ts                    # dry run
npx tsx scripts/clear-call-data.ts --execute --yes    # do it
npx tsx scripts/clear-call-data.ts --tenant <id> --execute --yes   # one tenant only

# Remove a single customer and everything of theirs
npx tsx scripts/remove-customer.ts --tenant <id> --phone "(630) 555-1234"   # dry run
npx tsx scripts/remove-customer.ts --customer <uuid> --execute --yes
```

Note on `remove-customer.ts` vs the legal-hold purge: PR #68 (`POST /customers/:id/purge`) is the **product** GDPR-erasure feature and stays unmerged pending owner + legal sign-off. `remove-customer.ts` is a manual operator tool in the `purge-soft-deleted.ts` tradition — destruction as a deliberate human act with the blast radius shown first. Aiming it at production for a real erasure request is a human decision made with legal context.
