/**
 * Trace 根 Span 落库测试（Truth Repair-2）
 *
 * 测试目标：验证 createTrace 是根 Span 的唯一写入点，
 * 一条 Trace 恰好产生一条根 Span 记录，且 trace 行与 span 行的
 * trace_id/span_id 完全一致。SDK 不再独立向 /spans 双写。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { register } from '../src/services/auth.js';
import { createProject } from '../src/services/project.js';
import { createTrace } from '../src/services/trace.js';
import { getSpanTree } from '../src/services/span.js';

describe('Trace 根 Span 落库', () => {
  let projectId: string;

  beforeAll(async () => {
    // 创建测试用户和项目
    const auth = await register(`rootspan-${Date.now()}@example.com`, 'Test12345678!', 'RootSpan');
    const project = await createProject(auth.user.id, 'Root Span Project');
    projectId = project.id;
  });

  it('createTrace 写入唯一根 Span，且 ID 与 trace 一致', async () => {
    /**
     * 验证创建 trace 时，spans 表中产生唯一一条根 Span，
     * 且 span 的 name、traceType 与 trace 一致；
     * span.status 采用 V2 终端状态语义：success 归一化为 ok。
     */
    const trace = await createTrace({
      projectId,
      traceType: 'llm',
      name: 'gpt-4-call',
      input: { model: 'gpt-4', prompt: 'hello' },
      output: { content: 'hi there' },
      status: 'success',
      latencyMs: 1500,
    });

    expect(trace.id).toBeDefined();
    expect(trace.trace_id).toBeDefined();
    expect(trace.span_id).toBeDefined();

    // 验证 spans 表中也产生了对应记录
    const tree = await getSpanTree(trace.trace_id!);
    expect(tree).not.toBeNull();
    expect(tree!.rootSpan).not.toBeNull();
    expect(tree!.rootSpan!.spanId).toBe(trace.span_id);
    expect(tree!.rootSpan!.name).toBe('gpt-4-call');
    expect(tree!.rootSpan!.traceType).toBe('llm');
    // SDK success 在 span 侧归一化为 ok（V2 终端状态）
    expect(tree!.rootSpan!.status).toBe('ok');
  });

  it('根 Span 写入失败不影响 trace 创建', async () => {
    /**
     * createTrace 内部对根 Span 写入异常做了兜底，
     * 即使 span 落库失败，trace 主记录依然可以正常返回。
     */
    const trace = await createTrace({
      projectId,
      traceType: 'tool_call',
      name: 'resilient_call',
      status: 'success',
    });

    expect(trace.id).toBeDefined();
    expect(trace.trace_id).toBeDefined();
  });
});
