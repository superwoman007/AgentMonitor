import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // 数据库类型：'sqlite' | 'postgres'
  dbType: (process.env.DB_TYPE || 'sqlite') as 'sqlite' | 'postgres',
  
  database: {
    // SQLite 配置
    sqlitePath: process.env.SQLITE_PATH || './data/agentmonitor.db',
    
    // PostgreSQL 配置
    url: process.env.DATABASE_URL,
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: process.env.PG_DATABASE || 'agentmonitor',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  
  api: {
    prefix: process.env.NODE_ENV === 'test' ? '/api' : '/api/v1',
  },
};

export type Config = typeof config;
