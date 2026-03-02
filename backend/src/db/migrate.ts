// 数据库迁移
import { config } from '../config.js';
import { getDb } from './index.js';

export async function runMigrations(): Promise<void> {
  console.log(`Database type: ${config.dbType}`);
  
  if (config.dbType === 'sqlite') {
    // SQLite 的 schema 在 sqlite.ts 初始化时自动创建
    await getDb(); // 触发初始化
    console.log('✅ SQLite database ready');
  } else {
    // PostgreSQL 迁移
    const { runPostgresMigrations } = await import('./postgres-migrate.js');
    await runPostgresMigrations();
  }
}
