/**
 * RUNG 3 — MEETING GOALS: the context a meeting needs, chosen by TEMPLATE.
 *
 * The shape of a call is the same in every business; WHAT THE MEETING NEEDS ATTACHED TO
 * IT is the part that varies (exactly the lesson of the composed script blocks, where
 * INTAKE is "the only part that varies by vertical"). So rung 3 is not "the job rung" —
 * it is the meeting-context rung, and JOB is its first template:
 *
 *   'job'     — the staffing intake (jobIntakeTask): two companies, rate, duration,
 *               location. Records a structured job_inquiries row, linked to the meeting
 *               it was booked around, and stamps a summary onto the calendar entry.
 *   'default' — every other meeting: ONE light wrap-up question ("anything you'd like
 *               noted ahead of the meeting?"), attached to the appointment when the
 *               caller has something, skipped silently when they don't.
 *
 * A future vertical (fixing a car, a fitness consult) is a NEW TEMPLATE here, not a new
 * rung — the plan keeps its shape and the template carries the questions. Per the
 * build-for-real-customers rule, templates are added when a real tenant names the need;
 * 'job' is the only vertical any real tenant uses (2026-07-16).
 */
import { voice, type llm } from '@livekit/agents';
import { makeRung, idExtractor, type RungCompletion } from './rung.js';
import { makeJobIntakeRung, type JobIntakeResult } from './jobIntakeTask.js';

export type MeetingContextTemplate = 'job' | 'default';

export interface MeetingNotesResult {
  /** 'notes' when a note was attached to the meeting; 'none' when the caller had nothing
   *  to add; 'message' when the attach could not happen and a message was recorded
   *  instead; 'skipped' when there was no booked meeting to attach anything to (the
   *  booking rung fell back to a message), decided in HOST CODE without a spoken turn. */
  outcome: 'notes' | 'none' | 'message' | 'skipped';
  appointmentId?: string;
  messageId?: string;
  raw?: unknown;
}

export interface MeetingContextOptions {
  template: MeetingContextTemplate;
  /** Must include capture_job_inquiry when template is 'job'. */
  messagingTools: llm.ToolContext;
  /** attach_meeting_notes from buildTools() — the default template's write. */
  notesTool?: llm.ToolContext[string];
  /** take_message — the fallback when a note cannot be attached (mirrors the booking
   *  rung's fallback: an offer to "pass it along" must always have a write behind it). */
  takeMessage?: llm.ToolContext[string];
  /** Whether a meeting ACTUALLY landed on this call — read from CallState at factory
   *  time (the factory runs after the booking rung), NOT from the caller's stated goal.
   *  A booking that fell back to a message books nothing, and the opener must not
   *  pretend otherwise. */
  meetingBooked: boolean;
  knownCaller?: string;
  knownName?: string;
  onCaptured?: (r: JobIntakeResult) => Promise<void> | void;
  onMessageTaken?: (r: { messageId: string; raw: unknown }) => Promise<void> | void;
}

export const MEETING_NOTES_INSTRUCTIONS = `The meeting is booked. Your VERY NEXT action is to ASK — out loud, before any tool call: "Before I let you go — anything you'd like us to know ahead of the meeting?"

attach_meeting_notes may only run AFTER the caller has ANSWERED that question. A note attached before they answer is a note you INVENTED — that is how "consulting work discussion" (a topic label the caller never spoke) reached a real calendar. The note is what THEY said in their answer — their words from this call, not your summary and not a topic label.

- If they give you something, look at WHAT it is before you act:
  1. Their answer only POINTS AT a concrete thing they have not actually spoken — "he'll need my address" contains no address, "I'll give you the gate code" contains no code, "call my other number" contains no number. Then your VERY NEXT action is to ASK FOR THE THING ITSELF — "Sure — what's the address?" — and the answer THEY give is the note. (This one follow-up is part of the notes question, not a second question.) A live caller said the owner would need their address; the note that reached the calendar was "his address is needed", and the owner opened the meeting with nowhere to go. The information is the note; the mention of it is not.
  2. Otherwise — they gave you the substance itself — your VERY NEXT action is to CALL attach_meeting_notes with what they said, in their own words, BEFORE you tell them it's noted. CALLING the tool is the only thing that saves the note; a spoken "I'll make a note of that" saves NOTHING and is true only AFTER the tool has run. Then confirm in ONE short sentence.
- If they say no BUT earlier in the call they gave SPECIFIC context the owner should have (what the project involves, something to look at first, a constraint, a request), attach THAT — their earlier words. Context they already spoke must not be lost just because it arrived before your question.
- The MEETING TOPIC is NOT a note. A consulting meeting gains nothing from the note "consulting work discussion" — if all you have is what the meeting is about, that is already on the calendar. Call no_notes.
- If they say no and there is nothing specific beyond the topic, call no_notes immediately and move on.

Ask ONCE. This is not an interview — whatever they give in one answer is the note. Do not re-ask their name or number, and do not re-confirm the booking; both are done.`;

