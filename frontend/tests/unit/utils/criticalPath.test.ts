import { describe, it, expect } from 'vitest';
import { findCriticalPath } from '../../../src/utils/criticalPath';
import { SpanTreeNode } from '../../../src/api';

function makeSpan(overrides: Partial<SpanTreeNode> & { spanId: string; name: string }): SpanTreeNode {
  return {
    traceType: 'llm',
    startedAt: '2024-01-01T00:00:00.000Z',
    endedAt: null,
    latencyMs: 100,
    status: 'success',
    error: null,
    input: null,
    output: null,
    attributes: null,
    tokens: null,
    costUsd: null,
    children: [],
    ...overrides,
  };
}

describe('findCriticalPath', () => {
  it('returns empty array for empty spans', () => {
    expect(findCriticalPath([])).toEqual([]);
  });

  it('returns single span when only one exists', () => {
    const spans = [makeSpan({ spanId: 'a', name: 'root', latencyMs: 500 })];
    expect(findCriticalPath(spans)).toEqual(['a']);
  });

  it('finds the longest path in a linear chain', () => {
    const spans: SpanTreeNode[] = [
      makeSpan({
        spanId: 'root',
        name: 'root',
        latencyMs: 1000,
        children: [
          makeSpan({
            spanId: 'child1',
            name: 'child1',
            latencyMs: 800,
            children: [
              makeSpan({ spanId: 'grandchild', name: 'grandchild', latencyMs: 300 }),
            ],
          }),
        ],
      }),
    ];
    expect(findCriticalPath(spans)).toEqual(['root', 'child1', 'grandchild']);
  });

  it('picks the branch with longest total duration', () => {
    const spans: SpanTreeNode[] = [
      makeSpan({
        spanId: 'root',
        name: 'root',
        latencyMs: 100,
        children: [
          makeSpan({
            spanId: 'fast-branch',
            name: 'fast',
            latencyMs: 50,
            children: [
              makeSpan({ spanId: 'fast-leaf', name: 'fast-leaf', latencyMs: 10 }),
            ],
          }),
          makeSpan({
            spanId: 'slow-branch',
            name: 'slow',
            latencyMs: 500,
            children: [
              makeSpan({ spanId: 'slow-leaf', name: 'slow-leaf', latencyMs: 200 }),
            ],
          }),
        ],
      }),
    ];
    const path = findCriticalPath(spans);
    expect(path).toEqual(['root', 'slow-branch', 'slow-leaf']);
  });

  it('handles multiple root spans and picks the longest', () => {
    const spans: SpanTreeNode[] = [
      makeSpan({ spanId: 'short-root', name: 'short', latencyMs: 100 }),
      makeSpan({
        spanId: 'long-root',
        name: 'long',
        latencyMs: 900,
        children: [
          makeSpan({ spanId: 'long-child', name: 'long-child', latencyMs: 400 }),
        ],
      }),
    ];
    expect(findCriticalPath(spans)).toEqual(['long-root', 'long-child']);
  });

  it('handles spans with null latency (treats as 0)', () => {
    const spans: SpanTreeNode[] = [
      makeSpan({
        spanId: 'root',
        name: 'root',
        latencyMs: null,
        children: [
          makeSpan({ spanId: 'child', name: 'child', latencyMs: 200 }),
        ],
      }),
    ];
    expect(findCriticalPath(spans)).toEqual(['root', 'child']);
  });
});
