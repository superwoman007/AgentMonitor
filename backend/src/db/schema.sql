
-- AgentMonitor 数据库 Schema
-- PostgreSQL (TimescaleDB optional)

-- ============================================
-- 用户与认证表
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_hash VARCHAR(255) UNIQUE NOT NULL,
  prefix VARCHAR(20) NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 会话与消息表
-- ============================================

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id VARCHAR(255),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

CREATE TABLE IF NOT EXISTS tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  tool_name VARCHAR(100) NOT NULL,
  input_params JSONB NOT NULL,
  output JSONB,
  error TEXT,
  latency_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session_id ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_started_at ON tool_calls(started_at);

-- ============================================
-- 调用追踪表
-- ============================================

CREATE TABLE IF NOT EXISTS traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id VARCHAR(255),
  trace_type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  input JSONB,
  output JSONB,
  metadata JSONB,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  latency_ms INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traces_project_id ON traces(project_id);
CREATE INDEX IF NOT EXISTS idx_traces_session_id ON traces(session_id);
CREATE INDEX IF NOT EXISTS idx_traces_started_at ON traces(started_at);
CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status);

-- ============================================
-- 监控指标表
-- ============================================

CREATE TABLE IF NOT EXISTS metrics (
  timestamp TIMESTAMPTZ NOT NULL,
  project_id UUID NOT NULL,
  agent_id VARCHAR(255),
  metric_name VARCHAR(100) NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL,
  tags JSONB
);

CREATE INDEX IF NOT EXISTS idx_metrics_project_id ON metrics(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_metric_name ON metrics(metric_name, timestamp DESC);

-- ============================================
-- 断点与快照表
-- ============================================

CREATE TABLE IF NOT EXISTS breakpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL,
  condition TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  breakpoint_id UUID REFERENCES breakpoints(id),
  trigger_reason TEXT NOT NULL,
  state JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_session_id ON snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp);

-- ============================================
-- 告警规则表
-- ============================================

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL,
  condition TEXT NOT NULL,
  threshold DOUBLE PRECISION NOT NULL,
  enabled BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_project_id ON alerts(project_id);

CREATE TABLE IF NOT EXISTS alert_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_history_alert_id ON alert_history(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_project_id ON alert_history(project_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_triggered_at ON alert_history(triggered_at);

-- ============================================
-- 决策监控表
-- ============================================

CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  decision_type VARCHAR(100) NOT NULL,
  context JSONB,
  selected_option VARCHAR(255) NOT NULL,
  confidence DECIMAL(3,2),
  reasoning TEXT,
  decision_maker VARCHAR(20) NOT NULL,
  latency_ms INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decisions_project_id ON decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_session_id ON decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(decision_type);
CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at);

CREATE TABLE IF NOT EXISTS decision_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID REFERENCES decisions(id) ON DELETE CASCADE,
  option_name VARCHAR(255) NOT NULL,
  score DECIMAL(3,2),
  pros TEXT[],
  cons TEXT[],
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_options_decision_id ON decision_options(decision_id);
