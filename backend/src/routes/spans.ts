import { FastifyInstance } from 'fastify';
import { createSpan } from '../services/span.js';
import { apikeyMiddleware } from '../middleware/apikey.js';

export async function spansRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Project not identified' });
      return;
    }

    const body = request.body as {
      traceId: string;
      parentSpanId?: string | null;
      spanId: string;
      name: string;
      traceType: string;
      startedAt: string;
      endedAt?: string;
      latencyMs?: number;
      input?: unknown;
      output?: unknown;
      attributes?: Record<string, unknown>;
      status?: string;
      error?: string;
      sessionId?: string;
    };

    if (!body.traceId || !body.spanId || !body.name || !body.traceType) {
      reply.code(400).send({ error: 'traceId, spanId, name, traceType are required' });
      return;
    }

    const span = await createSpan({
      projectId: request.projectId,
      spanId: body.spanId,
      traceId: body.traceId,
      parentSpanId: body.parentSpanId,
      name: body.name,
      traceType: body.traceType,
      startedAt: new Date(body.startedAt),
      endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
      latencyMs: body.latencyMs,
      input: body.input,
      output: body.output,
      attributes: body.attributes,
      status: body.status,
      error: body.error,
      sessionId: body.sessionId,
    });

    reply.code(201).send({ span });
  });
}
