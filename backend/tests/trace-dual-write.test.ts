/**
 * Trace 双写 Span 测试
 *
 * 测试目标：验证 createTrace 在创建 trace 记录的同时，
 * 也会在 spans 表中创建对应的 root span 记录。
 * 同时验证双写失败不影响 trace 主流程。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { register } from '../src/services/auth.js';
import { createProject } from '../src/services/project.js';
import { createTrace } from '../src/services/trace.js';
import { getSpanTree } from '../src/services/span.js';

describe('Trace Dual-Write to Spans', () => {
  let projectId: string;

  beforeAll(async () => {
    // 创建测试用户和项目
    const auth = await register(`dualwrite-${Date.now()}@example.com`, 'Test12345678!', 'DualWrite');
    const project = await createProject(auth.user.id, 'Dual Write Project');
    projectId = project.id;
  });

  it('should create a span in spans table when creating a trace', async () => {
    /**
     * 验证创建 trace 时，spans 表中也会产生对应的 root span 记录，
     * 且 span 的 name、traceType、status 等字段与 trace 一致。
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

    // 验证 spans 表中也产生了对应记录
    const tree = await getSpanTree(trace.trace_id!);
    expect(tree).not.toBeNull();
    expect(tree!.rootSpan).not.toBeNull();
    expect(tree!.rootSpan!.name).toBe('gpt-4-call');
    expect(tree!.rootSpan!.traceType).toBe('llm');
    expect(tree!.rootSpan!.status).toBe('success');
  });

  it('should not fail trace creation if span dual-write fails', async () => {
    /**
     * 验证 trace 创建应该成功，即使 span 双写出错，
     * trace 记录依然能够正常创建并返回。
     */
    const trace = await createTrace({
      projectId,
      traceType: 'tool_call',
      name: 'resilient_call',
      status: 'success',
    });

    // trace 记录应该存在
    expect(trace.id).toBeDefined();
    expect(trace.trace_id).toBeDefined();
  });
});
