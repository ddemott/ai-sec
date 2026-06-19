/**
 * questionBank — single cross-runtime source of truth for the onboarding policy
 * question bank. Consumed by the Fastify backend (`../../shared/questionBank`
 * from `src/routes/`) for the website-import extractor and by the Next.js
 * dashboard (`../../shared/questionBank` from `dashboard/lib/`) for the setup
 * wizard + Knowledge Base view.
 *
 * Moved here 2026-06-19 from `dashboard/lib/policyQuestions.ts` to kill a brittle
 * cross-package runtime import (`import('../../dashboard/lib/policyQuestions.js')`)
 * the backend used to depend on. `/shared` is the designed home for pure modules
 * imported from both runtimes (see CLAUDE.md "Key Directories").
 */

export interface PolicyQuestion {
  id: string;
  question: string;
  placeholder: string;
  category: string;
}

export const POLICY_CATEGORIES: string[] = [
  'Business Hours & Location',
  'Services & Pricing',
  'Scheduling & Appointments',
  'Cancellation & Rescheduling',
  'Payment & Billing',
  'Your Guarantee',
  'Before Your Visit',
  'Discounts & Promotions',
  'Emergency & After-Hours',
];

export const POLICY_QUESTIONS: PolicyQuestion[] = [
  // ── Business Hours & Location ──────────────────────────────────────
  {
    id: 'hours-of-operation',
    question: 'What are your hours of operation?',
    placeholder:
      "We're open Monday through Friday, 8 AM to 6 PM, and Saturday 9 AM to 3 PM. We're closed on Sundays.",
    category: 'Business Hours & Location',
  },
  {
    id: 'holiday-hours',
    question: 'Are you open on holidays?',
    placeholder:
      "We're closed on major holidays like Thanksgiving and Christmas. We may have reduced hours around other holidays — give us a call the week before to confirm.",
    category: 'Business Hours & Location',
  },
  {
    id: 'business-location',
    question: 'Where are you located?',
    placeholder:
      "We're at 1234 Main Street, Suite B, right next to the post office. There's a large sign out front — you can't miss us.",
    category: 'Business Hours & Location',
  },
  {
    id: 'parking-availability',
    question: 'Is there parking available?',
    placeholder:
      "Yes, we have a free parking lot right in front of the building. There's also street parking if the lot is full.",
    category: 'Business Hours & Location',
  },
  {
    id: 'walk-ins-accepted',
    question: 'Do you accept walk-ins?',
    placeholder:
      'We do accept walk-ins on a first-come, first-served basis, but appointments always get priority. We recommend booking ahead if you can.',
    category: 'Business Hours & Location',
  },
  {
    id: 'multiple-locations',
    question: 'Do you have other locations?',
    placeholder: 'We have just the one location right now, but we serve the entire metro area.',
    category: 'Business Hours & Location',
  },

  // ── Services & Pricing ─────────────────────────────────────────────
  {
    id: 'services-offered',
    question: 'What services do you offer?',
    placeholder:
      "We offer a full range of services including oil changes, tire rotations, brake work, and full inspections. Let us know what you need and we'll point you in the right direction.",
    category: 'Services & Pricing',
  },
  {
    id: 'service-pricing',
    question: 'How much does a typical service cost?',
    placeholder:
      'Pricing depends on the service. For example, a standard oil change starts at $45 and a full brake job runs $250 to $400 per axle. We always give you a quote before we start any work.',
    category: 'Services & Pricing',
  },
  {
    id: 'free-estimates',
    question: 'Do you provide free estimates?',
    placeholder:
      "Yes, we offer free estimates on most jobs. Just bring it in or describe the issue over the phone and we'll give you a ballpark.",
    category: 'Services & Pricing',
  },
  {
    id: 'service-duration',
    question: 'How long does a typical appointment take?',
    placeholder:
      "Most standard services take 30 minutes to an hour. Larger jobs like a full brake replacement can take a few hours. We'll give you a time estimate when you book.",
    category: 'Services & Pricing',
  },
  {
    id: 'custom-requests',
    question: 'Can you handle special or custom requests?',
    placeholder:
      "Absolutely. If you have something specific in mind, just let us know when you call or book and we'll see what we can do.",
    category: 'Services & Pricing',
  },
  {
    id: 'parts-and-materials',
    question: 'Do you use OEM or aftermarket parts?',
    placeholder:
      "We typically use high-quality aftermarket parts that meet or exceed OEM specs. If you prefer genuine OEM parts, just let us know and we'll order them in.",
    category: 'Services & Pricing',
  },

  // ── Scheduling & Appointments ──────────────────────────────────────
  {
    id: 'how-to-book',
    question: 'How do I schedule an appointment?',
    placeholder:
      "You can book over the phone, or just tell us what you need right now and we'll get you on the schedule.",
    category: 'Scheduling & Appointments',
  },
  {
    id: 'earliest-availability',
    question: "What's your earliest availability?",
    placeholder:
      "We usually have openings within 1 to 2 business days. For something urgent, we'll do our best to fit you in sooner.",
    category: 'Scheduling & Appointments',
  },
  {
    id: 'appointment-confirmation',
    question: 'Will I receive an appointment confirmation?',
    placeholder:
      "Yes, we'll send you a confirmation by text or email as soon as your appointment is booked.",
    category: 'Scheduling & Appointments',
  },
  {
    id: 'drop-off-service',
    question: 'Can I drop off my vehicle or equipment early?',
    placeholder:
      "Yes, early drop-offs are welcome. Just let us know ahead of time and we'll work on it as soon as your appointment slot opens up.",
    category: 'Scheduling & Appointments',
  },
  {
    id: 'wait-during-service',
    question: 'Can I wait while my service is being done?',
    placeholder:
      'Of course. We have a comfortable waiting area with Wi-Fi and coffee. Most standard services take under an hour.',
    category: 'Scheduling & Appointments',
  },

  // ── Cancellation & Rescheduling ────────────────────────────────────
  {
    id: 'cancellation-policy',
    question: 'What is your cancellation policy?',
    placeholder:
      "We ask for at least 24 hours' notice if you need to cancel. This helps us keep the schedule open for other customers.",
    category: 'Cancellation & Rescheduling',
  },
  {
    id: 'reschedule-appointment',
    question: 'How do I reschedule my appointment?',
    placeholder:
      "Just give us a call and we'll move you to a time that works better. No charge for rescheduling.",
    category: 'Cancellation & Rescheduling',
  },
  {
    id: 'late-arrival',
    question: "What happens if I'm running late?",
    placeholder:
      "Give us a call to let us know. If it's just a few minutes, no problem. If it's longer, we may need to adjust your time slot.",
    category: 'Cancellation & Rescheduling',
  },
  {
    id: 'no-show-policy',
    question: 'Is there a fee for no-shows?',
    placeholder:
      "We don't charge a no-show fee, but repeated no-shows may affect your ability to book future appointments. We just ask that you let us know if plans change.",
    category: 'Cancellation & Rescheduling',
  },

  // ── Payment & Billing ──────────────────────────────────────────────
  {
    id: 'accepted-payment-methods',
    question: 'What payment methods do you accept?',
    placeholder:
      "We accept cash, all major credit and debit cards, and Apple Pay. We don't currently accept checks.",
    category: 'Payment & Billing',
  },
  {
    id: 'payment-due',
    question: 'When is payment due?',
    placeholder:
      "Payment is due at the time of service, once the work is complete and you've had a chance to review everything.",
    category: 'Payment & Billing',
  },
  {
    id: 'payment-plans',
    question: 'Do you offer payment plans or financing?',
    placeholder:
      "We don't offer in-house financing, but we do accept most major credit cards if you'd like to spread the cost out that way.",
    category: 'Payment & Billing',
  },
  {
    id: 'deposit-required',
    question: 'Do you require a deposit to book?',
    placeholder:
      'No deposit is needed for standard appointments. For large custom jobs, we may ask for a small deposit to secure parts.',
    category: 'Payment & Billing',
  },
  {
    id: 'invoices-and-receipts',
    question: 'Can I get an invoice or receipt?',
    placeholder:
      'Absolutely. We provide a detailed receipt after every service and can email you an invoice if you need one for your records.',
    category: 'Payment & Billing',
  },

  // ── Your Guarantee ────────────────────────────────────────
  {
    id: 'service-warranty',
    question: 'Do you offer a warranty on your work?',
    placeholder:
      "Yes, all our work comes with a 12-month or 12,000-mile warranty, whichever comes first. If something isn't right, bring it back and we'll make it right.",
    category: 'Your Guarantee',
  },
  {
    id: 'satisfaction-guarantee',
    question: "What if I'm not satisfied with the service?",
    placeholder:
      "Your satisfaction is our priority. If something doesn't meet your expectations, let us know right away and we'll address it at no extra charge.",
    category: 'Your Guarantee',
  },
  {
    id: 'parts-warranty',
    question: 'Are parts covered under warranty?',
    placeholder:
      "Yes, parts we install carry the manufacturer's warranty. We'll handle the replacement if a part fails within the warranty period.",
    category: 'Your Guarantee',
  },
  {
    id: 'warranty-claim-process',
    question: 'How do I make a warranty claim?',
    placeholder:
      'Just give us a call or bring it back in. We keep records of all services, so we can look up your history and take care of it quickly.',
    category: 'Your Guarantee',
  },

  // ── Before Your Visit ───────────────────────────────────
  {
    id: 'what-to-bring',
    question: 'What should I bring to my appointment?',
    placeholder:
      "Just bring your vehicle and any relevant paperwork, like a warranty card or previous service records. We'll take care of the rest.",
    category: 'Before Your Visit',
  },
  {
    id: 'pre-appointment-prep',
    question: 'Is there anything I need to do before my appointment?',
    placeholder:
      "No special prep needed. Just make sure the area we'll be working on is accessible. If anything changes before your visit, give us a heads up.",
    category: 'Before Your Visit',
  },
  {
    id: 'what-to-expect-during',
    question: 'What should I expect during my visit?',
    placeholder:
      "When you arrive, we'll check you in, review the work to be done, and give you a time estimate. We'll contact you if anything comes up during the service.",
    category: 'Before Your Visit',
  },
  {
    id: 'post-service-care',
    question: 'Is there anything I should do after the service?',
    placeholder:
      "We'll walk you through any follow-up care or next steps before you leave. For most services, you're good to go right away.",
    category: 'Before Your Visit',
  },

  // ── Discounts & Promotions ─────────────────────────────────────────
  {
    id: 'current-promotions',
    question: 'Do you have any current promotions?',
    placeholder:
      "We run seasonal specials throughout the year. Right now we're offering 10% off your first visit. Ask us about current deals when you book.",
    category: 'Discounts & Promotions',
  },
  {
    id: 'loyalty-program',
    question: 'Do you have a loyalty or rewards program?',
    placeholder:
      "We do! After every 5 visits, you get 15% off your next service. We track it automatically so you don't have to keep up with anything.",
    category: 'Discounts & Promotions',
  },
  {
    id: 'senior-military-discount',
    question: 'Do you offer senior, military, or first responder discounts?',
    placeholder:
      'Yes, we offer a 10% discount for seniors, active military, veterans, and first responders. Just let us know when you check in.',
    category: 'Discounts & Promotions',
  },

  // ── Emergency & After-Hours ────────────────────────────────────────
  {
    id: 'emergency-services',
    question: 'Do you offer emergency or same-day service?',
    placeholder:
      "We do our best to accommodate emergencies. Call us and we'll try to fit you in the same day, or first thing the next morning.",
    category: 'Emergency & After-Hours',
  },
  {
    id: 'after-hours-contact',
    question: 'How can I reach you after hours?',
    placeholder:
      "You can leave a voicemail any time and we'll get back to you first thing in the morning. For true emergencies, our answering service can reach the on-call technician.",
    category: 'Emergency & After-Hours',
  },
  {
    id: 'roadside-assistance',
    question: 'Do you offer roadside assistance or mobile service?',
    placeholder:
      "We don't offer roadside assistance directly, but we can recommend a trusted towing service that can bring your vehicle to us.",
    category: 'Emergency & After-Hours',
  },
];

