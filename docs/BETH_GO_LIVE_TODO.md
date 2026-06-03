# Beth Go-Live — Resume Checklist

Last worked: 2026-06-02 (night). Owner: Dale. Claude walks you through each step.

**Goal:** Beth answers real calls on `+1 630-866-1960` for Thinking Hammer LLC
(tenant `d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0`).

---

## DONE (verified)

- [x] Beth persona + booking model + 19 KB docs seeded on tenant d5e3c6a1 (prod DB).
- [x] Telnyx account funded ($10) + upgraded (trial 1-order cap lifted).
- [x] Number **`+1 630-866-1960`** purchased. Resource id `2973794140900296302`. Status: active.
- [x] Number routed to Telnyx SIP connection **`livekit-outbound`** (`2945038451784812111`).
- [x] That connection activated (was `active:false`).

---

## TODO — to finish go-live (in order)

### 1. Get valid LiveKit API creds  ← THE ONE BLOCKER
Local `.env` LiveKit key (`APIUX…kk`) is **dead** — rotated when Railway was set up.
Both RoomService + SIP calls return `401 invalid API key`. Need the live pair.

**You do ONE of these (browser-gated, Claude can't):**
- **A:** Run `! railway login` in session. Then Claude runs `railway link`
  (project **joyful-spontaneity** → service **ai-sec-agent**) + pulls
  `railway variables --service ai-sec-agent --kv | grep LIVEKIT`.
- **B:** LiveKit Cloud → project `ai-secretary-nmlkkmgf` → Settings → Keys →
  Create Key. Put key+secret into `.env` lines 24–25 yourself.

**Then Claude:** syncs `.env`, verifies with a `listRooms()` call.

### 2. Wire the LiveKit inbound trunk  (Claude, via livekit-server-sdk)
- Inbound trunk currently lists the OLD number `+16309379478`. Update/replace its
  `numbers` to **`+16308661960`** (or create a fresh inbound trunk if cleaner).
- Confirm dispatch rule routes trunk → agent `ai-secretary-agent` with
  metadata tenant `d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0`.

### 3. Write tenant phone fields (Claude, prod DB)
```sql
UPDATE tenants SET
  inbound_phone = '+16308661960',
  phone_status  = 'active',
  telnyx_phone_number_id = '2973794140900296302'
WHERE tenant_id = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';
```

### 4. Confirm agent worker is up (Railway `ai-sec-agent`)
- Worker must be running + registered with agent name `ai-secretary-agent`.
- Check Railway logs show the worker connected to LiveKit.

### 5. LIVE TEST — call `+1 630-866-1960`
- Beth should greet (name + recording notice + 3-path question).
- Walk each path: personal / programming / SecretaryHQ.
- Try a real booking → confirm row lands in `appointments` for tenant d5e3c6a1
  inside Dale's Mon–Fri 1–5pm window (out-of-window should reject).

---

## PHASE 2 — after live (separate work, needs agent code + redeploy)

- [ ] Recording disclaimer → deterministic verbatim greeting (Illinois 2-party
      consent). Needs `tenants.greeting` column + tenant-config route +
      `tenantConfig.ts` + `agent/src/index.ts` greeting line (currently hardcoded
      "Thanks for calling…").
- [ ] Personal-call transfer tool → Dale's cell, via
      `livekit-server-sdk` TransferSipParticipant. Depends on Telnyx outbound PSTN
      (now that account is upgraded, may work — untested). v1 fallback: Beth books
      a callback / takes a message.

---

## Side items (not blocking)

- [ ] Review the 1 pending improvement proposal: `/improve` → "Wizard pre-fill
      from business template" (a/r/s).
- [ ] Correct stale note: old SIP connection id `2973577228794726874` in earlier
      memory does NOT exist. Real LiveKit connection = `2945038451784812111`.
