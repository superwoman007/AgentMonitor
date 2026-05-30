import { SpanTreeNode } from '../api';

/**
 * 查找关键路径 — 从根到叶的最长 wall-clock 路径
 * 使用 DFS 遍历 span 树，累加每条路径的 latency 总和，返回最长路径的 spanId 列表
 */
export function findCriticalPath(spans: SpanTreeNode[]): string[] {
  if (spans.length === 0) return [];

  let longestPath: string[] = [];
  let longestDuration = -1;

  function dfs(node: SpanTreeNode, currentPath: string[], currentDuration: number) {
    const nodeLatency = node.latencyMs ?? 0;
    const newPath = [...currentPath, node.spanId];
    const newDuration = currentDuration + nodeLatency;

    if (node.children.length === 0) {
      if (newDuration > longestDuration) {
        longestDuration = newDuration;
        longestPath = newPath;
      }
      return;
    }

    for (const child of node.children) {
      dfs(child, newPath, newDuration);
    }
  }

  for (const root of spans) {
    dfs(root, [], 0);
  }

  return longestPath;
}
