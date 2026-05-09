import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Helper to create temp directory
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
}

// We will test the CLI by importing the command handlers directly
// rather than spawning child processes

const globalAny = global as Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CLI Tool', () => {
  describe('init command', () => {
    it('should create agentmonitor.yaml with default values', async () => {
      const tmpDir = createTempDir();
      const configPath = path.join(tmpDir, 'agentmonitor.yaml');

      const { initConfig } = await import('../src/commands/init.js');
      await initConfig({
        projectName: 'Test Project',
        apiKey: 'test-api-key',
        baseUrl: 'http://localhost:3000',
        outputPath: configPath,
      });

      expect(fs.existsSync(configPath)).toBe(true);
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('project_name: Test Project');
      expect(content).toContain('api_key: test-api-key');
      expect(content).toContain('base_url: http://localhost:3000');

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe('scan command', () => {
    it('should detect OpenAI SDK usage in source files', async () => {
      const tmpDir = createTempDir();
      fs.writeFileSync(path.join(tmpDir, 'app.ts'), `
        import OpenAI from 'openai';
        const client = new OpenAI({ apiKey: 'sk-xxx' });
        async function main() {
          const res = await client.chat.completions.create({ model: 'gpt-4', messages: [] });
          console.log(res);
        }
      `);
      fs.writeFileSync(path.join(tmpDir, 'helper.js'), `
        // some helper without OpenAI
        export function foo() { return 1; }
      `);

      const { scanProject } = await import('../src/commands/scan.js');
      const result = await scanProject(tmpDir);

      expect(result.detections.length).toBeGreaterThan(0);
      expect(result.detections.some((d: any) => d.file.includes('app.ts'))).toBe(true);
      expect(result.detections.some((d: any) => d.type === 'openai')).toBe(true);

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should detect LangChain usage', async () => {
      const tmpDir = createTempDir();
      fs.writeFileSync(path.join(tmpDir, 'agent.ts'), `
        import { OpenAI } from 'langchain/llms/openai';
        import { LLMChain } from 'langchain/chains';
        const model = new OpenAI({ temperature: 0.9 });
      `);

      const { scanProject } = await import('../src/commands/scan.js');
      const result = await scanProject(tmpDir);

      expect(result.detections.some((d: any) => d.type === 'langchain')).toBe(true);

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe('install command', () => {
    it('should insert autoInstrument into entry file', async () => {
      const tmpDir = createTempDir();
      const entryFile = path.join(tmpDir, 'index.ts');
      fs.writeFileSync(entryFile, `
import express from 'express';
const app = express();
app.listen(3000);
`);

      const { installInstrumentation } = await import('../src/commands/install.js');
      await installInstrumentation({
        entryFile,
        sdkImport: "import { AgentMonitor } from '@agentmonitor/sdk';",
        instrumentCode: 'AgentMonitor.init({ apiKey: process.env.MONITOR_API_KEY }).autoInstrument({ openAIInstance: openai });',
      });

      const content = fs.readFileSync(entryFile, 'utf-8');
      expect(content).toContain('@agentmonitor/sdk');
      expect(content).toContain('AgentMonitor.init');
      expect(content).toContain('autoInstrument');

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should not double-insert if already present', async () => {
      const tmpDir = createTempDir();
      const entryFile = path.join(tmpDir, 'index.ts');
      fs.writeFileSync(entryFile, `
import { AgentMonitor } from '@agentmonitor/sdk';
const monitor = AgentMonitor.init({ apiKey: 'test' });
monitor.autoInstrument({});
`);

      const { installInstrumentation } = await import('../src/commands/install.js');
      await installInstrumentation({
        entryFile,
        sdkImport: "import { AgentMonitor } from '@agentmonitor/sdk';",
        instrumentCode: 'AgentMonitor.init({ apiKey: process.env.MONITOR_API_KEY }).autoInstrument({});',
      });

      const content = fs.readFileSync(entryFile, 'utf-8');
      const matches = content.match(/AgentMonitor/g);
      expect(matches?.length).toBe(2); // import + init, not duplicated

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe('eval command', () => {
    it('should return exit code 0 on passing eval', async () => {
      globalAny.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, passed: 5, failed: 0 }),
      } as Response);

      const { runEval } = await import('../src/commands/eval.js');
      const result = await runEval({
        baseUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        datasetId: 'ds-001',
        promptId: 'prompt-001',
      });

      expect(result.exitCode).toBe(0);
      expect(result.passed).toBe(5);
      expect(result.failed).toBe(0);
    });

    it('should return exit code 1 on failing eval', async () => {
      globalAny.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, passed: 3, failed: 2 }),
      } as Response);

      const { runEval } = await import('../src/commands/eval.js');
      const result = await runEval({
        baseUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        datasetId: 'ds-001',
        promptId: 'prompt-001',
      });

      expect(result.exitCode).toBe(1);
      expect(result.passed).toBe(3);
      expect(result.failed).toBe(2);
    });
  });

  describe('status command', () => {
    it('should return today stats', async () => {
      globalAny.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          stats: {
            totalRequests: 100,
            successRate: 0.95,
            avgLatency: 234,
            todayTraces: 42,
          },
        }),
      } as Response);

      const { getStatus } = await import('../src/commands/status.js');
      const result = await getStatus({
        baseUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      expect(result.totalRequests).toBe(100);
      expect(result.successRate).toBe(0.95);
      expect(result.todayTraces).toBe(42);
    });
  });

  describe('export command', () => {
    it('should export traces to JSON file', async () => {
      globalAny.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          traces: [
            { id: 't1', name: 'test', status: 'success' },
            { id: 't2', name: 'test2', status: 'error' },
          ],
        }),
      } as Response);

      const tmpDir = createTempDir();
      const outputPath = path.join(tmpDir, 'traces.json');

      const { exportTraces } = await import('../src/commands/export.js');
      await exportTraces({
        baseUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        since: '2026-04-01',
        format: 'json',
        outputPath,
      });

      expect(fs.existsSync(outputPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(content.traces).toHaveLength(2);

      fs.rmSync(tmpDir, { recursive: true });
    });
  });
});
