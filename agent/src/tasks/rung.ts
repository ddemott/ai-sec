/**
 * THE GENERIC RUNG — one shape every rung is built from, regardless of business.
 *
 * The three hand-written rungs (identity, book, job-intake) were 90% identical
 * boilerplate: the same onEnter, the same markdown-stripping ttsNode, and the same
 * "wrap the real doing-tool and call this.complete() when it returns a success id"
 * dance. That duplication is where a rung silently drifts — someone adds a fourth
 * rung, forgets the onEnter, and the call goes dead with no error (gotcha #4).
 *
 * So a rung is now DATA, not a bespoke class. `makeRung(cfg)` builds the AgentTask and
 * bakes in every guarantee the notes say a rung must have (onEnter speaks, ttsNode
 * strips markdown, completion lives inside a tool). The business-specific part is just
 * the config: which instructions, which tools, and which tool call means "done".
 *
 * There are exactly TWO completion modes, because every rung we have or foresee is one
 * of them:
 *
 *   COLLECT  — the rung gathers some facts and confirms them; a synthetic completion
 *              tool (e.g. confirm_identity) fires when the model has them. Use when
 *              there is no single backend write that means "done" — the DOING is the
 *              gathering. (identity)
 *
 *   ACTION   — the rung's whole point is one real backend write (book_with_scheduling,
 *              capture_job_inquiry, cancel_appointment). Wrap that tool; the rung ends
 *              the instant it returns its success id. The write IS the completion, so
 *              there is no gap between "did the work" and "said it's done" — the model
 *              cannot end the rung by talking. A lookup-then-act rung (cancel needs
 *              get_my_appointments first) is just ACTION with the read tool added to
 *              `tools` — same mode, one more passthrough tool.
 *
 * Everything the hardening pass learned (BUILDING_SCRIPT_NOTES.md rules 8-11) is
 * enforced by CONSTRUCTION here: the completion is always a tool (rule: action-first is
 * the caller's job in the instructions, but the STRUCTURE guarantees a sentence can't
 * complete the rung), and only the tools you pass into `tools` are present (rule 8).
 */
import { llm, voice } from '@livekit/agents';
import { sanitizeStream } from '../speechSanitizer.js';

/** A rung that gathers + confirms facts; a synthetic tool marks it done. */
export interface CollectCompletion<R> {
  kind: 'collect';
  /** The completion tool's name, e.g. 'confirm_identity'. */
  toolName: string;
  description: string;
  /** JSON-schema parameters object for the completion tool. */
  parameters: Record<string, unknown>;
  /** Turn the model's confirmed args into the rung's typed result. */
  build: (args: Record<string, unknown>) => R;
  /** What to speak back to the model after completing (kept tiny). */
  ack?: string;
  onDone?: (r: R) => Promise<void> | void;
}

/** A rung whose completion IS a real backend write. Wrap it; complete on the success id. */
export interface ActionCompletion<R> {
  kind: 'action';
  /** The real tool's name (kept, so the model sees the tool it expects). */
  toolName: string;
  /** The real tool from buildTools(), untouched. */
  realTool: llm.ToolContext[string];
  /** Return the typed result when the write succeeded, or null to stay open. */
  extract: (raw: unknown) => R | null;
  /** Merge known facts (phone/name) into the model's args before the real call, so a
   *  model that forgets to pass them still succeeds (gotcha #2). */
  argDefaults?: (args: Record<string, unknown>) => Record<string, unknown>;
  onDone?: (r: R) => Promise<void> | void;
}

export type RungCompletion<R> = CollectCompletion<R> | ActionCompletion<R>;

export interface RungConfig<R> {
  /** Fully composed instructions (runtimePreamble + known-caller + body — see callPlan). */
  instructions: string;
  /** The rung's passthrough tools, ALREADY narrowed with pick(). The completion tool(s) are
   *  added here automatically — do not include them. Give ONLY load-bearing tools (rule 8). */
  tools: llm.ToolContext;
  /** How the rung ends. Usually ONE completion (book, capture, confirm_identity). A rung
   *  with more than one legitimate ending — e.g. scheduling, which ends on a cancel OR a
   *  reschedule OR "nothing to change" — passes several; the FIRST to succeed wins, and the
   *  rest are ignored (complete() only fires once). */
  completion: RungCompletion<R> | RungCompletion<R>[];
}

