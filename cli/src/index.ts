#!/usr/bin/env node
import { Command } from 'commander';
import { ApiClient } from './api-client.js';
import {
  loadConfig,
  saveConfig,
  getCurrentProfile,
  resolveToken,
  type CliConfig,
} from './config.js';
import { evalRun, evalWait, evalReport, evalGate } from './commands/eval-v2.js';
import { runnerStart } from './commands/runner.js';

/**
 * 解析 --profile/--token/--base-url 等全局选项，返回可用的 API 客户端。
 */
function resolveClient(program: Command): ApiClient {
  const opts = program.opts<{
    profile?: string;
    token?: string;
    baseUrl?: string;
    projectId?: string;
  }>();
  const config = loadConfig();
  if (opts.profile) {
    config.currentProfile = opts.profile;
  }
  const profile = getCurrentProfile(config);
  const baseUrl = opts.baseUrl || profile?.baseUrl || process.env.AGENTMONITOR_BASE_URL;
  const token = resolveToken(profile, opts.token);
  if (!baseUrl) {
    throw new Error('Missing baseUrl. Run `agentmonitor init` or pass --base-url.');
  }
  if (!token) {
    throw new Error(
      'Missing token. Run `agentmonitor init`, set AGENTMONITOR_TOKEN, or pass --token.'
    );
  }
  return new ApiClient({ baseUrl, token });
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name('agentmonitor')
    .description('AgentMonitor CLI — Agent evaluation, tracing and CI gate')
    .version('0.1.0')
    .option('-p, --profile <name>', 'profile name to use')
    .option('--base-url <url>', 'platform base URL')
    .option('--token <token>', 'Service Token or JWT')
    .option('--project-id <id>', 'project ID override');

  program
    .command('init')
    .description('create or update a CLI profile')
    .requiredOption('--base-url <url>', 'platform base URL')
    .requiredOption('--project-id <id>', 'default project ID')
    .option('--name <name>', 'profile name', 'default')
    .option('--token-env <name>', 'environment variable holding the token', 'AGENTMONITOR_TOKEN')
    .action((options: { baseUrl: string; projectId: string; name: string; tokenEnv: string }) => {
      const config = loadConfig();
      config.profiles[options.name] = {
        baseUrl: options.baseUrl,
        projectId: options.projectId,
        tokenEnv: options.tokenEnv,
      };
      config.currentProfile = options.name;
      saveConfig(config);
      process.stdout.write(`Profile "${options.name}" saved.\n`);
    });

  program
    .command('doctor')
    .description('check CLI configuration and connectivity')
    .action(async () => {
      try {
        const client = resolveClient(program);
        const res = await client.get<{ status: string }>('/health');
        process.stdout.write(`Platform reachable: ${res.status}\n`);
      } catch (error) {
        process.stderr.write(`${(error as Error).message}\n`);
        process.exit(4);
      }
    });

  const evalCmd = program.command('eval').description('evaluation runs');

  evalCmd
    .command('run <experimentId>')
    .description('start a Run for an Experiment')
    .option('--wait', 'wait for Run completion', false)
    .option('--timeout <sec>', 'wait timeout in seconds', '600')
    .option('--json', 'emit machine-readable output', false)
    .action(async (experimentId: string, cmd: { wait: boolean; timeout: string; json: boolean }) => {
      try {
        const client = resolveClient(program);
        const code = await evalRun({
          client,
          experimentId,
          wait: cmd.wait,
          timeoutSec: Number(cmd.timeout),
          json: cmd.json,
        });
        process.exit(code);
      } catch (error) {
        process.stderr.write(`${(error as Error).message}\n`);
        process.exit(2);
      }
    });

  evalCmd
    .command('wait <runId>')
    .description('wait for a Run to finish')
    .option('--timeout <sec>', 'wait timeout in seconds', '600')
    .option('--json', 'emit machine-readable output', false)
    .action(async (runId: string, cmd: { timeout: string; json: boolean }) => {
      try {
        const client = resolveClient(program);
        process.exit(await evalWait({
          client,
          runId,
          timeoutSec: Number(cmd.timeout),
          json: cmd.json,
        }));
      } catch (error) {
        process.stderr.write(`${(error as Error).message}\n`);
        process.exit(2);
      }
    });

  evalCmd
    .command('report <runId>')
    .description('fetch Run report as JSON or JUnit XML')
    .option('-o, --output <file>', 'write output to file')
    .option('--junit', 'output JUnit XML instead of JSON')
    .action(async (runId: string, cmd: { output?: string; junit?: boolean }) => {
      try {
        const client = resolveClient(program);
        process.exit(await evalReport(client, runId, { output: cmd.output, junit: cmd.junit }));
      } catch (error) {
        process.stderr.write(`${(error as Error).message}\n`);
        process.exit(2);
      }
    });

  evalCmd
    .command('gate <runId>')
    .description('check quality gate for a Run')
    .option('--min-pass-rate <rate>', 'minimum pass rate (0-1)', '0.9')
    .action(async (runId: string, cmd: { minPassRate: string }) => {
      try {
        const client = resolveClient(program);
        process.exit(await evalGate({
          client,
          runId,
          minPassRate: Number(cmd.minPassRate),
        }));
      } catch (error) {
        process.stderr.write(`${(error as Error).message}\n`);
        process.exit(2);
      }
    });

  program
    .command('runner <runId>')
    .description('attach an external runner that invokes a local agent via STDIO NDJSON')
    .requiredOption('--command <cmd...>', 'command to start the local agent')
    .option('--runner-id <id>', 'runner identifier for logs')
    .option('--timeout <ms>', 'per-sample timeout in milliseconds', '60000')
    .action(
      async (
        runId: string,
        cmd: { command: string[]; runnerId?: string; timeout: string }
      ) => {
        try {
          const client = resolveClient(program);
          process.exit(
            await runnerStart({
              client,
              runId,
              command: cmd.command,
              runnerId: cmd.runnerId,
              timeoutMs: Number(cmd.timeout),
            })
          );
        } catch (error) {
          process.stderr.write(`${(error as Error).message}\n`);
          process.exit(2);
        }
      }
    );

  return program;
}

const program = buildProgram();
program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(2);
});

// 导出便于测试
export { buildProgram, type CliConfig };
