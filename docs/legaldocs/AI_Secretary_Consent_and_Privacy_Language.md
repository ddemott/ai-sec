# AI Secretary — Consent & Privacy Language (Draft for Counsel Review)

> **Not legal advice.** This is working copy designed to be internally consistent and to follow common practice. The final wording — especially anything touching Illinois BIPA, multi-state recording consent, and model-training reuse — needs a one-time pass from a tech/startup attorney before launch.

---

## How the consent fits together

There are two parties who consent to two different things:

- **Your business customer** (the salon, clinic, shop) consents **in writing, in the SetupWizard.** They agree to your Terms, and they take on the obligation to inform their own callers — because legally *they* are the ones whose callers are being notified. AI Secretary supplies the disclosure mechanism.
- **The end caller** consents **by spoken notice + continuing the call.** That's the implied-consent model.

Your job is to make both layers say the same thing. The doc below does that.

---

## 1. Spoken caller disclosure (the line the AI says)

**Default — recommended (not recording for training):**

> "Thanks for calling [Business Name] — I'm an AI assistant, and I can book appointments or answer a few questions. How can I help you today?"

**If recording is enabled (operational / quality only):**

> "Thanks for calling [Business Name]. I'm an AI assistant, and this call may be recorded for quality and service. To continue, just stay on the line — how can I help you today?"

Rules that make this hold up:
- Recording must **not start until after this line finishes.** Gate it in the pipeline.
- Purpose is **"quality and service,"** never "AI training."
- "Stay on the line" is the consent trigger. If you build a non-recorded fallback (voicemail or your out-of-scope routing), you can offer a real opt-out, which strengthens consent — but only promise it if it exists.

---

## 2. Signup consent — SetupWizard (your business customer)

### A. Core service consent — REQUIRED (checkbox, must be ticked to proceed)

> ☐ I'm authorized to set up AI Secretary for **[Business Name]**, and I agree to the [Terms of Service] and [Data Processing Addendum]. I understand AI Secretary answers calls on my business's behalf as an **AI assistant**, and transcribes and processes those calls to book appointments and answer questions. I am responsible for informing my callers as required by the laws of the states where my business and its callers are located, and I will use the caller disclosure AI Secretary provides for this purpose.

### B. Call recording — OPTIONAL (only if you offer recording; default OFF)

> ☐ Record calls for quality and service. Calls handled by AI Secretary will be recorded and retained for **[30 / 60 / 90]** days, then deleted. Callers are notified before recording begins by the spoken disclosure. You can turn this off anytime in Settings.

### C. Product improvement / training — OPTIONAL, OPT-IN (default OFF; consider omitting at launch)

> ☐ *(Optional)* Allow **de-identified call transcripts** to help improve AI Secretary. **Off by default.** We do not use your call data to train or improve our models unless you turn this on, and we use **text transcripts only — never voiceprints or voice recordings** for this purpose. Additional consent requirements may apply for businesses or callers in Illinois and certain other states; see the Privacy Notice.

> **My steer:** ship without C entirely. It's the one thing that turns a simple disclosure into a biometric-consent question, and you don't need it to launch a working receptionist. Add it later as a deliberate feature with the lawyer's wording. Keeping training to **de-identified text transcripts only** (never voice/biometric) is what keeps it out of BIPA's lane if you do add it.

---

## 3. Privacy notice — call-handling section (template)

Goes in your published Privacy Policy and is what the spoken line / your customer's notice points callers to.

> ### AI call handling
> When you call a business that uses AI Secretary, your call is answered by an **AI assistant** that books appointments and answers questions on that business's behalf.
>
> **What we process:** the contents of the call (converted to text), and the contact and appointment details you provide.
>
> **Why:** to provide the service — answer your call, book or change appointments, and pass messages to the business.
>
> **Recording:** where a business enables recording, calls are recorded **only after you are notified** at the start of the call, and you consent by continuing. Recordings are retained for **[retention period]** and then deleted.
>
> **Service providers:** we use telecommunications and AI service providers to route and process calls on our behalf under contract. They process call data only to provide the service.
>
> **Model training:** we do **not** use your call data to train or improve AI models unless the business has separately opted in, and in that case we use **de-identified text transcripts only**.
>
> **Your choices:** to request access to or deletion of information about you, contact **[privacy@thinkinghammer.com]**.

---

## 4. Decisions you still owe yourself before this is final

1. **Recording: yes or no at launch?** No = the simplest, safest posture (use script + consent block A only). Yes = add block B and set a retention period.
2. **Training: in or out at launch?** Recommend out. If in, keep it de-identified text only and get the BIPA wording reviewed.
3. **Which privacy policy does the caller get pointed to** — yours, your customer's, or both? Decide so the spoken line's "see our privacy policy" actually resolves.
4. **Counsel pass** on: BIPA (Illinois biometric), the strictest applicable all-party recording state, the DPA, and the final ToS liability/limitation language.

---

*Fill the brackets, pick your options in section 4, and this set stays internally consistent. The attorney edits the final phrasing — particularly anything in the signup consent and the BIPA-adjacent language — but you walk in with a coherent draft instead of a blank page.*
