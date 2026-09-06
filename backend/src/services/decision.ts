import { query, queryOne, run, toDbJson, fromDbJson } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

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
  const decisionId = `decision_${uuidv4()}`;

  await run(
    `INSERT INTO decisions (
      id, project_id, session_id, decision_type, context, selected_option,
      confidence, reasoning, decision_maker, latency_ms, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      decisionId,
      data.projectId,
      data.sessionId || null,
      data.decisionType,
      toDbJson(data.context ?? null),
      data.selectedOption,
      data.confidence ?? null,
      data.reasoning ?? null,
      data.decisionMaker,
      data.latencyMs ?? null,
      toDbJson(data.metadata ?? null),
    ]
  );

  const decision = await queryOne<Decision>('SELECT * FROM decisions WHERE id = $1', [decisionId]);
  if (!decision) throw new Error('Failed to create decision');

  const parsedDecision: Decision = {
    ...decision,
    context: fromDbJson(decision.context) as Record<string, unknown> | null,
    metadata: fromDbJson(decision.metadata) as Record<string, unknown> | null,
  };

  // Create options
  const options: DecisionOption[] = [];
  if (data.options && data.options.length > 0) {
    for (const opt of data.options) {
      const optionId = `option_${uuidv4()}`;

      await run(
        `INSERT INTO decision_options (
          id, decision_id, option_name, score, pros, cons, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          optionId,
          parsedDecision.id,
          opt.name,
          opt.score ?? null,
          toDbJson(opt.pros ?? null),
          toDbJson(opt.cons ?? null),
          toDbJson(opt.metadata ?? null),
        ]
      );

      const option = await queryOne<DecisionOption>('SELECT * FROM decision_options WHERE id = $1', [optionId]);
      if (!option) continue;

      options.push({
        ...option,
        pros: fromDbJson(option.pros) as string[] | null,
        cons: fromDbJson(option.cons) as string[] | null,
        metadata: fromDbJson(option.metadata) as Record<string, unknown> | null,
      });
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
    context: fromDbJson(decision.context) as Record<string, unknown> | null,
    metadata: fromDbJson(decision.metadata) as Record<string, unknown> | null,
    options: options.map(opt => ({
      ...opt,
      pros: fromDbJson(opt.pros) as string[] | null,
      cons: fromDbJson(opt.cons) as string[] | null,
      metadata: fromDbJson(opt.metadata) as Record<string, unknown> | null,
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
      context: fromDbJson(decision.context) as Record<string, unknown> | null,
      metadata: fromDbJson(decision.metadata) as Record<string, unknown> | null,
      options: options.map(opt => ({
        ...opt,
        pros: fromDbJson(opt.pros) as string[] | null,
        cons: fromDbJson(opt.cons) as string[] | null,
        metadata: fromDbJson(opt.metadata) as Record<string, unknown> | null,
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
      context: fromDbJson(decision.context) as Record<string, unknown> | null,
      metadata: fromDbJson(decision.metadata) as Record<string, unknown> | null,
      options: options.map(opt => ({
        ...opt,
        pros: fromDbJson(opt.pros) as string[] | null,
        cons: fromDbJson(opt.cons) as string[] | null,
        metadata: fromDbJson(opt.metadata) as Record<string, unknown> | null,
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
    queryOne<{ count: string | number }>(
      'SELECT COUNT(*) as count FROM decisions WHERE project_id = $1',
      [projectId]
    ),
    queryOne<{ avg: string | number | null }>(
      'SELECT AVG(confidence) as avg FROM decisions WHERE project_id = $1 AND confidence IS NOT NULL',
      [projectId]
    ),
    queryOne<{ avg: string | number | null }>(
      'SELECT AVG(latency_ms) as avg FROM decisions WHERE project_id = $1 AND latency_ms IS NOT NULL',
      [projectId]
    ),
    query<{ decision_type: string; count: string | number }>(
      `SELECT decision_type, COUNT(*) as count 
       FROM decisions WHERE project_id = $1 
       GROUP BY decision_type`,
      [projectId]
    ),
    query<{ decision_maker: string; count: string | number }>(
      `SELECT decision_maker, COUNT(*) as count 
       FROM decisions WHERE project_id = $1 
       GROUP BY decision_maker`,
      [projectId]
    ),
    queryOne<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM decisions 
       WHERE project_id = $1 AND created_at > ${
         config.dbType === 'sqlite'
           ? "datetime('now', '-24 hours')"
           : "NOW() - INTERVAL '24 hours'"
       }`,
      [projectId]
    ),
  ]);

  const decisionsByType: Record<string, number> = {};
  for (const row of typeStats) {
    decisionsByType[row.decision_type] = Number(row.count ?? 0);
  }

  const decisionsByMaker: Record<string, number> = {};
  for (const row of makerStats) {
    decisionsByMaker[row.decision_maker] = Number(row.count ?? 0);
  }

  return {
    totalDecisions: Number(totalCount?.count ?? 0),
    avgConfidence: avgConf?.avg == null ? 0 : Number(avgConf.avg),
    avgLatencyMs: avgLat?.avg == null ? 0 : Number(avgLat.avg),
    decisionsByType,
    decisionsByMaker,
    recentDecisions: Number(recentCount?.count ?? 0),
  };
}

export async function deleteDecision(id: string): Promise<void> {
  await run('DELETE FROM decisions WHERE id = $1', [id]);
}
