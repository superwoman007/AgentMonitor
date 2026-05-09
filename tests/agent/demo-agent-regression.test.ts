/**
 * Layer 4 测试：Demo Agent 自动化回归
 * 验证 demo-agent 产生的 trace 能完整上报到后端
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { promisify } from 'util';
import {
  initTestContext,
  getTraces,
  getSessions,
  delay,
  type TestContext,
} from './helpers.js';

const execAsync = promisify(require('child_process').exec);

describe('Layer 4: Demo Agent 自动化回归', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await initTestContext();
  });

  it('运行完整 Demo Agent 并验证 traces 上报完整性', async () => {
    // 运行 demo-agent
    const demoPath = new URL('../../demo-agent/src/index.ts', import.meta.url).pathname;
    const env = {
      ...process.env,
      MONITOR_API_KEY: ctx.apiKey,
      MONITOR_API_URL: 'http://localhost:3000',
      NODE_ENV: 'test',
    };

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('npx', ['tsx', demoPath], {
        env,
        cwd: new URL('../../demo-agent', import.meta.url).pathname,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Demo agent exited with code ${code}. stderr: ${stderr}`));
        } else {
          resolve();
        }
      });

      proc.on('error', reject);

      // 超时保护 30 秒
      setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Demo agent timed out after 30s'));
      }, 30_000);
    });

    // 等待后端处理（trace flush 有间隔）
    await delay(3000);

    // 查询 sessions
    const sessions = await getSessions(ctx.apiKey, ctx.projectId);
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    // 查询所有 traces
    const traces = await getTraces(ctx.token, ctx.projectId);
    expect(traces.length).toBeGreaterThanOrEqual(6);

    // 验证 trace 类型分布
    const types = traces.reduce((acc: Record<string, number>, t: any) => {
      acc[t.trace_type] = (acc[t.trace_type] || 0) + 1;
      return acc;
    }, {});

    // 消息 trace（user + assistant）
    expect(types['message']).toBeGreaterThanOrEqual(2);

    // 工具调用 trace（checkWeather, getOrderStatus, failingTool, slowOrderCheck）
    expect(types['function']).toBeGreaterThanOrEqual(3);

    // LLM trace（mock-llm）
    expect(types['llm']).toBeGreaterThanOrEqual(1);

    // 决策 trace
    expect(types['decision']).toBeGreaterThanOrEqual(1);

    // 验证至少有一条成功 trace
    const successTraces = traces.filter((t: any) => t.status === 'success');
    expect(successTraces.length).toBeGreaterThanOrEqual(1);

    // 验证错误 trace（failingTool 故意触发）
    const errorTraces = traces.filter((t: any) => t.status === 'error');
    expect(errorTraces.length).toBeGreaterThanOrEqual(1);
    expect(errorTraces.some((t: any) => t.error?.includes('故意触发') || t.name === 'failingTool')).toBe(true);

    // 验证 latency 字段存在（慢查询应该有较大的 latency）
    const slowTrace = traces.find((t: any) => t.name === 'slowOrderCheck');
    if (slowTrace) {
      expect(slowTrace.latency_ms).toBeGreaterThanOrEqual(4000);
    }

    // 调试：如果断言失败，打印 traces 内容
    if (types['message'] === 0 || types['function'] === 0) {
      console.log('Traces debug:', JSON.stringify(traces.map((t: any) => ({
        type: t.trace_type,
        name: t.name,
        status: t.status,
        input: typeof t.input === 'string' ? JSON.parse(t.input) : t.input,
      })), null, 2));
    }

    // 验证消息内容完整性
    const tracesWithParsedInput = traces.map((t: any) => ({
      ...t,
      input: typeof t.input === 'string' ? JSON.parse(t.input) : t.input,
    }));
    const userMessages = tracesWithParsedInput.filter((t: any) => t.trace_type === 'message' && t.input?.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(1);
  });
});
