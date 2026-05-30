import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Config Security', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('开发环境应使用默认 JWT secret', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('JWT_SECRET', '');
    const { config } = await import('../../src/config');
    expect(config.jwt.secret).toBe('dev-secret-change-in-production');
  });

  it('生产环境缺少 JWT_SECRET 应抛出错误', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', '');
    await expect(import('../../src/config')).rejects.toThrow(/JWT_SECRET/);
  });

  it('生产环境设置了 JWT_SECRET 应正常加载', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'my-secure-production-secret-key-123');
    vi.stubEnv('CORS_ORIGINS', 'https://example.com');
    const { config } = await import('../../src/config');
    expect(config.jwt.secret).toBe('my-secure-production-secret-key-123');
  });

  it('CORS_ORIGINS 应正确解析为数组', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CORS_ORIGINS', 'https://app.example.com,https://admin.example.com');
    const { config } = await import('../../src/config');
    expect(config.cors.origins).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('开发环境无 CORS_ORIGINS 应允许 localhost', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CORS_ORIGINS', '');
    const { config } = await import('../../src/config');
    expect(config.cors.origins).toEqual(true);
  });

  it('连接池配置应可通过环境变量覆盖', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DB_POOL_MAX', '50');
    vi.stubEnv('DB_POOL_IDLE_TIMEOUT', '60000');
    const { config } = await import('../../src/config');
    expect(config.database.poolMax).toBe(50);
    expect(config.database.poolIdleTimeout).toBe(60000);
  });
});
