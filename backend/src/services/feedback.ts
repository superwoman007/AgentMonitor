import { query, queryOne } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

export interface Feedback {
  id: string;
  project_id: string;
  session_id: string | null;
  message_id: string | null;
  rating: number;
  reason: string | null;
  comment: string | null;
  dimensions: Record<string, unknown> | null;
  created_at: Date;
}

export interface FeedbackInput {
  projectId: string;
  sessionId?: string;
  messageId?: string;
  rating: number;
  reason?: string;
  comment?: string;
  dimensions?: Record<string, unknown>;
}

export async function createFeedback(data: FeedbackInput): Promise<Feedback> {
  const id = uuidv4();
  const feedback = await queryOne<Feedback>(
    `INSERT INTO user_feedbacks (
      id, project_id, session_id, message_id, rating, reason, comment, dimensions
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      id,
      data.projectId,
      data.sessionId || null,
      data.messageId || null,
      data.rating,
      data.reason || null,
      data.comment || null,
      data.dimensions ? JSON.stringify(data.dimensions) : null,
    ]
  );

  if (!feedback) {
    throw new Error('Failed to create feedback');
  }

  if (feedback.dimensions && typeof feedback.dimensions === 'string') {
    try {
      feedback.dimensions = JSON.parse(feedback.dimensions);
    } catch {
      feedback.dimensions = null;
    }
  }

  return feedback;
}

export async function getFeedbacksByProject(
  projectId: string,
  options?: { rating?: number; limit?: number; offset?: number }
): Promise<Feedback[]> {
  const conditions: string[] = ['project_id = $1'];
  const params: unknown[] = [projectId];
  let paramIndex = 2;

  if (options?.rating !== undefined) {
    conditions.push(`rating = $${paramIndex}`);
    params.push(options.rating);
    paramIndex++;
  }

  const limit = options?.limit || 50;
  const offset = options?.offset || 0;
  params.push(limit, offset);

  const rows = await query<Feedback>(
    `SELECT * FROM user_feedbacks 
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return rows.map(row => {
    if (row.dimensions && typeof row.dimensions === 'string') {
      try {
        row.dimensions = JSON.parse(row.dimensions);
      } catch {
        row.dimensions = null;
      }
    }
    return row;
  });
}

export async function getFeedbackStats(projectId: string): Promise<{
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  positiveRate: number;
}> {
  const result = await queryOne<{
    total: number;
    positive: number;
    negative: number;
    neutral: number;
  }>(
    `SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN rating > 0 THEN 1 END) as positive,
      COUNT(CASE WHEN rating < 0 THEN 1 END) as negative,
      COUNT(CASE WHEN rating = 0 THEN 1 END) as neutral
     FROM user_feedbacks 
     WHERE project_id = $1`,
    [projectId]
  );

  const total = Number(result?.total || 0);
  const positive = Number(result?.positive || 0);

  return {
    total,
    positive,
    negative: Number(result?.negative || 0),
    neutral: Number(result?.neutral || 0),
    positiveRate: total > 0 ? Number((positive / total).toFixed(2)) : 0,
  };
}
