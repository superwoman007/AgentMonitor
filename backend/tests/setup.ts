import { beforeAll, afterAll } from 'vitest';
import { unlinkSync } from 'fs';

// 全局测试环境设置
beforeAll(() => {
  // 设置测试环境变量
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'sqlite:./test.db';
  process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
  process.env.PORT = '3001'; // 避免端口冲突
});

afterAll(() => {
  // 清理测试数据库
  try {
    unlinkSync('./test.db');
  } catch (e) {
    // 忽略文件不存在的错误
  }
});
