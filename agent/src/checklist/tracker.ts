/**
 * ChecklistTracker — HOST CODE OWNS THE CHECKLIST. The one rung-era lesson that
 * must survive the rewrite (docs/QUESTION_TREE_ARCHITECTURE.md §2, §3.2).
 *
 * The model proposes (record_answer / set_purpose / tool calls); this class
 * disposes. It is deliberately PURE — no LiveKit, no session, no I/O — so every
 * behaviour the design conversation named is a unit test here, not a live-call
 * discovery:
 *
 *  - out-of-order volunteering ("…but we have all our people work remote")
 *  - answers recorded BEFORE their branch activates (held, promoted, or discarded)
 *  - sibling branches ruled out recursively the moment a choice is answered
 *  - mind-change ("actually it's contract-to-hire") reopening a choice and
 *    DISCARDING the dead branch's answers — no ghost data briefing the owner
 *  - declined ("I don't know the rate") as a first-class resolved state, so the
 *    model never has to fabricate a value to close a node
 *  - actions completed ONLY by their real tool's success id
 *  - a completion gate (isResolved) the goodbye can be locked on
 *
 * Errors thrown by record() are worded FOR THE MODEL — the agent returns them as
 * the tool result, so the message itself is the corrective instruction (the same
 * trick the booking standing_fact uses: the tool result is the one context the
 * model reliably re-reads).
 */
import {
  RESOLVED_STATUSES,
  type ActionNodeDef,
  type FrontierItem,
  type NodeId,
  type NodeStatus,
  type QuestionNodeDef,
  type QuestionTreeDef,
} from './types.js';

/** The library itself is malformed — a boot/test-time failure, never mid-call. */
export class TreeDefinitionError extends Error {}
/** select() was handed a tree_id the library doesn't have. */
export class UnknownTreeError extends Error {}
/** record() was handed a node_id that isn't part of this call's checklist. */
export class UnknownNodeError extends Error {}
/** record() was structurally invalid (bad option, value on an action, dead node…). */
export class RecordError extends Error {}

/** Values are caller-derived text; cap so a runaway transcription can't bloat state. */
const MAX_VALUE_LENGTH = 500;

/** One occurrence of a node in a tree: at the root, or under a choice's option. */
interface Placement {
  treeId: string;
  parent: { choiceId: NodeId; option: string } | null;
}

interface Entry {
  def: QuestionNodeDef;
  /** A node can appear in several trees AND under several branches (e.g. timezone
   *  under both remote and hybrid). It is ONE question with one value; the
   *  placements only decide when it is live. */
  placements: Placement[];
}

type Liveness = 'live' | 'latent' | 'dead' | 'unselected';

export class ChecklistTracker {
  #library = new Map<string, QuestionTreeDef>();
  #entries = new Map<NodeId, Entry>();
  /** Depth-first node order per tree — the render/frontier order. */
  #treeWalks = new Map<string, NodeId[]>();
  #selected: string[] = [];
  #values = new Map<NodeId, string>();
  #declined = new Set<NodeId>();
  #actionDone = new Map<NodeId, string>();

  constructor(library: QuestionTreeDef[]) {
    for (const tree of library) {
      if (this.#library.has(tree.tree_id)) {
        throw new TreeDefinitionError(`Duplicate tree_id "${tree.tree_id}" in library.`);
      }
      this.#library.set(tree.tree_id, tree);
      const walk: NodeId[] = [];
      this.#indexNodes(tree.nodes, tree.tree_id, null, new Set(), walk);
      this.#treeWalks.set(tree.tree_id, walk);
    }
    // requires refs are validated across the WHOLE library (they may legitimately
    // point into another tree — booking requires identity's phone), after every
    // tree is indexed. A typo'd id here would silently gate an action forever.
    for (const entry of this.#entries.values()) {
      if (entry.def.type !== 'action') continue;
      for (const req of entry.def.requires ?? []) {
        if (!this.#entries.has(req)) {
          throw new TreeDefinitionError(
            `Action "${entry.def.node_id}" requires unknown node "${req}" — not defined in any library tree.`
          );
        }
      }
    }
  }

