import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { register } from '../src/services/auth.js';
import { createProject } from '../src/services/project.js';
import { createSpan, getSpanTree } from '../src/services/span.js';
import { queryOne, run } from '../src/db/index.js';
import type { Span } from '../src/services/span.js';

describe('Span Service (TDD)', () => {
  let projectId: string;

  beforeAll(async () => {
    const auth = await register(`span-test-${Date.now()}@example.com`, 'Test12345678!', 'Span Test');
    const project = await createProject(auth.user.id, 'Span Test Project');
    projectId = project.id;
  });

  describe('createSpan', () => {
    it('should create and return a span with correct fields', async () => {
      const span = await createSpan({
        projectId,
        spanId: randomUUID(),
        traceId: randomUUID(),
        name: 'llm_call',
        traceType: 'llm',
        startedAt: new Date('2026-04-30T10:00:00Z'),
        endedAt: new Date('2026-04-30T10:00:02.5Z'),
        latencyMs: 2500,
        input: { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] },
        output: { choices: [{ message: { content: 'hello' } }] },
        attributes: { model: 'gpt-4', temperature: 0.7 },
        status: 'success',
        sessionId: null,
      });

      expect(span.span_id).toBeDefined();
      expect(span.trace_id).toBeDefined();
      expect(span.name).toBe('llm_call');
      expect(span.trace_type).toBe('llm');
      expect(span.latency_ms).toBe(2500);
      expect(span.status).toBe('success');
      expect(span.project_id).toBe(projectId);
    });

    it('should sanitize sensitive fields before storing', async () => {
      const span = await createSpan({
        projectId,
        spanId: randomUUID(),
        traceId: randomUUID(),
        name: 'api_call',
        traceType: 'function',
        startedAt: new Date(),
        input: { password: 'secret123', email: 'user@example.com', data: 'normal' },
        status: 'success',
      });

      expect(span.input).toEqual({
        password: '[FILTERED]',
        email: 'us***@ex***',
        data: 'normal',
      });
    });
  });

  describe('getSpanTree', () => {
    it('should build a 3-level nested tree', async () => {
      const traceId = randomUUID();
      const rootId = randomUUID();

      // Root
      await createSpan({
        projectId,
        spanId: rootId,
        traceId,
        name: 'agent_run',
        traceType: 'function',
        startedAt: new Date('2026-04-30T10:00:00Z'),
        endedAt: new Date('2026-04-30T10:00:05Z'),
        latencyMs: 5000,
        status: 'success',
      });

      // Child 1
      const childId1 = randomUUID();
      await createSpan({
        projectId,
        spanId: childId1,
        traceId,
        parentSpanId: rootId,
        name: 'llm_call',
        traceType: 'llm',
        startedAt: new Date('2026-04-30T10:00:01Z'),
        endedAt: new Date('2026-04-30T10:00:03Z'),
        latencyMs: 2000,
        status: 'success',
      });

      // Grandchild
      await createSpan({
        projectId,
        spanId: randomUUID(),
        traceId,
        parentSpanId: childId1,
        name: 'serialize',
        traceType: 'function',
        startedAt: new Date('2026-04-30T10:00:01.1Z'),
        endedAt: new Date('2026-04-30T10:00:01.2Z'),
        latencyMs: 100,
        status: 'success',
      });

      // Child 2
      await createSpan({
        projectId,
        spanId: randomUUID(),
        traceId,
        parentSpanId: rootId,
        name: 'tool_call',
        traceType: 'tool_call',
        startedAt: new Date('2026-04-30T10:00:03.5Z'),
        endedAt: new Date('2026-04-30T10:00:04Z'),
        latencyMs: 500,
        status: 'success',
      });

      const tree = await getSpanTree(traceId);
      expect(tree).not.toBeNull();
      expect(tree!.rootSpan).not.toBeNull();
      expect(tree!.rootSpan!.spanId).toBe(rootId);
      expect(tree!.rootSpan!.children).toHaveLength(2);
      expect(tree!.rootSpan!.children[0].spanId).toBe(childId1);
      expect(tree!.rootSpan!.children[0].children).toHaveLength(1);
      expect(tree!.rootSpan!.children[0].children[0].name).toBe('serialize');
      expect(tree!.stats.totalSpans).toBe(4);
      expect(tree!.stats.totalLatencyMs).toBe(7600);
    });

    it('should detect cycles and mark cyclic nodes as orphaned (attached to root)', async () => {
      const traceId = randomUUID();

      // A (root)
      const cycleA = randomUUID();
      const cycleB = randomUUID();
      await createSpan({
        projectId,
        spanId: cycleA,
        traceId,
        name: 'A',
        traceType: 'function',
        startedAt: new Date(),
        status: 'success',
      });

      // B -> A
      await createSpan({
        projectId,
        spanId: cycleB,
        traceId,
        parentSpanId: cycleA,
        name: 'B',
        traceType: 'function',
        startedAt: new Date(),
        status: 'success',
      });

      // A -> B (creates cycle A<->B)
      await run(
        `UPDATE spans SET parent_span_id = $1 WHERE span_id = $2`,
        [cycleB, cycleA]
      );

      const tree = await getSpanTree(traceId);
      expect(tree).not.toBeNull();
      // Cycle nodes should be orphaned but still present
      const allSpanIds = collectSpanIds(tree!.rootSpan!);
      expect(allSpanIds).toContain(cycleA);
      expect(allSpanIds).toContain(cycleB);
    });

    it('should return null when no spans exist for trace', async () => {
      const tree = await getSpanTree('non-existent-trace');
      expect(tree).toBeNull();
    });

    it('should calculate stats correctly including tokens and cost', async () => {
      const traceId = randomUUID();

      await createSpan({
        projectId,
        spanId: randomUUID(),
        traceId,
        name: 'llm',
        traceType: 'llm',
        startedAt: new Date(),
        latencyMs: 1000,
        attributes: { tokens_prompt: 100, tokens_completion: 50, tokens_total: 150, cost_usd: 0.003 },
        status: 'success',
      });

      const spans = await queryOne<Span>(`SELECT * FROM spans WHERE trace_id = $1 ORDER BY started_at ASC LIMIT 1`, [traceId]);
      const parentId = spans!.span_id;

      await createSpan({
        projectId,
        spanId: randomUUID(),
        traceId,
        parentSpanId: parentId,
        name: 'llm2',
        traceType: 'llm',
        startedAt: new Date(),
        latencyMs: 2000,
        attributes: { tokens_total: 200, cost_usd: 0.004 },
        status: 'error',
        error: 'timeout',
      });

      const tree = await getSpanTree(traceId);
      expect(tree!.stats.totalSpans).toBe(2);
      expect(tree!.stats.totalLatencyMs).toBe(3000);
      expect(tree!.stats.totalTokens.total).toBe(350);
      expect(tree!.stats.totalCostUsd).toBeCloseTo(0.007, 6);
      expect(tree!.stats.errorCount).toBe(1);
    });
  });
});

function collectSpanIds(node: any): string[] {
  const ids = [node.spanId];
  for (const child of node.children || []) {
    ids.push(...collectSpanIds(child));
  }
  return ids;
}
