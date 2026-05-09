import { FastifyInstance } from 'fastify';
import {
  createSession,
  getSessionById,
  getSessionsByProject,
  endSession,
  addMessage,
  getMessagesBySession,
  getSessionTimeline,
} from '../services/session.js';
import { createDataset, addDatasetItems } from '../services/evaluation.js';
import { apikeyMiddleware } from '../middleware/apikey.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';

export async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  // POST /sessions - 创建会话
  app.post('/', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const body = request.body as {
      session_id: string;
      metadata?: unknown;
    };
    
    if (!body.session_id) {
      reply.code(400).send({ error: 'session_id is required' });
      return;
    }
    
    const session = await createSession(request.projectId, body.session_id, body.metadata);
    reply.code(201).send({
      ...session,
      session_id: session.id,  // 测试期望有 session_id 字段
    });
  });
  
  // POST /sessions/:id/messages - 添加消息
  app.post('/:id/messages', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const body = request.body as {
      role: string;
      content: string;
      timestamp: string;
      metadata?: unknown;
    };
    
    if (!['user', 'assistant', 'system'].includes(body.role)) {
      reply.code(400).send({ error: 'Invalid role' });
      return;
    }
    
    const message = await addMessage(params.id, body.role, body.content, body.timestamp, body.metadata);
    reply.code(201).send(message);
  });
  
  // GET /sessions - 获取会话列表
  app.get('/', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const query = request.query as {
      limit?: string;
      offset?: string;
    };
    
    const sessions = await getSessionsByProject(request.projectId, {
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
    
    reply.send(sessions.map(s => ({
      ...s,
      session_id: s.id,
    })));
  });
  
  // GET /sessions/:id - 获取会话详情（包含消息）
  app.get('/:id', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const session = await getSessionById(params.id);
    
    if (!session || session.project_id !== request.projectId) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const messages = await getMessagesBySession(params.id);
    
    reply.send({
      ...session,
      session_id: session.id,
      messages,
    });
  });
  
  // User-authenticated routes
  
  // GET /sessions - 获取会话列表（用户认证）
  app.get('/list', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const query = request.query as {
      projectId?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
    
    if (!query.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    
    const project = await getProjectById(query.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    
    const sessions = await getSessionsByProject(query.projectId, {
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
      status: query.status,
    });
    
    reply.send({ sessions });
  });
  
  // GET /sessions/:id - 获取会话详情（用户认证）
  app.get('/detail/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const session = await getSessionById(params.id);
    
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const project = await getProjectById(session.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    reply.send({ session });
  });
  
  // PUT /sessions/:id/end - 结束会话（用户认证）
  app.put('/end/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const session = await getSessionById(params.id);
    
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const project = await getProjectById(session.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const updated = await endSession(params.id);
    reply.send({ session: updated });
  });
  
  // GET /sessions/:id/messages - 获取会话消息（用户认证）
  app.get('/messages/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const query = request.query as {
      limit?: string;
      offset?: string;
    };
    
    const session = await getSessionById(params.id);
    
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const project = await getProjectById(session.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const messages = await getMessagesBySession(params.id, {
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
    
    reply.send({ messages });
  });

  // GET /sessions/:id/timeline - 获取会话时间线（用户认证）
  app.get('/:id/timeline', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const session = await getSessionById(params.id);
    
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const project = await getProjectById(session.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const timeline = await getSessionTimeline(params.id);
    reply.send({ timeline });
  });

  // POST /sessions/:id/export-dataset - 导出会话消息为数据集（用户认证）
  app.post('/:id/export-dataset', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as { name?: string };

    const session = await getSessionById(params.id);
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }

    const project = await getProjectById(session.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }

    const messages = await getMessagesBySession(params.id);
    // Pair user messages with next assistant messages as dataset items
    const items: Array<{ input: string; expected_output: string }> = [];
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role === 'user' && messages[i + 1].role === 'assistant') {
        items.push({
          input: messages[i].content,
          expected_output: messages[i + 1].content,
        });
      }
    }

    const datasetName = body.name || `Session-${params.id.slice(0, 8)}-Replay`;
    const dataset = await createDataset(session.project_id, datasetName, `Replay dataset exported from session ${params.id}`, 'chat');

    if (items.length > 0) {
      await addDatasetItems(dataset.id, items);
    }

    reply.code(201).send({ dataset, itemCount: items.length });
  });
}