  #indexNodes(
    nodes: QuestionNodeDef[],
    treeId: string,
    parent: Placement['parent'],
    ancestors: ReadonlySet<NodeId>,
    walk: NodeId[]
  ): void {
    for (const def of nodes) {
      // A node nested under itself would make liveness infinitely recursive.
      if (ancestors.has(def.node_id)) {
        throw new TreeDefinitionError(
          `Tree "${treeId}": node "${def.node_id}" is nested under itself.`
        );
      }
      const existing = this.#entries.get(def.node_id);
      if (existing) {
        // Shared node ids are the MERGE mechanism (caller_name exists once across
        // every tree) — but only if the definitions agree on what the node IS.
        if (existing.def.type !== def.type) {
          throw new TreeDefinitionError(
            `Node "${def.node_id}" is "${existing.def.type}" in one tree and "${def.type}" in another — shared ids must agree on type.`
          );
        }
        if (existing.def.type === 'choice' && def.type === 'choice') {
          const a = Object.keys(existing.def.options).sort().join(',');
          const b = Object.keys(def.options).sort().join(',');
          if (a !== b) {
            throw new TreeDefinitionError(
              `Choice "${def.node_id}" has options [${a}] in one tree and [${b}] in another — shared choices must offer identical options.`
            );
          }
        }
        existing.placements.push({ treeId, parent });
      } else {
        this.#entries.set(def.node_id, { def, placements: [{ treeId, parent }] });
      }
      walk.push(def.node_id);
      if (def.type === 'choice') {
        const childAncestors = new Set(ancestors).add(def.node_id);
        for (const [option, children] of Object.entries(def.options)) {
          this.#indexNodes(
            children,
            treeId,
            { choiceId: def.node_id, option },
            childAncestors,
            walk
          );
        }
      }
    }
  }

  // ── selection (the purpose accumulator) ────────────────────────────────────

  /**
   * Add trees to the live checklist. An ACCUMULATOR, callable mid-call — "oh,
   * and can I also book a time?" attaches the booking tree with everything
   * already collected still standing. Re-selecting is a harmless no-op.
   */
  select(treeIds: string[]): { added: string[] } {
    const added: string[] = [];
    for (const id of treeIds) {
      if (!this.#library.has(id)) {
        throw new UnknownTreeError(
          `No tree called "${id}". Available: ${[...this.#library.keys()].join(', ')}.`
        );
      }
      if (!this.#selected.includes(id)) {
        this.#selected.push(id);
        added.push(id);
      }
    }
    return { added };
  }

  hasSelection(): boolean {
    return this.#selected.length > 0;
  }

  selectedTrees(): string[] {
    return [...this.#selected];
  }

  // ── liveness (which branches exist right now) ──────────────────────────────

  #liveness(nodeId: NodeId, memo: Map<NodeId, Liveness> = new Map()): Liveness {
    const cached = memo.get(nodeId);
    if (cached) return cached;
    const entry = this.#entries.get(nodeId);
    const placements = entry?.placements.filter((p) => this.#selected.includes(p.treeId)) ?? [];
    let result: Liveness = 'unselected';
    // Best across placements: one live path is enough; latent beats dead (an
    // unanswered choice may yet go this way; a ruled-out one cannot).
    for (const p of placements) {
      const status = this.#placementLiveness(p, memo);
      if (status === 'live') {
        result = 'live';
        break;
      }
      if (status === 'latent') result = 'latent';
      else if (result === 'unselected') result = 'dead';
    }
    memo.set(nodeId, result);
    return result;
  }

  #placementLiveness(p: Placement, memo: Map<NodeId, Liveness>): Exclude<Liveness, 'unselected'> {
    if (!p.parent) return 'live';
    const parentLiveness = this.#liveness(p.parent.choiceId, memo);
    if (parentLiveness !== 'live') return parentLiveness === 'latent' ? 'latent' : 'dead';
    // A declined choice can never activate a branch — every branch under it is
    // ruled out, so the call can still complete.
    if (this.#declined.has(p.parent.choiceId)) return 'dead';
    const answer = this.#values.get(p.parent.choiceId);
    if (answer === undefined) return 'latent';
    return answer === p.parent.option ? 'live' : 'dead';
  }

  // ── node status ────────────────────────────────────────────────────────────

  status(nodeId: NodeId): NodeStatus {
    const entry = this.#entries.get(nodeId);
    if (!entry) return 'unselected';
    const liveness = this.#liveness(nodeId);
    if (liveness === 'unselected') return 'unselected';
    if (liveness === 'dead') return 'not_applicable';
    if (liveness === 'latent') return this.#values.has(nodeId) ? 'pending' : 'latent';
    if (entry.def.type === 'action') {
      if (this.#declined.has(nodeId)) return 'declined';
      if (this.#actionDone.has(nodeId)) return 'done';
      return this.#requiresMet(entry.def) ? 'ready' : 'blocked';
    }
    if (this.#values.has(nodeId)) return 'answered';
    if (this.#declined.has(nodeId)) return 'declined';
    return 'open';
  }

  #requiresMet(def: ActionNodeDef): boolean {
    // declined and not_applicable SATISFY a requirement: on a real call the
    // caller declined three intake questions and the capture still had to land
    // (2026-07-21, call 3). The gate is ordering UX; the real tool enforces its
    // own hard needs.
    return (def.requires ?? []).every((req) => RESOLVED_STATUSES.has(this.status(req)));
  }

  value(nodeId: NodeId): string | undefined {
    return this.#values.get(nodeId);
  }

  // ── recording (the ONLY way conversation changes state) ────────────────────

  /**
   * Record what the caller actually said for a node — an answer, or that they
   * declined. Throws RecordError/UnknownNodeError with messages written to be
   * handed straight back to the model as the tool result.
   */
  record(nodeId: NodeId, input: { value?: string; declined?: boolean }): NodeStatus {
    const entry = this.#entries.get(nodeId);
    if (!entry || this.#liveness(nodeId) === 'unselected') {
      throw new UnknownNodeError(
        `"${nodeId}" is not on this call's checklist. Record only the ids the checklist shows.`
      );
    }
    const def = entry.def;

    if (def.type === 'action') {
      if (input.declined) {
        if (this.#actionDone.has(nodeId)) {
          throw new RecordError(
            `"${nodeId}" is already DONE — its tool succeeded. It cannot be declined after the fact.`
          );
        }
        this.#declined.add(nodeId);
        return this.status(nodeId);
      }
      throw new RecordError(
        `"${nodeId}" is completed by calling its tool (${def.tool}), never by record_answer. ` +
          `Record it only as declined:true if the caller decides against it.`
      );
    }

    if (this.#liveness(nodeId) === 'dead') {
      const blocker = this.#blockingChoice(entry);
      throw new RecordError(
        `"${nodeId}" is not applicable on this call${
          blocker ? ` — the answer to "${blocker}" ruled it out` : ''
        }. Do not ask it.`
      );
    }

    if (input.declined) {
      this.#values.delete(nodeId);
      this.#declined.add(nodeId);
      if (def.type === 'choice') this.#discardDeadAnswers();
      return this.status(nodeId);
    }

    const value = (input.value ?? '').trim().slice(0, MAX_VALUE_LENGTH);
    if (!value) {
      throw new RecordError(
        `Recording "${nodeId}" needs a value (or declined:true). Record only what the caller actually said.`
      );
    }
    if (def.type === 'choice' && !(value in def.options)) {
      throw new RecordError(
        `"${value}" is not an option for "${nodeId}". The options are exactly: ` +
          `${Object.keys(def.options).join(', ')}. Ask a clarifying question, then record one of those.`
      );
    }

    this.#values.set(nodeId, value);
    this.#declined.delete(nodeId);
    // Answering (or re-answering — the mind-change) a choice redraws the map:
    // branches just ruled out take their recorded answers with them. Kept data
    // under a dead branch is a ghost that would brief the owner on a hypothesis
    // the caller withdrew.
    if (def.type === 'choice') this.#discardDeadAnswers();
    return this.status(nodeId);
  }

  #blockingChoice(entry: Entry): NodeId | null {
    for (const p of entry.placements) {
      if (!p.parent || !this.#selected.includes(p.treeId)) continue;
      const answer = this.#values.get(p.parent.choiceId);
      if (answer !== undefined && answer !== p.parent.option) return p.parent.choiceId;
      if (this.#declined.has(p.parent.choiceId)) return p.parent.choiceId;
    }
    return null;
  }

  #discardDeadAnswers(): void {
    const memo = new Map<NodeId, Liveness>();
    for (const nodeId of this.#entries.keys()) {
      if (this.#liveness(nodeId, memo) === 'dead') {
        this.#values.delete(nodeId);
        this.#declined.delete(nodeId);
        // #actionDone is deliberately KEPT — a landed backend write is history,
        // not state to un-know.
      }
    }
  }

  /**
   * The HOST marks an action done when its real tool returned a success id —
   * the agent calls this from the tool wrapper, exactly where the rung ACTION
   * completion lived. The model has no path to it.
   */
  completeAction(nodeId: NodeId, successId: string): void {
    const entry = this.#entries.get(nodeId);
    if (!entry || entry.def.type !== 'action') {
      throw new UnknownNodeError(`"${nodeId}" is not an action node.`);
    }
    this.#actionDone.set(nodeId, successId);
    this.#declined.delete(nodeId);
  }

  // ── what the model sees, and the gate ──────────────────────────────────────

  /** Live, open ask nodes + ready actions — what may be asked or done RIGHT NOW. */
  frontier(): FrontierItem[] {
    const items: FrontierItem[] = [];
    for (const nodeId of this.#selectedWalk()) {
      const entry = this.#entries.get(nodeId)!;
      const status = this.status(nodeId);
      if (status === 'open') {
        items.push({
          node_id: nodeId,
          kind: 'ask',
          detail: (entry.def as { ask: string }).ask,
        });
      } else if (status === 'ready') {
        const def = entry.def as ActionNodeDef;
        items.push({ node_id: nodeId, kind: 'action', detail: `${def.description} (${def.tool})` });
      }
    }
    return items;
  }

  /** Every selected node once, in selection order then tree definition order. */
  #selectedWalk(): NodeId[] {
    const seen = new Set<NodeId>();
    const out: NodeId[] = [];
    for (const treeId of this.#selected) {
      for (const nodeId of this.#treeWalks.get(treeId) ?? []) {
        if (!seen.has(nodeId)) {
          seen.add(nodeId);
          out.push(nodeId);
        }
      }
    }
    return out;
  }

  /**
   * The compact checklist the model reads every time it records — designed to be
   * a TOOL RESULT (the context the model actually re-reads all call, the
   * standing_fact lesson). Dead branches are OMITTED entirely: a question not in
   * the prompt cannot be asked. Latent branches are shown listen-only, so
   * volunteered answers ahead of a choice still get captured.
   */
  renderState(): string {
    const lines: string[] = [];
    for (const nodeId of this.#selectedWalk()) {
      const entry = this.#entries.get(nodeId)!;
      const def = entry.def;
      switch (this.status(nodeId)) {
        case 'answered':
          lines.push(`[✓] ${nodeId}: ${this.#values.get(nodeId)}`);
          break;
        case 'open':
          lines.push(`[ASK] ${nodeId} — ${(def as { ask: string }).ask}`);
          break;
        case 'declined':
          lines.push(`[—] ${nodeId}: caller declined / could not say (resolved — do not re-ask)`);
          break;
        case 'latent':
          lines.push(
            `[listen] ${nodeId} — ${(def as { ask: string }).ask} (${this.#latentTrigger(entry)}; do NOT ask yet — record it if the caller volunteers it)`
          );
          break;
        case 'pending':
          lines.push(
            `[held] ${nodeId}: ${this.#values.get(nodeId)} (recorded early — ${this.#latentTrigger(entry)})`
          );
          break;
        case 'ready':
          lines.push(
            `[ACTION NOW] ${nodeId} — ${(def as ActionNodeDef).description}: call ${(def as ActionNodeDef).tool}`
          );
          break;
        case 'blocked': {
          const unmet = ((def as ActionNodeDef).requires ?? []).filter(
            (r) => !RESOLVED_STATUSES.has(this.status(r))
          );
          lines.push(
            `[action later] ${nodeId} — ${(def as ActionNodeDef).description} (first: ${unmet.join(', ')})`
          );
          break;
        }
        case 'done':
          lines.push(`[✓] ${nodeId} — done (${(def as ActionNodeDef).tool} succeeded)`);
          break;
        case 'not_applicable':
        case 'unselected':
          break; // omitted: not in the prompt = cannot be asked
      }
    }
    const header =
      'CHECKLIST — fill anything you hear with record_answer; ask ONLY items marked [ASK]. ' +
      'Record only what the caller actually said — never stretch an inference into a field.';
    const footer = this.isResolved() ? 'CHECKLIST COMPLETE — nothing left to collect.' : undefined;
    return [header, ...lines, ...(footer ? [footer] : [])].join('\n');
  }

  #latentTrigger(entry: Entry): string {
    const triggers = entry.placements
      .filter((p) => this.#selected.includes(p.treeId) && p.parent)
      .map((p) => `only if ${p.parent!.choiceId} = ${p.parent!.option}`);
    return [...new Set(triggers)].join(' or ') || 'awaiting an earlier answer';
  }

  /**
   * THE GOODBYE GATE. True only when a purpose has been selected and every
   * selected node is resolved. finish_call refuses to close while this is false —
   * the structural guarantee that no stated goal is forgotten, which is what
   * book-first actually existed to protect.
   */
  isResolved(): boolean {
    if (!this.hasSelection()) return false;
    return this.#selectedWalk().every((nodeId) => RESOLVED_STATUSES.has(this.status(nodeId)));
  }

  /** Full node → state view, for tests, logs, and the eventual dashboard view. */
  snapshot(): Record<NodeId, { status: NodeStatus; value?: string }> {
    const out: Record<NodeId, { status: NodeStatus; value?: string }> = {};
    for (const nodeId of this.#selectedWalk()) {
      const status = this.status(nodeId);
      const value = this.#values.get(nodeId) ?? this.#actionDone.get(nodeId);
      out[nodeId] = value !== undefined ? { status, value } : { status };
    }
    return out;
  }
}
