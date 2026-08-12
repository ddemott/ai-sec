import type { ConversationBlockDef, TenantRuntimeConfig } from './blockTypes.js';
import type { QuestionTreeDef } from './types.js';
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