/**
 * Build a rung. Returns a real voice.AgentTask<R> with onEnter + ttsNode already wired.
 *
 * The completion tool is constructed INSIDE super() so its execute closure can call
 * this.complete — the same proven pattern the hand-written rungs used. (Arrow functions
 * created during super()-arg evaluation capture `this` lazily; they are only invoked at
 * tool-call time, long after super() has run.)
 */
export function makeRung<R>(cfg: RungConfig<R>): voice.AgentTask<R> {
  const completions = Array.isArray(cfg.completion) ? cfg.completion : [cfg.completion];

  class Rung extends voice.AgentTask<R> {
    // Finish once, and only once. With several completion tools (scheduling: cancel OR
    // reschedule OR nothing) two could in principle both report success; the first to call
    // this wins and the rest no-op, so the rung never double-completes.
    #finish(result: R): void {
      if (!this.done) this.complete(result);
    }

    constructor() {
      const completionTools: llm.ToolContext = {};
      for (const c of completions) {
        completionTools[c.toolName] =
          c.kind === 'collect'
            ? llm.tool({
                description: c.description,
                parameters: c.parameters,
                execute: async (args: unknown): Promise<string> => {
                  const result = c.build((args ?? {}) as Record<string, unknown>);
                  await c.onDone?.(result);
                  this.#finish(result); // ← an exit
                  return c.ack ?? 'Got it.';
                },
              })
            : llm.tool({
                description: (c.realTool as unknown as { description: string }).description,
                parameters: (c.realTool as unknown as { parameters: Record<string, unknown> })
                  .parameters,
                execute: async (args: unknown, toolCtx: unknown): Promise<unknown> => {
                  const merged =
                    c.argDefaults && args && typeof args === 'object'
                      ? c.argDefaults(args as Record<string, unknown>)
                      : args;
                  const raw = await (
                    c.realTool as unknown as {
                      execute: (a: unknown, o: unknown) => Promise<unknown>;
                    }
                  ).execute(merged, toolCtx);
                  const result = c.extract(raw);
                  if (result != null) {
                    await c.onDone?.(result);
                    this.#finish(result); // ← the write IS the transition
                  }
                  // Hand the tool's own words back either way — its confirmation on
                  // success, its error/refusal on a miss — so the model can relay it.
                  return raw;
                },
              });
      }
      super({
        instructions: cfg.instructions,
        tools: { ...cfg.tools, ...completionTools },
      });
    }

    // SPEAK on entry, or the rung takes over the session and sits silent (gotcha #4).
    override async onEnter(): Promise<void> {
      this.session.generateReply();
    }

    // Strip markdown before TTS, or a bulleted answer reads as one flat run-on (gotcha #5).
    override async ttsNode(
      text: ReadableStream<string>,
      modelSettings: Parameters<typeof voice.Agent.default.ttsNode>[2]
    ): ReturnType<typeof voice.Agent.default.ttsNode> {
      return voice.Agent.default.ttsNode(this, sanitizeStream(text), modelSettings);
    }
  }

  return new Rung();
}

/**
 * Pull a string id out of the JSON a wrapped tool returned. The agent-tools contract is
 * a JSON STRING ({ success, <id_field>: … } on success, an error shape otherwise), so a
 * present, non-empty id means the write LANDED. Anything unparseable or id-less means
 * "not done" — the safe direction: a missed success just retries; a false success would
 * end the rung with the work undone. Factored out because every ACTION rung needs it.
 */
export function idExtractor<R>(
  idField: string,
  build: (id: string, raw: unknown) => R
): (raw: unknown) => R | null {
  return (raw: unknown): R | null => {
    if (typeof raw !== 'string') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const id = (parsed as Record<string, unknown>)[idField];
    return typeof id === 'string' && id.length > 0 ? build(id, raw) : null;
  };
}
