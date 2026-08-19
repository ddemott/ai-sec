import type { voice } from '@livekit/agents';

type ToolLike = {
  execute: (args: unknown, ctx: unknown) => Promise<unknown>;
};

type ToolCtxWrapper = {
  _functionToolsMap?: Map<string, unknown>;
};

export function getTaskTool(task: { toolCtx: unknown }, name: string): ToolLike | undefined {
  const toolCtx = task.toolCtx as Record<string, unknown> & ToolCtxWrapper;
  const direct = toolCtx[name] as ToolLike | undefined;
  if (direct) return direct;
  const fromMap = toolCtx._functionToolsMap?.get(name) as ToolLike | undefined;
  return fromMap;
}

export function getTaskToolNames(task: { toolCtx: unknown }): string[] {
  const toolCtx = task.toolCtx as Record<string, unknown> & ToolCtxWrapper;
  if (toolCtx._functionToolsMap instanceof Map) {
    return [...toolCtx._functionToolsMap.keys()].sort();
  }
  return Object.keys(toolCtx).sort();
}

export function getAgentTool(agent: voice.Agent, name: string): unknown {
  const toolCtx = agent.toolCtx as unknown as Record<string, unknown> & ToolCtxWrapper;
  return toolCtx[name] ?? toolCtx._functionToolsMap?.get(name);
}
