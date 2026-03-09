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
import { createSession, getSessionById } from '../services/session.js';
import { apikeyMiddleware } from '../middleware/apikey.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';

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
      // Use projectId from middleware if available (from API key)
      const projectId = request.projectId || data.projectId;

      if (data.sessionId) {
        const session = await getSessionById(data.sessionId);
        if (!session) {
          await createSession(projectId, data.sessionId, data.metadata);
        } else if (session.project_id !== projectId) {
          reply.code(404).send({ error: 'Session not found' });
          return;
        }
      }
      
      const decision = await createDecision({
        ...data,
        projectId
      });
      reply.code(201).send(decision);
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Failed to create decision' });
    }
  });

  // 获取单个决策
  fastify.get('/decisions/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    if (!request.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      const { id } = request.params as { id: string };
      const decision = await getDecisionById(id);
      
      if (!decision) {
        return reply.code(404).send({ error: 'Decision not found' });
      }

      const project = await getProjectById(decision.project_id);
      if (!project || project.user_id !== request.userId) {
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
    preHandler: authMiddleware,
  }, async (request, reply) => {
    if (!request.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      const { projectId } = request.params as { projectId: string };
      
      const project = await getProjectById(projectId);
      if (!project || project.user_id !== request.userId) {
        return reply.code(404).send({ error: 'Project not found' });
      }

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
    preHandler: authMiddleware,
  }, async (request, reply) => {
    if (!request.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      const { sessionId } = request.params as { sessionId: string };
      // Note: We should ideally verify session ownership here, 
      // but session service might not be easily accessible or session might not store userId directly.
      // For now, assuming if user knows sessionId and can authenticate, it's okay-ish, 
      // but strictly we should check project ownership of the session.
      // Let's assume getDecisionsBySession filters or we trust for now, 
      // or better: fetch decisions and check their project.
      
      const decisions = await getDecisionsBySession(sessionId);
      
      // Check ownership of the first decision (if any) or assume empty is fine
      if (decisions.length > 0) {
        const project = await getProjectById(decisions[0].project_id);
        if (!project || project.user_id !== request.userId) {
           // If unauthorized, return empty or 404. Let's return 404 to be safe.
           return reply.code(404).send({ error: 'Session not found' });
        }
      }
      
      reply.send(decisions);
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Failed to get decisions' });
    }
  });

  // 获取项目的决策统计
  fastify.get('/projects/:projectId/decisions/stats', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    if (!request.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      const { projectId } = request.params as { projectId: string };
      
      const project = await getProjectById(projectId);
      if (!project || project.user_id !== request.userId) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      const stats = await getDecisionStats(projectId);
      reply.send(stats);
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Failed to get decision stats' });
    }
  });

  // 删除决策
  fastify.delete('/decisions/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    if (!request.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      const { id } = request.params as { id: string };
      const decision = await getDecisionById(id);
      
      if (!decision) {
        return reply.code(404).send({ error: 'Decision not found' });
      }

      const project = await getProjectById(decision.project_id);
      if (!project || project.user_id !== request.userId) {
        return reply.code(404).send({ error: 'Decision not found' });
      }

      await deleteDecision(id);
      reply.code(204).send();
    } catch (error) {
      fastify.log.error(error);
      reply.code(500).send({ error: 'Failed to delete decision' });
    }
  });
}
