-- 决策表
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY DEFAULT ('decision_' || lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  session_id TEXT,
  decision_type TEXT NOT NULL,
  context TEXT, -- JSON
  selected_option TEXT NOT NULL,
  confidence REAL, -- 0-1
  reasoning TEXT,
  decision_maker TEXT, -- 'rule' | 'llm' | 'human' | 'hybrid'
  latency_ms REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT, -- JSON
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- 决策选项表
CREATE TABLE IF NOT EXISTS decision_options (
  id TEXT PRIMARY KEY DEFAULT ('option_' || lower(hex(randomblob(16)))),
  decision_id TEXT NOT NULL,
  option_name TEXT NOT NULL,
  score REAL, -- 0-1
  pros TEXT, -- JSON array
  cons TEXT, -- JSON array
  metadata TEXT, -- JSON
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(decision_type);
CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at);
CREATE INDEX IF NOT EXISTS idx_decision_options_decision ON decision_options(decision_id);