/**
 * A rung that is over before it speaks: complete() fires in onEnter, in host code,
 * with no LLM turn and no audio. Used when the plan registered the notes step but the
 * call produced no meeting to attach notes to (the booking rung fell back to a
 * message) — the TaskGroup still pops the rung, so the skip must BE a rung. Safe:
 * complete() resolves the future run() awaits; an early resolution just returns
 * immediately.
 */
class SkipRung extends voice.AgentTask<MeetingNotesResult> {
  /** Marker for harnesses that drive rungs without a live session (sim-taskgroup): a
   *  normal rung's onEnter needs the session (generateReply); THIS one only completes,
   *  so a harness may — and must — invoke onEnter when it sees this flag. */
  readonly completesOnEnter = true;
  constructor() {
    super({ instructions: 'Unused — this task completes on entry, before any turn.' });
  }
  override onEnter(): Promise<void> {
    this.complete({ outcome: 'skipped' });
    return Promise.resolve();
  }
}

/** The 'default' template: one light question, then attach — or skip without a word. */
export function makeMeetingNotesRung(
  opts: Pick<
    MeetingContextOptions,
    'notesTool' | 'takeMessage' | 'meetingBooked' | 'knownCaller' | 'knownName' | 'onMessageTaken'
  >
): voice.AgentTask<MeetingNotesResult> {
  // No meeting on this call (booking fell back to a message), or no attach tool in this
  // session's capabilities → nothing to ask about. Host code decides; the caller never
  // hears a question about a meeting that does not exist.
  if (!opts.meetingBooked || !opts.notesTool) {
    return new SkipRung();
  }

  const completions: RungCompletion<MeetingNotesResult>[] = [
    {
      kind: 'action',
      toolName: 'attach_meeting_notes',
      realTool: opts.notesTool,
      extract: idExtractor('appointment_id', (id, raw) => ({
        outcome: 'notes' as const,
        appointmentId: id,
        raw,
      })),
    },
    {
      kind: 'collect',
      toolName: 'no_notes',
      description: 'Call when the caller has nothing to add for the meeting — finishes this step.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      build: () => ({ outcome: 'none' as const }),
      ack: 'Okay.',
    },
  ];

  // Fallback: the attach failed (or the caller's "note" turns out to be a callback
  // request) and a MESSAGE is the honest write — same principle as the booking rung's
  // fallback: never offer to pass something along without a tool call behind it.
  if (opts.takeMessage) {
    completions.push({
      kind: 'action',
      toolName: 'take_message',
      realTool: opts.takeMessage,
      argDefaults: opts.knownName
        ? (args) => ({ caller_name: opts.knownName, ...args })
        : undefined,
      extract: idExtractor('message_id', (id, raw) => ({
        outcome: 'message' as const,
        messageId: id,
        raw,
      })),
      onDone: opts.onMessageTaken
        ? (r) => opts.onMessageTaken!({ messageId: r.messageId ?? '', raw: r.raw })
        : undefined,
    });
  }

  return makeRung<MeetingNotesResult>({
    instructions: [opts.knownCaller, MEETING_NOTES_INSTRUCTIONS].filter(Boolean).join('\n\n'),
    tools: {},
    completion: completions,
  });
}

/**
 * Rung 3, dispatched by template. The plan registers ONE spec ('meeting_context'); which
 * questions it asks — and which write completes it — is the template's business.
 */
export function makeMeetingContextRung(opts: MeetingContextOptions): voice.AgentTask {
  if (opts.template === 'job') {
    return makeJobIntakeRung({
      messagingTools: opts.messagingTools,
      knownCaller: opts.knownCaller,
      meetingBooked: opts.meetingBooked,
      onCaptured: opts.onCaptured,
    });
  }
  return makeMeetingNotesRung(opts);
}
