/**
 * Decision, Feedback & Alert round-trip tests
 * Validates:
 * 1. Decision reporting via SDK → querying via API
 * 2. Feedback collection via SDK → querying via API
 * 3. Alert creation and existence
 * 4. Alert triggering via trace + check endpoint
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentMonitor } from '../../sdk/src/index.js';
import {
  initTestContext,
  delay,
  type TestContext,
} from './helpers.js';

const API_URL = process.env.API_URL || 'http://localhost:3000';

describe('Decision, Feedback & Alert round-trip tests', () => {
  let ctx: TestContext;
  let monitor: AgentMonitor;

  beforeAll(async () => {
    ctx = await initTestContext();
    monitor = new AgentMonitor({
      apiKey: ctx.apiKey,
      baseUrl: API_URL,
      flushInterval: 1000,
      bufferSize: 10,
    });
  });

  afterAll(() => {
    monitor.close();
  });

  it('Decision round-trip: SDK trackDecision → API query', async () => {
    const sessionId = `session_${Date.now()}`;
    const decisionData = {
      projectId: ctx.projectId,
      sessionId,
      decisionType: 'model_selection',
      context: { task: 'code_review', language: 'typescript' },
      selectedOption: 'gpt-4',
      confidence: 0.92,
      reasoning: 'Complex reasoning task requires stronger model capabilities',
      decisionMaker: 'llm' as const,
      latencyMs: 145,
      options: [
        { name: 'gpt-4', score: 0.92, pros: ['high accuracy', 'strong reasoning'], cons: ['higher cost'] },
        { name: 'gpt-3.5-turbo', score: 0.70, pros: ['faster', 'cheaper'], cons: ['less capable'] },
      ],
    };

    await monitor.trackDecision(decisionData);
    await delay(800);

    const res = await fetch(`${API_URL}/api/v1/projects/${ctx.projectId}/decisions`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    expect(res.status).toBe(200);
    const decisions = await res.json() as any[];
    expect(decisions.length).toBeGreaterThanOrEqual(1);

    const found = decisions.find(
      (d: any) =>
        d.decision_type === 'model_selection' &&
        d.selected_option === 'gpt-4',
    );
    expect(found).toBeDefined();
    expect(found.confidence).toBe(0.92);
    expect(found.reasoning).toBe('Complex reasoning task requires stronger model capabilities');
    expect(found.decision_maker).toBe('llm');
    expect(found.latency_ms).toBe(145);
    expect(found.options).toBeDefined();
    expect(found.options.length).toBe(2);

    const gpt4Opt = found.options.find((o: any) => o.option_name === 'gpt-4');
    expect(gpt4Opt).toBeDefined();
    expect(gpt4Opt.score).toBe(0.92);
  });

  it('Feedback round-trip: SDK collectFeedback → API query', async () => {
    const feedbackData = {
      sessionId: `session_${Date.now()}`,
      messageId: `msg_${Date.now()}`,
      rating: 1,
      reason: 'helpful',
      comment: 'The response was accurate and well-structured',
      dimensions: { accuracy: 5, relevance: 4, clarity: 5 },
    };

    await monitor.collectFeedback(feedbackData);
    await delay(800);

    const res = await fetch(`${API_URL}/api/v1/feedbacks?projectId=${ctx.projectId}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { feedbacks: any[] };
    expect(data.feedbacks).toBeDefined();
    expect(data.feedbacks.length).toBeGreaterThanOrEqual(1);

    const found = data.feedbacks.find(
      (f: any) =>
        f.reason === 'helpful' &&
        f.comment === 'The response was accurate and well-structured',
    );
    expect(found).toBeDefined();
    expect(found.rating).toBe(1);
    expect(found.dimensions).toEqual({ accuracy: 5, relevance: 4, clarity: 5 });
  });

  it('Alert creation: create rule via API and verify existence', async () => {
    const alertBody = {
      projectId: ctx.projectId,
      name: 'Error Rate Alert',
      type: 'error_rate',
      condition: 'gt',
      threshold: 0.05,
      enabled: true,
    };

    const createRes = await fetch(`${API_URL}/api/v1/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.token}`,
      },
      body: JSON.stringify(alertBody),
    });
    expect(createRes.status).toBe(201);
    const createData = (await createRes.json()) as { alert: any };
    expect(createData.alert).toBeDefined();
    expect(createData.alert.name).toBe('Error Rate Alert');
    expect(createData.alert.type).toBe('error_rate');
    expect(createData.alert.condition).toBe('gt');
    expect(createData.alert.threshold).toBe(0.05);
    expect(createData.alert.enabled).toBe(true);

    const listRes = await fetch(`${API_URL}/api/v1/alerts?projectId=${ctx.projectId}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { alerts: any[]; history: any[] };
    expect(listData.alerts).toBeDefined();
    expect(listData.alerts.some((a: any) => a.id === createData.alert.id)).toBe(true);
  });

  it('Alert triggering: trace matching condition triggers alert', async () => {
    // Create a low-threshold latency alert
    const alertBody = {
      projectId: ctx.projectId,
      name: 'Latency Spike Alert',
      type: 'latency',
      condition: 'gt',
      threshold: 1,
      enabled: true,
    };

    const createRes = await fetch(`${API_URL}/api/v1/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.token}`,
      },
      body: JSON.stringify(alertBody),
    });
    expect(createRes.status).toBe(201);
    const createdAlert = ((await createRes.json()) as { alert: any }).alert;

    // Send a high-latency trace via SDK
    await monitor.trace({
      traceType: 'function',
      name: 'slow_operation',
      latencyMs: 5000,
      status: 'success',
      input: { payload: 'test' },
      output: { result: 'completed' },
    });
    await monitor.flush();
    await delay(1500);

    // Trigger alert evaluation
    const checkRes = await fetch(`${API_URL}/api/v1/alerts/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.token}`,
      },
      body: JSON.stringify({ projectId: ctx.projectId }),
    });
    expect(checkRes.status).toBe(200);
    const checkData = (await checkRes.json()) as { triggered: any[] };
    expect(checkData.triggered).toBeDefined();
    expect(checkData.triggered.length).toBeGreaterThanOrEqual(1);

    const ourTrigger = checkData.triggered.find(
      (t: any) => t.alertId === createdAlert.id,
    );
    expect(ourTrigger).toBeDefined();
    expect(ourTrigger.alertType).toBe('latency');
    expect(ourTrigger.actual).toBeGreaterThan(1);

    // Verify alert history via GET /alerts
    const listRes = await fetch(`${API_URL}/api/v1/alerts?projectId=${ctx.projectId}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { alerts: any[]; history: any[] };
    expect(listData.history).toBeDefined();
    expect(listData.history.length).toBeGreaterThanOrEqual(1);
    expect(listData.history.some((h: any) => h.alertId === createdAlert.id)).toBe(true);

    // Verify alert lastTriggered was updated
    const alertInList = listData.alerts.find((a: any) => a.id === createdAlert.id);
    expect(alertInList).toBeDefined();
    expect(alertInList.lastTriggered).not.toBeNull();
  });
});
