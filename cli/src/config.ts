import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

/**
 * CLI 配置文件结构。
 */
export interface CliConfig {
  version: 1;
  currentProfile: string;
  profiles: Record<
    string,
    {
      baseUrl: string;
      projectId: string;
      tokenEnv: string;
    }
  >;
}

const DEFAULT_CONFIG_PATH = join(homedir(), '.agentmonitor', 'config.yaml');

/**
 * 获取配置文件路径（支持 AGENTMONITOR_CONFIG 覆盖）。
 */
export function getConfigPath(): string {
  return process.env.AGENTMONITOR_CONFIG || DEFAULT_CONFIG_PATH;
}

/**
 * 加载配置；不存在时返回空配置。
 */
export function loadConfig(path = getConfigPath()): CliConfig {
  if (!existsSync(path)) {
    return { version: 1, currentProfile: 'default', profiles: {} };
  }
  const raw = readFileSync(path, 'utf-8');
  return parseYaml(raw);
}

/**
 * 保存配置到磁盘。
 */
export function saveConfig(config: CliConfig, path = getConfigPath()): void {
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, serializeYaml(config), 'utf-8');
}

/**
 * 获取当前 profile；若未设置或不存在返回 null。
 */
export function getCurrentProfile(config: CliConfig): CliConfig['profiles'][string] | null {
  const name = config.currentProfile;
  return config.profiles[name] ?? null;
}

/**
 * 从环境变量或 profile 中解析 Token。
 * 优先级：--token 参数 > AGENTMONITOR_TOKEN > profile.tokenEnv 指定的环境变量。
 */
export function resolveToken(
  profile: CliConfig['profiles'][string] | null,
  explicit?: string
): string | null {
  if (explicit) return explicit;
  if (process.env.AGENTMONITOR_TOKEN) return process.env.AGENTMONITOR_TOKEN;
  if (profile?.tokenEnv && process.env[profile.tokenEnv]) {
    return process.env[profile.tokenEnv] as string;
  }
  return null;
}

/**
 * 极简 YAML 解析器：仅支持 CLI 配置所需的两层结构。
 * 避免引入 js-yaml 依赖。
 */
function parseYaml(raw: string): CliConfig {
  const lines = raw.split(/\r?\n/);
  const config: CliConfig = {
    version: 1,
    currentProfile: 'default',
    profiles: {},
  };
  let currentProfile: string | null = null;
  let inProfiles = false;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent === 0) {
      if (trimmed.startsWith('version:')) {
        config.version = Number(trimmed.slice('version:'.length).trim()) as 1;
      } else if (trimmed.startsWith('currentProfile:')) {
        config.currentProfile = trimmed.slice('currentProfile:'.length).trim();
      } else if (trimmed.startsWith('profiles:')) {
        inProfiles = true;
      } else {
        inProfiles = false;
      }
      continue;
    }

    if (inProfiles && indent === 2) {
      if (trimmed.endsWith(':')) {
        currentProfile = trimmed.slice(0, -1).trim();
        config.profiles[currentProfile] = { baseUrl: '', projectId: '', tokenEnv: 'AGENTMONITOR_TOKEN' };
      }
      continue;
    }

    if (inProfiles && indent >= 4 && currentProfile) {
      const idx = trimmed.indexOf(':');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        const profile = config.profiles[currentProfile];
        if (key === 'baseUrl') profile.baseUrl = value;
        else if (key === 'projectId') profile.projectId = value;
        else if (key === 'tokenEnv') profile.tokenEnv = value;
      }
    }
  }
  return config;
}

function serializeYaml(config: CliConfig): string {
  const lines: string[] = [];
  lines.push(`version: ${config.version}`);
  lines.push(`currentProfile: ${config.currentProfile}`);
  lines.push('profiles:');
  for (const [name, p] of Object.entries(config.profiles)) {
    lines.push(`  ${name}:`);
    lines.push(`    baseUrl: ${p.baseUrl}`);
    lines.push(`    projectId: ${p.projectId}`);
    lines.push(`    tokenEnv: ${p.tokenEnv}`);
  }
  return lines.join('\n') + '\n';
}
