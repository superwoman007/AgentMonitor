import { FastifyInstance } from 'fastify';
import {
  createDecision,
  getDecisionById,
  getDecisionsByProject,
  getDecisionsBySession,
  getDecisionStats,
  deleteDecision,
  DecisionCreateData,
} from '../services/decision.js';
import { apikeyMiddleware } from '../middleware/apikey.js';

export default async function decisionsRoutes(fastify: FastifyInstance) {
  // 创建决策记录
  fastify.post('/decisions', {
    preHandler: apikeyMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['projectId', 'decisionType', 'selectedOption', 'decisionMaker'],
        properties: {
          projectId: { type: 'string' },
          sessionId: { type: 'string' },
          decisionType: { type: 'string' },
          context: { type: 'object' },
          selectedOption: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reasoning: { type: 'string' },
          decisionMaker: { type: 'string', enum: ['rule', 'llm', 'human', 'hybrid'] },
          latencyMs: { type: 'number' },
          metadata: { type: 'object' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                score: { type: 'number' },
                pros: { type: 'array', items: { type: 'string' } },
                cons: { type: 'array', items: { type: 'string' } },
                metadata: { type: 'object' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const data = request.body as DecisionCreateData;
      const decision = await createDecision(data);
      reply.code(201).send(decision);
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Failed to create decision' });
    }
  });

  // 获取单个决策
  fastify.get('/decisions/:id', {
    preHandler: apikeyMiddleware,
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const decision = await getDecisionById(id);
      
      if (!decision) {
        return reply.code(404).send({ error: 'Decision not found' });
      }
      
      reply.send(decision);
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Failed to get decision' });
    }
  });

  // 获取项目的决策列表
  fastify.get('/projects/:projectId/decisions', {
    preHandler: apikeyMiddleware,
  }, async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { limit = 100, offset = 0 } = request.query as { limit?: number; offset?: number };
      
      const decisions = await getDecisionsByProject(projectId, limit, offset);
      reply.send(decisions);
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Failed to get decisions' });
    }
  });

  // 获取会话的决策列表
  fastify.get('/sessions/:sessionId/decisions', {
    preHandler: apikeyMiddleware,
  }, async (request, reply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };
      const decisions = await getDecisionsBySession(sessionId);
      reply.send(decisions);
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Failed to get decisions' });
    }
  });

  // 获取项目的决策统计
  fastify.get('/projects/:projectId/decisions/stats', {
    preHandler: apikeyMiddleware,
  }, async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const stats = await getDecisionStats(projectId);
      reply.send(stats);
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Failed to get decision stats' });
    }
  });

  // 删除决策
  fastify.delete('/decisions/:id', {
    preHandler: apikeyMiddleware,
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await deleteDecision(id);
      reply.code(204).send();
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Failed to delete decision' });
    }
  });
}
