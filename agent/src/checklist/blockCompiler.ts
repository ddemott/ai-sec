import type { ConversationBlockDef, TenantRuntimeConfig } from './blockTypes.js';
import type { QuestionNodeDef, QuestionTreeDef } from './types.js';
import { BLOCK_LIBRARY } from './blockLibrary.js';
import { PLATFORM_TREE_LIBRARY } from './trees.js';

const TREE_BY_ID = new Map<string, QuestionTreeDef>(
  PLATFORM_TREE_LIBRARY.map((tree) => [tree.tree_id, tree])
);

export function compileRuntimeConfig(
  config: TenantRuntimeConfig,
  blockLibrary: Record<string, ConversationBlockDef> = BLOCK_LIBRARY
): QuestionTreeDef[] {
  const seenBlocks = new Set<string>();
  const seenTrees = new Set<string>();
  const compiled: QuestionTreeDef[] = [];

  for (const blockId of config.enabled_conversation_blocks) {
    if (seenBlocks.has(blockId)) continue;
    seenBlocks.add(blockId);

    const block = blockLibrary[blockId];
    if (!block) {
      throw new Error(`Conversation block '${blockId}' not found in block library.`);
    }

    for (const treeId of block.tree_refs ?? []) {
      if (seenTrees.has(treeId)) continue;
      const tree = TREE_BY_ID.get(treeId);
      if (!tree) {
        throw new Error(
          `Tree ref '${treeId}' from conversation block '${blockId}' not found in platform tree library.`
        );
      }
      seenTrees.add(treeId);
      compiled.push(tree);
    }
  }

  return compiled;
}

function markOptional(node: QuestionNodeDef, optional: Set<string>): QuestionNodeDef {
  if (node.type === 'text' && optional.has(node.node_id)) {
    return { ...node, listen: true };
  }
  if (node.type === 'choice') {
    return {
      ...node,
      options: Object.fromEntries(
        Object.entries(node.options).map(([key, kids]) => [
          key,
          kids.map((child) => markOptional(child, optional)),
        ])
      ),
    };
  }
  return node;
}

function rewriteAsk(node: QuestionNodeDef, wording: Record<string, string>): QuestionNodeDef {
  if ((node.type === 'text' || node.type === 'choice') && wording[node.node_id]) {
    const next = { ...node, ask: wording[node.node_id] };
    if (next.type === 'choice') {
      return {
        ...next,
        options: Object.fromEntries(
          Object.entries(next.options).map(([key, kids]) => [
            key,
            kids.map((child) => rewriteAsk(child, wording)),
          ])
        ),
      };
    }
    return next;
  }
  if (node.type === 'choice') {
    return {
      ...node,
      options: Object.fromEntries(
        Object.entries(node.options).map(([key, kids]) => [
          key,
          kids.map((child) => rewriteAsk(child, wording)),
        ])
      ),
    };
  }
  return node;
}

/** Replace approved product-question `ask` text. Identity asks stay platform-owned. */
export function applyNodeWording(
  trees: QuestionTreeDef[],
  wording: Record<string, string> | undefined
): QuestionTreeDef[] {
  if (!wording || Object.keys(wording).length === 0) return trees;
  return trees.map((tree) => ({
    ...tree,
    nodes: tree.nodes.map((node) => rewriteAsk(node, wording)),
  }));
}

/** Flip allow-listed text nodes to listen-only so they never hold the goodbye gate. */
export function applyOptionalNodes(
  trees: QuestionTreeDef[],
  optionalNodeIds: readonly string[] | undefined
): QuestionTreeDef[] {
  if (!optionalNodeIds || optionalNodeIds.length === 0) return trees;
  const optional = new Set(optionalNodeIds);
  return trees.map((tree) => ({
    ...tree,
    nodes: tree.nodes.map((node) => markOptional(node, optional)),
  }));
}
