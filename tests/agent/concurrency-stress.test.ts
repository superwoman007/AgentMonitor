/**
 * Concurrency stress test: multiple Agents report traces concurrently without data loss
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentMonitor } from '../../sdk/src/index.js';
import {
  initTestContext,
  getTraces,
  getSessions,
  delay,
  type TestContext,
} from './helpers.js';

describe('concurrency stress', () => {
  let ctx: TestContext;
  const monitors: AgentMonitor[] = [];

  beforeAll(async () => {
    ctx = await initTestContext();
  });

  afterAll(() => {
    monitors.forEach(m => m.close());
  });

  it(
    'concurrent agents: 5 parallel instances each send 20 traces, all persisted',
    async () => {
      const agentCount = 5;
      const tracesPerAgent = 20;
      const expectedTotal = agentCount * tracesPerAgent; // 100

      const agents = Array.from({ length: agentCount }).map((_, i) => {
        const monitor = new AgentMonitor({
          apiKey: ctx.apiKey,
          baseUrl: 'http://localhost:3000',
          flushInterval: 999_999,
          bufferSize: 999_999,
          sampleRate: 1,
          enableBreakpoints: false,
        });
        monitors.push(monitor);
        return { monitor, sessionId: `stress-session-${i}-${Date.now()}` };
      });

      // Launch all agents in parallel
      await Promise.all(
        agents.map(async ({ monitor, sessionId }) => {
          monitor.startSession(sessionId);

          const tasks: Promise<void>[] = [];
          for (let j = 0; j < tracesPerAgent; j++) {
            const mod = j % 3;
            if (mod === 0) {
              tasks.push(
                monitor.trackMessage({
                  sessionId,
                  role: 'user',
                  content: `msg-${sessionId}-${j}`,
                })
              );
            } else if (mod === 1) {
              tasks.push(
                monitor.traceLLM(
                  'gpt-4',
                  { model: 'gpt-4', messages: [{ role: 'user', content: `prompt-${sessionId}-${j}` }] },
                  {
                    choices: [{ message: { content: `resp-${sessionId}-${j}` } }],
                    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
                  },
                  100,
                  true
                )
              );
            } else {
              tasks.push(
                monitor.trackToolCall({
                  id: `tool-${sessionId}-${j}`,
                  sessionId,
                  toolName: 'search',
                  inputParams: { q: `query-${sessionId}-${j}` },
                  output: { result: `ok-${sessionId}-${j}` },
                  latencyMs: 50,
                })
              );
            }
          }

          await Promise.all(tasks);
          await monitor.endSession(sessionId);
        })
      );

      // Flush all monitors concurrently
      await Promise.all(agents.map(({ monitor }) => monitor.flush()));

      // Give backend a moment to persist
      await delay(1000);

      const traces = await getTraces(ctx.token, ctx.projectId);
      expect(traces.length).toBeGreaterThanOrEqual(expectedTotal);
    },
    30_000
  );

  it(
    'rapid session churn: 10 sessions with 5 messages each, all sessions exist',
    async () => {
      const sessionCount = 10;
      const messagesPerSession = 5;
      const expectedMessages = sessionCount * messagesPerSession; // 50

      const monitor = new AgentMonitor({
        apiKey: ctx.apiKey,
        baseUrl: 'http://localhost:3000',
        flushInterval: 999_999,
        bufferSize: 999_999,
        sampleRate: 1,
        enableBreakpoints: false,
      });
      monitors.push(monitor);

      const sessionIds: string[] = [];

      // Rapidly create sessions and send messages concurrently across sessions
      await Promise.all(
        Array.from({ length: sessionCount }).map(async (_, i) => {
          const sessionId = `churn-session-${i}-${Date.now()}`;
          sessionIds.push(sessionId);
          monitor.startSession(sessionId);

          const tasks: Promise<void>[] = [];
          for (let j = 0; j < messagesPerSession; j++) {
            tasks.push(
              monitor.trackMessage({
                sessionId,
                role: j % 2 === 0 ? 'user' : 'assistant',
                content: `churn-msg-${sessionId}-${j}`,
              })
            );
          }

          await Promise.all(tasks);
          await monitor.endSession(sessionId);
        })
      );

      await monitor.flush();
      await delay(1000);

      // Verify all sessions exist in backend
      const sessions = await getSessions(ctx.apiKey, ctx.projectId);
      const sessionIdsSet = new Set(sessions.map((s: any) => s.id || s.session_id));
      for (const sid of sessionIds) {
        expect(sessionIdsSet.has(sid)).toBe(true);
      }

      // Verify total message traces >= 50
      const traces = await getTraces(ctx.token, ctx.projectId);
      const messageTraces = traces.filter((t: any) => t.trace_type === 'message');
      expect(messageTraces.length).toBeGreaterThanOrEqual(expectedMessages);
    },
    30_000
  );
});
