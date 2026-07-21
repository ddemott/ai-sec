/**
 * QUESTION TREE definitions — the declarative data the whole architecture runs on.
 * Design: docs/QUESTION_TREE_ARCHITECTURE.md (§3.1).
 *
 * A tenant has a LIBRARY of small trees. A call's checklist is the MERGE of the
 * trees its purpose selects. Nodes are questions; choice nodes carry if-branches —
 * answering one activates that option's children and rules the sibling branches
 * out. The tracker (tracker.ts) owns every node's state; these types are pure
 * shape.
 */

export type NodeId = string;

/** A free-text question — filled from the caller's words via record_answer. */
export interface TextNodeDef {
  node_id: NodeId;
  type: 'text';
  /** What to collect, phrased for the model (never read verbatim to the caller). */
  ask: string;
}

/**
 * An if-branch. The recorded value must be one of the option keys; recording it
 * activates THAT option's child nodes and makes every sibling branch
 * not-applicable. Re-recording a different option (mind-change) reopens: the old
 * branch dies and its answers are discarded.
 */
export interface ChoiceNodeDef {
  node_id: NodeId;
  type: 'choice';
  ask: string;
  /** option value → the follow-up nodes that exist only if this option is chosen. */
  options: Record<string, QuestionNodeDef[]>;
}

/**
 * A node completed by a REAL tool's success — never by conversation. The model
 * cannot mark it done; the host calls completeAction() when the named tool
 * returns its success id (the rung-era ACTION lesson, kept).
 */
export interface ActionNodeDef {
  node_id: NodeId;
  type: 'action';
  /** The real tool whose success id completes this node (e.g. book_with_scheduling). */
  tool: string;
  /** What this action accomplishes, for the rendered checklist. */
  description: string;
  /**
   * Node ids that must be RESOLVED (answered, declined, or ruled out) before the
   * tool goes live. A soft ordering gate, not enforcement — the real tool still
   * validates its own inputs. Ids absent from the call's selected trees are
   * treated as satisfied for the same reason.
   */
  requires?: NodeId[];
  /**
   * When true, the action is ready only once EVERY question node in its own
   * tree(s) is resolved — "finish the intake, then write". Found by the first
   * mock call (2026-07-21): capture_job_inquiry fired the moment its 3 requires
   * were met, with contract length / work mode / timezone still uncollected —
   * a write that would have gone to the owner incomplete.
   */
  await_tree?: boolean;
}

export type QuestionNodeDef = TextNodeDef | ChoiceNodeDef | ActionNodeDef;

export interface QuestionTreeDef {
  tree_id: string;
  /**
   * Written FOR THE PURPOSE SELECTOR — the model reads this to decide which
   * trees a caller's opener selects. Carry the intent-boundary examples here
   * (e.g. "fix my computer" is a service request, NOT a job inquiry — PR #288).
   */
  description: string;
  nodes: QuestionNodeDef[];
}

/**
 * Every state a node can be in. Ask nodes (text/choice) move through
 * open → answered/declined; nodes on unactivated branches are latent (listen-only)
 * or pending (value volunteered early); nodes on ruled-out branches are
 * not_applicable. Action nodes move blocked → ready → done.
 */
export type NodeStatus =
  | 'open' // live and unanswered — MAY BE ASKED
  | 'answered' // ✓
  | 'declined' // asked; caller can't or won't say — resolved, distinct from ✗
  | 'not_applicable' // ✗ — every path to it sits under a choice answered another way
  | 'latent' // parent choice unanswered — listen for it, never ask it
  | 'pending' // latent, but a volunteered value is already held for it
  | 'blocked' // action whose requires are not yet resolved
  | 'ready' // action ready to fire — its tool should be live
  | 'done' // action completed by its tool's success id — ✓
  | 'unselected'; // exists in the library, but not in this call's trees

/** A resolved node no longer blocks the call from completing. */
export const RESOLVED_STATUSES: ReadonlySet<NodeStatus> = new Set([
  'answered',
  'declined',
  'not_applicable',
  'done',
  'unselected',
]);

export interface FrontierItem {
  node_id: NodeId;
  kind: 'ask' | 'action';
  /** The ask text (ask nodes) or "description (tool)" (action nodes). */
  detail: string;
}
