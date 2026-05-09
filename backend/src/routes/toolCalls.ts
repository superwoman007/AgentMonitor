import { FastifyInstance } from 'fastify';
import { createToolCall, getToolCallsBySession, updateToolCall } from '../services/toolCalls.js';
import { apikeyMiddleware } from '../middleware/apikey.js';
import { authMiddleware } from '../middleware/auth.js';
import { getSessionById } from '../services/session.js';
import { getProjectById } from '../services/project.js';

export async function toolCallsRoutes(app: FastifyInstance): Promise<void> {
  // POST /tool-calls - 创建工具调用（API Key 认证）
  app.post('/', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Project not identified' });
      return;
    }
    
    const body = request.body as {
      sessionId: string;
      messageId?: string;
      toolName: string;
      input?: unknown;
      output?: unknown;
      status?: string;
    };
    
    if (!body.sessionId || !body.toolName) {
      reply.code(400).send({ error: 'sessionId and toolName are required' });
      return;
    }
    
    const session = await getSessionById(body.sessionId);
    if (!session || session.project_id !== request.projectId) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const toolCall = await createToolCall(body);
    reply.code(201).send(toolCall);
  });
  
  // GET /tool-calls - 获取工具调用列表（用户认证）
  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const query = request.query as {
      session_id?: string;
    };
    
    if (!query.session_id) {
      reply.code(400).send({ error: 'session_id is required' });
      return;
    }
    
    const session = await getSessionById(query.session_id);
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const project = await getProjectById(session.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const toolCalls = await getToolCallsBySession(query.session_id);
    reply.send({ tool_calls: toolCalls });
  });
  
  // PATCH /tool-calls/:id - 更新工具调用（API Key 认证）
  app.patch('/:id', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Project not identified' });
      return;
    }
    
    const params = request.params as { id: string };
    const body = request.body as {
      output?: unknown;
      status?: string;
      endedAt?: string;
    };
    
    const toolCall = await updateToolCall(params.id, body);
    if (!toolCall) {
      reply.code(404).send({ error: 'Tool call not found' });
      return;
    }
    
    reply.send(toolCall);
  });
}
