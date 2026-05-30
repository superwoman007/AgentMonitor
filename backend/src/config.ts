import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Production startup validation
if (isProduction) {
  const required = ['JWT_SECRET', 'CORS_ORIGINS'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`);
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
}

function parseCorsOrigins(): string[] | true {
  const origins = process.env.CORS_ORIGINS;
  if (origins) {
    return origins.split(',').map(o => o.trim()).filter(Boolean);
  }
  // Development: allow all origins
  if (!isProduction) {
    return true;
  }
  // Production without CORS_ORIGINS: deny all cross-origin (should not reach here due to validation above)
  return [];
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  isProduction,

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
    ssl: isProduction ? (process.env.DB_SSL !== 'false') : false,

    // Connection pool
    poolMax: parseInt(process.env.DB_POOL_MAX || '20', 10),
    poolIdleTimeout: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || (isProduction ? '2h' : '7d'),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  cors: {
    origins: parseCorsOrigins(),
  },

  rateLimit: {
    global: {
      max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
      timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
    },
    auth: {
      max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '5', 10),
      timeWindow: process.env.RATE_LIMIT_AUTH_WINDOW || '15 minutes',
    },
  },

  ws: {
    maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS || '1000', 10),
    maxConnectionsPerUser: parseInt(process.env.WS_MAX_PER_USER || '10', 10),
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000', 10),
    connectionTimeout: parseInt(process.env.WS_CONNECTION_TIMEOUT || '300000', 10),
  },

  api: {
    prefix: process.env.NODE_ENV === 'test' ? '/api' : '/api/v1',
    maxLimit: parseInt(process.env.API_MAX_LIMIT || '1000', 10),
  },

  security: {
    passwordMinLength: 12,
    passwordRequireUppercase: true,
    passwordRequireNumber: true,
    passwordRequireSpecial: true,
    apiKeyExpirationDays: parseInt(process.env.API_KEY_EXPIRATION_DAYS || '90', 10),
  },
};

export type Config = typeof config;
