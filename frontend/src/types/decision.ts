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
  options: DecisionOption[];
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

export interface DecisionStats {
  totalDecisions: number;
  avgConfidence: number;
  decisionsByType: Record<string, number>;
  decisionsByMaker: Record<string, number>;
  avgLatencyMs: number;
  recentDecisions: number;
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