/**
 * A question the website-import extractor should try to answer. `id` is the
 * static-bank id, or `null` for an owner-authored custom question (which has no
 * `question_bank` id — stored as a discovered suggestion when matched).
 */
export interface ResolvedQuestion {
  id: string | null;
  question: string;
}

/**
 * Resolve the full set of questions the website-import extractor should target:
 * the static policy bank plus any owner-authored custom questions, deduped by
 * normalized question text (a custom question that restates a bank question is
 * dropped in favor of the bank entry).
 *
 * `business_type` filtering is intentionally NOT applied: all nine categories
 * (hours, pricing, scheduling, cancellation, payment, guarantee, before-visit,
 * discounts, emergency) are universal across every supported vertical, so a
 * per-vertical tag would filter nothing. Add filtering only when a real vertical
 * needs a question another vertical must not see (see docs/TODO.md).
 */
export function resolveQuestions(opts?: { customs?: string[] }): ResolvedQuestion[] {
  const base: ResolvedQuestion[] = POLICY_QUESTIONS.map((q) => ({
    id: q.id,
    question: q.question,
  }));
  const seen = new Set(base.map((q) => q.question.trim().toLowerCase()));
  const customs: ResolvedQuestion[] = [];
  for (const raw of opts?.customs ?? []) {
    const q = (raw ?? '').trim();
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    customs.push({ id: null, question: q });
  }
  return [...base, ...customs];
}
