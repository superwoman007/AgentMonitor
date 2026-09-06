import { afterAll } from 'vitest';
import { unlinkSync } from 'fs';

// Set these at module evaluation time, before application modules read config.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'sqlite:./test.db';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
process.env.PORT = '3001';
// Do not inherit developer .env overrides; rate-limit tests rely on production defaults.
process.env.RATE_LIMIT_MAX = '100';
process.env.RATE_LIMIT_AUTH_MAX = '5';

afterAll(() => {
  // 清理测试数据库
  try {
    unlinkSync('./test.db');
  } catch (e) {
    // 忽略文件不存在的错误
  }
});
