import { query, queryOne } from '../db/index.js';

export interface Decision {
  id: string;
  project_id: string;
  session_id: string | null;
  decision_type: string;
  context: Record<string, unknown> | null;
  selected_option: string;
  confidence: number | null;
  reasoning: string | null;
  decision_maker: 'rule' | 'llm' | 'human' | 'hybrid';
  latency_ms: number | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface DecisionOption {
  id: string;
  decision_id: string;
  option_name: string;
  score: number | null;
  pros: string[] | null;
  cons: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface DecisionWithOptions extends Decision {
  options: DecisionOption[];
}

export interface DecisionCreateData {
  projectId: string;
  sessionId?: string;
  decisionType: string;
  context?: Record<string, unknown>;
  selectedOption: string;
  confidence?: number;
  reasoning?: string;
  decisionMaker: 'rule' | 'llm' | 'human' | 'hybrid';
  latencyMs?: number;
  metadata?: Record<string, unknown>;
  options?: Array<{
    name: string;
    score?: number;
    pros?: string[];
    cons?: string[];
    metadata?: Record<string, unknown>;
  }>;
}

export interface DecisionStats {
  totalDecisions: number;
  avgConfidence: number;
  decisionsByType: Record<string, number>;
  decisionsByMaker: Record<string, number>;
  avgLatencyMs: number;
  recentDecisions: number;
}

export async function createDecision(data: DecisionCreateData): Promise<DecisionWithOptions> {
  const decision = await queryOne<Decision>(
    `INSERT INTO decisions (
      project_id, session_id, decision_type, context, selected_option,
      confidence, reasoning, decision_maker, latency_ms, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      data.projectId,
      data.sessionId || null,
      data.decisionType,
      data.context ? JSON.stringify(data.context) : null,
      data.selectedOption,
      data.confidence || null,
      data.reasoning || null,
      data.decisionMaker,
      data.latencyMs || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ]
  );

  if (!decision) {
    throw new Error('Failed to create decision');
  }

  // Parse JSON fields
  const parsedDecision: Decision = {
    ...decision,
    context: decision.context ? JSON.parse(decision.context as unknown as string) : null,
    metadata: decision.metadata ? JSON.parse(decision.metadata as unknown as string) : null,
  };

  // Create options
  const options: DecisionOption[] = [];
  if (data.options && data.options.length > 0) {
    for (const opt of data.options) {
      const option = await queryOne<DecisionOption>(
        `INSERT INTO decision_options (
          decision_id, option_name, score, pros, cons, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [
          parsedDecision.id,
          opt.name,
          opt.score || null,
          opt.pros ? JSON.stringify(opt.pros) : null,
          opt.cons ? JSON.stringify(opt.cons) : null,
          opt.metadata ? JSON.stringify(opt.metadata) : null,
        ]
      );

      if (option) {
        options.push({
          ...option,
          pros: option.pros ? JSON.parse(option.pros as unknown as string) : null,
          cons: option.cons ? JSON.parse(option.cons as unknown as string) : null,
          metadata: option.metadata ? JSON.parse(option.metadata as unknown as string) : null,
        });
      }
    }
  }

  return {
    ...parsedDecision,
    options,
  };
}

export async function getDecisionById(id: string): Promise<DecisionWithOptions | null> {
  const decision = await queryOne<Decision>(
    'SELECT * FROM decisions WHERE id = $1',
    [id]
  );

  if (!decision) {
    return null;
  }

  const options = await query<DecisionOption>(
    'SELECT * FROM decision_options WHERE decision_id = $1 ORDER BY created_at',
    [id]
  );

  return {
    ...decision,
    context: decision.context ? JSON.parse(decision.context as unknown as string) : null,
    metadata: decision.metadata ? JSON.parse(decision.metadata as unknown as string) : null,
    options: options.map(opt => ({
      ...opt,
      pros: opt.pros ? JSON.parse(opt.pros as unknown as string) : null,
      cons: opt.cons ? JSON.parse(opt.cons as unknown as string) : null,
      metadata: opt.metadata ? JSON.parse(opt.metadata as unknown as string) : null,
    })),
  };
}

export async function getDecisionsByProject(
  projectId: string,
  limit: number = 100,
  offset: number = 0
): Promise<DecisionWithOptions[]> {
  const decisions = await query<Decision>(
    `SELECT * FROM decisions 
     WHERE project_id = $1 
     ORDER BY created_at DESC 
     LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]
  );

  const result: DecisionWithOptions[] = [];
  for (const decision of decisions) {
    const options = await query<DecisionOption>(
      'SELECT * FROM decision_options WHERE decision_id = $1 ORDER BY created_at',
      [decision.id]
    );

    result.push({
      ...decision,
      context: decision.context ? JSON.parse(decision.context as unknown as string) : null,
      metadata: decision.metadata ? JSON.parse(decision.metadata as unknown as string) : null,
      options: options.map(opt => ({
        ...opt,
        pros: opt.pros ? JSON.parse(opt.pros as unknown as string) : null,
        cons: opt.cons ? JSON.parse(opt.cons as unknown as string) : null,
        metadata: opt.metadata ? JSON.parse(opt.metadata as unknown as string) : null,
      })),
    });
  }

  return result;
}

export async function getDecisionsBySession(sessionId: string): Promise<DecisionWithOptions[]> {
  const decisions = await query<Decision>(
    'SELECT * FROM decisions WHERE session_id = $1 ORDER BY created_at',
    [sessionId]
  );

  const result: DecisionWithOptions[] = [];
  for (const decision of decisions) {
    const options = await query<DecisionOption>(
      'SELECT * FROM decision_options WHERE decision_id = $1 ORDER BY created_at',
      [decision.id]
    );

    result.push({
      ...decision,
      context: decision.context ? JSON.parse(decision.context as unknown as string) : null,
      metadata: decision.metadata ? JSON.parse(decision.metadata as unknown as string) : null,
      options: options.map(opt => ({
        ...opt,
        pros: opt.pros ? JSON.parse(opt.pros as unknown as string) : null,
        cons: opt.cons ? JSON.parse(opt.cons as unknown as string) : null,
        metadata: opt.metadata ? JSON.parse(opt.metadata as unknown as string) : null,
      })),
    });
  }

  return result;
}

export async function getDecisionStats(projectId: string): Promise<DecisionStats> {
  const [
    totalCount,
    avgConf,
    avgLat,
    typeStats,
    makerStats,
    recentCount,
  ] = await Promise.all([
    queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM decisions WHERE project_id = $1',
      [projectId]
    ),
    queryOne<{ avg: string | null }>(
      'SELECT AVG(confidence)::text as avg FROM decisions WHERE project_id = $1 AND confidence IS NOT NULL',
      [projectId]
    ),
    queryOne<{ avg: string | null }>(
      'SELECT AVG(latency_ms)::text as avg FROM decisions WHERE project_id = $1 AND latency_ms IS NOT NULL',
      [projectId]
    ),
    query<{ decision_type: string; count: string }>(
      `SELECT decision_type, COUNT(*)::text as count 
       FROM decisions WHERE project_id = $1 
       GROUP BY decision_type`,
      [projectId]
    ),
    query<{ decision_maker: string; count: string }>(
      `SELECT decision_maker, COUNT(*)::text as count 
       FROM decisions WHERE project_id = $1 
       GROUP BY decision_maker`,
      [projectId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM decisions 
       WHERE project_id = $1 AND created_at > datetime('now', '-24 hours')`,
      [projectId]
    ),
  ]);

  const decisionsByType: Record<string, number> = {};
  for (const row of typeStats) {
    decisionsByType[row.decision_type] = parseInt(row.count, 10);
  }

  const decisionsByMaker: Record<string, number> = {};
  for (const row of makerStats) {
    decisionsByMaker[row.decision_maker] = parseInt(row.count, 10);
  }

  return {
    totalDecisions: parseInt(totalCount?.count || '0', 10),
    avgConfidence: avgConf?.avg ? parseFloat(avgConf.avg) : 0,
    avgLatencyMs: avgLat?.avg ? parseFloat(avgLat.avg) : 0,
    decisionsByType,
    decisionsByMaker,
    recentDecisions: parseInt(recentCount?.count || '0', 10),
  };
}

export async function deleteDecision(id: string): Promise<void> {
  await query('DELETE FROM decisions WHERE id = $1', [id]);
}
