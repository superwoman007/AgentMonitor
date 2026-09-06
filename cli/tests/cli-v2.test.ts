import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig, saveConfig } from '../src/config.js';

function tmpConfig(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmonitor-cli-'));
  return path.join(dir, 'config.yaml');
}

describe('PR-10 CLI profile config', () => {
  beforeEach(() => {
    delete process.env.AGENTMONITOR_CONFIG;
    delete process.env.AGENTMONITOR_TOKEN;
  });

  it('loads empty config when file does not exist', () => {
    const cfg = loadConfig('/nonexistent/path/config.yaml');
    expect(cfg.version).toBe(1);
    expect(cfg.currentProfile).toBe('default');
    expect(cfg.profiles).toEqual({});
  });

  it('round-trips a profile through save/load', () => {
    const configPath = tmpConfig();
    process.env.AGENTMONITOR_CONFIG = configPath;
    const cfg = loadConfig(configPath);
    cfg.profiles.staging = {
      baseUrl: 'https://monitor.example.com',
      projectId: 'project_123',
      tokenEnv: 'AGENTMONITOR_TOKEN',
    };
    cfg.currentProfile = 'staging';
    saveConfig(cfg, configPath);

    const reloaded = loadConfig(configPath);
    expect(reloaded.currentProfile).toBe('staging');
    expect(reloaded.profiles.staging.baseUrl).toBe('https://monitor.example.com');
    expect(reloaded.profiles.staging.projectId).toBe('project_123');
  });
});

describe('PR-10 CLI eval commands', () => {
  it('evalGate returns 0 when pass rate meets threshold', async () => {
    const { evalGate, EXIT_CODES } = await import('../src/commands/eval-v2.js');
    const client = {
      get: vi.fn().mockResolvedValue({
        run: {
          id: 'r1',
          status: 'completed',
          summary: { totalItems: 10, passedItems: 10, failedItems: 0, avgScore: 1, avgLatencyMs: 50 },
        },
      }),
    } as unknown as import('../src/api-client.js').ApiClient;
    const code = await evalGate({ client, runId: 'r1', minPassRate: 0.9 });
    expect(code).toBe(EXIT_CODES.OK);
  });

  it('evalGate returns 1 when pass rate below threshold', async () => {
    const { evalGate, EXIT_CODES } = await import('../src/commands/eval-v2.js');
    const client = {
      get: vi.fn().mockResolvedValue({
        run: {
          id: 'r1',
          status: 'completed',
          summary: { totalItems: 10, passedItems: 5, failedItems: 5, avgScore: 0.5, avgLatencyMs: 50 },
        },
      }),
    } as unknown as import('../src/api-client.js').ApiClient;
    const code = await evalGate({ client, runId: 'r1', minPassRate: 0.9 });
    expect(code).toBe(EXIT_CODES.GATE_FAILED);
  });

  it('evalWait polls until Run completes', async () => {
    vi.useFakeTimers();
    const { evalWait, EXIT_CODES } = await import('../src/commands/eval-v2.js');
    const calls = [
      { run: { id: 'r1', status: 'queued', summary: { totalItems: 1, passedItems: 0, failedItems: 0, completedItems: 0, avgScore: null, avgLatencyMs: null } } },
      { run: { id: 'r1', status: 'running', summary: { totalItems: 1, passedItems: 0, failedItems: 0, completedItems: 1, avgScore: 1, avgLatencyMs: 50 } } },
      { run: { id: 'r1', status: 'completed', summary: { totalItems: 1, passedItems: 1, failedItems: 0, completedItems: 1, avgScore: 1, avgLatencyMs: 50 } } },
    ];
    const client = {
      get: vi.fn().mockImplementation(async () => calls.shift() ?? calls[calls.length - 1]),
    } as unknown as import('../src/api-client.js').ApiClient;

    const promise = evalWait({ client, runId: 'r1', timeoutSec: 5, json: true });
    // 推进定时器直到完成
    for (let i = 0; i < 10; i += 1) {
      await vi.advanceTimersByTimeAsync(1100);
    }
    const code = await promise;
    expect(code).toBe(EXIT_CODES.OK);
    vi.useRealTimers();
  });
});
