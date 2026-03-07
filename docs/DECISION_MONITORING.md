# 决策层监控功能 (Decision Monitoring)

## 功能概述

决策层监控是 AgentMonitor v1.0.3 新增的核心功能，用于追踪和分析 AI Agent 的决策过程。

## 核心特性

### 1. 决策追踪
- 记录每个决策的完整上下文
- 支持多个备选方案的对比
- 记录决策置信度和推理过程
- 区分决策来源（规则/LLM/人工/混合）

### 2. 决策分析
- 实时统计决策数量和平均置信度
- 按决策类型和决策者分类统计
- 计算平均决策延迟
- 24小时内决策趋势

### 3. 可视化展示
- 时间轴视图展示决策流程
- 决策详情弹窗查看完整信息
- 统计卡片展示关键指标
- 支持按会话和项目筛选

## 数据模型

### Decision (决策)
```typescript
interface Decision {
  id: string;
  project_id: string;
  session_id?: string;
  decision_type: string;        // 决策类型（如：model_selection, parameter_tuning）
  context?: object;              // 决策上下文
  selected_option: string;       // 选中的方案
  confidence?: number;           // 置信度 (0-1)
  reasoning?: string;            // 推理过程
  decision_maker: 'rule' | 'llm' | 'human' | 'hybrid';
  latency_ms?: number;           // 决策耗时
  metadata?: object;
  created_at: string;
}
```

### DecisionOption (决策选项)
```typescript
interface DecisionOption {
  id: string;
  decision_id: string;
  option_name: string;
  score?: number;                // 评分 (0-1)
  pros?: string[];               // 优点列表
  cons?: string[];               // 缺点列表
  metadata?: object;
  created_at: string;
}
```

## SDK 使用

### TypeScript/JavaScript

```typescript
import AgentMonitor from '@agentmonitor/sdk';

const monitor = AgentMonitor.init({
  apiKey: 'your-api-key',
  baseUrl: 'http://localhost:3000',
});

// 追踪决策
await monitor.trackDecision({
  projectId: 'project-123',
  sessionId: 'session-456',
  decisionType: 'model_selection',
  context: {
    task: 'text_generation',
    requirements: ['fast', 'accurate'],
  },
  selectedOption: 'gpt-4',
  confidence: 0.85,
  reasoning: 'GPT-4 provides the best balance of speed and accuracy for this task',
  decisionMaker: 'llm',
  latencyMs: 120,
  options: [
    {
      name: 'gpt-4',
      score: 0.85,
      pros: ['High accuracy', 'Good speed'],
      cons: ['Higher cost'],
    },
    {
      name: 'gpt-3.5-turbo',
      score: 0.70,
      pros: ['Lower cost', 'Faster'],
      cons: ['Lower accuracy'],
    },
  ],
});
```

### Python

```python
from agentmonitor import AgentMonitor

monitor = AgentMonitor(
    api_key='your-api-key',
    base_url='http://localhost:3000'
)

# 追踪决策
monitor.track_decision(
    project_id='project-123',
    session_id='session-456',
    decision_type='model_selection',
    context={
        'task': 'text_generation',
        'requirements': ['fast', 'accurate']
    },
    selected_option='gpt-4',
    confidence=0.85,
    reasoning='GPT-4 provides the best balance',
    decision_maker='llm',
    latency_ms=120,
    options=[
        {
            'name': 'gpt-4',
            'score': 0.85,
            'pros': ['High accuracy', 'Good speed'],
            'cons': ['Higher cost']
        }
    ]
)
```

## API 端点

### 创建决策记录
```http
POST /api/v1/decisions
Content-Type: application/json
X-API-Key: your-api-key

{
  "projectId": "project-123",
  "sessionId": "session-456",
  "decisionType": "model_selection",
  "selectedOption": "gpt-4",
  "confidence": 0.85,
  "reasoning": "...",
  "decisionMaker": "llm",
  "latencyMs": 120,
  "options": [...]
}
```

### 获取项目决策列表
```http
GET /api/v1/projects/{projectId}/decisions?limit=100&offset=0
X-API-Key: your-api-key
```

### 获取会话决策列表
```http
GET /api/v1/sessions/{sessionId}/decisions
X-API-Key: your-api-key
```

### 获取决策统计
```http
GET /api/v1/projects/{projectId}/decisions/stats
X-API-Key: your-api-key
```

### 获取单个决策详情
```http
GET /api/v1/decisions/{id}
X-API-Key: your-api-key
```

### 删除决策
```http
DELETE /api/v1/decisions/{id}
X-API-Key: your-api-key
```

## 前端界面

访问 `/decisions` 页面查看决策监控界面，包括：

1. **统计卡片**：总决策数、平均置信度、平均延迟、24小时决策数
2. **决策时间轴**：按时间顺序展示所有决策
3. **决策详情**：点击决策查看完整信息，包括所有备选方案

## 数据库表结构

### SQLite
```sql
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT,
  decision_type TEXT NOT NULL,
  context TEXT,
  selected_option TEXT NOT NULL,
  confidence REAL,
  reasoning TEXT,
  decision_maker TEXT,
  latency_ms REAL,
  created_at TEXT DEFAULT (datetime('now')),
  metadata TEXT
);

CREATE TABLE decision_options (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  option_name TEXT NOT NULL,
  score REAL,
  pros TEXT,
  cons TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### PostgreSQL
```sql
CREATE TABLE decisions (
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

CREATE TABLE decision_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID REFERENCES decisions(id) ON DELETE CASCADE,
  option_name VARCHAR(255) NOT NULL,
  score DECIMAL(3,2),
  pros TEXT[],
  cons TEXT[],
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 使用场景

1. **模型选择决策**：记录 Agent 如何选择使用哪个 LLM 模型
2. **参数调优决策**：追踪温度、top_p 等参数的选择过程
3. **工具选择决策**：记录 Agent 选择使用哪个工具的决策
4. **策略切换决策**：追踪 Agent 在不同策略间切换的决策
5. **错误恢复决策**：记录 Agent 如何从错误中恢复的决策

## 最佳实践

1. **决策类型命名**：使用清晰的命名规范，如 `model_selection`、`tool_choice`
2. **上下文记录**：记录足够的上下文信息以便后续分析
3. **置信度标准化**：统一使用 0-1 范围的置信度
4. **推理过程**：记录清晰的推理过程，便于调试和优化
5. **性能考虑**：决策追踪是异步的，不会阻塞主业务流程

## 版本信息

- 版本：v1.0.3
- 发布日期：2026-03-05
- 分支：feature/decision-monitoring-1.0.3

## 相关文档

- [SDK 接入文档](../sdk/README.md)
- [API 文档](../docs/API.md)
- [部署文档](../docs/DEPLOYMENT.md)
