import { FastifyInstance } from 'fastify';
import { createTrace, getTracesByProject, getTraceById, updateTrace, getTraceTree, getChildTraceCount, addTraceEvalResult, getTraceEvalResults, getTracesByPrompt } from '../services/trace.js';
import { getSpanTree } from '../services/span.js';
import { checkBreakpoints } from '../services/breakpoint.js';
import { createSnapshot } from '../services/snapshot.js';
import { addMessage, createSession, getMessagesBySession, getSessionById } from '../services/session.js';
import { createDataset, addDatasetItems } from '../services/evaluation.js';
import { apikeyMiddleware } from '../middleware/apikey.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';
import { broadcastToProject } from './ws.js';

export async function tracesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Project not identified' });
      return;
    }
    
    const body = request.body as {
      sessionId?: string;
      agentId?: string;
      parentTraceId?: string;
      traceType: string;
      name: string;
      input?: unknown;
      output?: unknown;
      metadata?: unknown;
      traceId?: string;
      spanId?: string;
      parentSpanId?: string;
      promptId?: string;
      promptVersionId?: string;
      startedAt?: string;
      endedAt?: string;
      latencyMs?: number;
      status?: string;
      error?: string;
    };
    
    if (!body.traceType || !body.name) {
      reply.code(400).send({ error: 'traceType and name are required' });
      return;
    }

    if (body.sessionId) {
      const session = await getSessionById(body.sessionId);
      if (!session) {
        await createSession(request.projectId, body.sessionId, body.metadata);
      } else if (session.project_id !== request.projectId) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }
    }
    
    const trace = await createTrace({
      projectId: request.projectId,
      sessionId: body.sessionId,
      agentId: body.agentId,
      parentTraceId: body.parentTraceId,
      traceType: body.traceType,
      name: body.name,
      input: body.input,
      output: body.output,
      metadata: body.metadata,
      traceId: body.traceId,
      spanId: body.spanId,
      parentSpanId: body.parentSpanId,
      promptId: body.promptId,
      promptVersionId: body.promptVersionId,
      startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
      endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
      latencyMs: body.latencyMs,
      status: body.status,
      error: body.error,
    });
    
    app.log.info({ traceId: trace.id, projectId: request.projectId }, 'Trace created');

    broadcastToProject(request.projectId, { type: 'new_trace', data: trace });

    if (body.traceType === 'message' && body.sessionId) {
      const input = body.input as { role?: string } | undefined;
      const output = body.output as { content?: string } | undefined;
      const role = input?.role;
      const content = output?.content;
      if (role && content) {
        try {
          await addMessage(
            body.sessionId,
            role,
            content,
            body.startedAt || new Date().toISOString(),
            body.metadata
          );
        } catch (error) {
          app.log.warn({ error, traceId: trace.id }, 'Failed to add message from trace');
        }
      }
    }
    
    try {
      const triggeredBreakpoints = await checkBreakpoints(request.projectId, {
        content: body.output ? JSON.stringify(body.output) : undefined,
        error: body.error,
        latencyMs: body.latencyMs,
        toolName: body.name,
        metadata: body.metadata as Record<string, unknown> | undefined,
      });
      
      if (triggeredBreakpoints.length > 0 && body.sessionId) {
        app.log.info(
          { traceId: trace.id, triggeredCount: triggeredBreakpoints.length },
          'Breakpoints triggered'
        );
        
        const messages = await getMessagesBySession(body.sessionId);
        
        for (const breakpoint of triggeredBreakpoints) {
          await createSnapshot({
            sessionId: body.sessionId,
            breakpointId: breakpoint.id,
            triggerReason: `Breakpoint "${breakpoint.name}" triggered: ${breakpoint.type} - ${breakpoint.condition}`,
            state: {
              trace: {
                id: trace.id,
                name: trace.name,
                type: trace.trace_type,
                input: trace.input,
                output: trace.output,
                status: trace.status,
                error: trace.error,
                latencyMs: trace.latency_ms,
              },
              messages: messages.map(m => ({
                role: m.role,
                content: m.content,
                timestamp: m.timestamp ? (m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp) : null,
              })),
              breakpoint: {
                id: breakpoint.id,
                name: breakpoint.name,
                type: breakpoint.type,
                condition: breakpoint.condition,
              },
              metadata: body.metadata,
            },
          });
          
          app.log.info(
            { 
              traceId: trace.id, 
              breakpointId: breakpoint.id,
              sessionId: body.sessionId 
            },
            'Snapshot created for triggered breakpoint'
          );
        }
      }
    } catch (error) {
      app.log.error({ error, traceId: trace.id }, 'Failed to check breakpoints or create snapshot');
    }
    
    reply.code(201).send({ trace });
  });
  
  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const query = request.query as {
      projectId?: string;
      sessionId?: string;
      traceType?: string;
      status?: string;
      parentTraceId?: string;
      evalStatus?: string;
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
    
    const traces = await getTracesByProject(query.projectId, {
      sessionId: query.sessionId,
      traceType: query.traceType,
      status: query.status,
      parentTraceId: query.parentTraceId,
      evalStatus: query.evalStatus,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
    
    reply.send({ traces });
  });
  
  app.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const trace = await getTraceById(params.id);
    
    if (!trace) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }
    
    const project = await getProjectById(trace.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }
    
    const childCount = await getChildTraceCount(params.id);
    
    reply.send({ trace, childCount });
  });

  async function handlePostEval(request: any, reply: any): Promise<void> {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      evaluator?: string;
      score?: number;
      passed?: number;
      details?: Record<string, unknown>;
    };

    if (body.score === undefined || typeof body.score !== 'number' || body.score < 0 || body.score > 1) {
      reply.code(400).send({ error: 'score must be a number between 0 and 1' });
      return;
    }

    const trace = await getTraceById(params.id);
    if (!trace) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }

    const project = await getProjectById(trace.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }

    const evalResult = await addTraceEvalResult(
      params.id,
      body.evaluator || 'manual',
      body.score,
      body.passed === 1 || body.passed === true,
      body.details
    );
    reply.code(201).send({ success: true, evalResult });
  }

  app.post('/:id/eval', { preHandler: authMiddleware }, handlePostEval);
  app.post('/:id/evaluations', { preHandler: authMiddleware }, handlePostEval);

  app.get('/:id/evaluations', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const trace = await getTraceById(params.id);
    if (!trace) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }

    const project = await getProjectById(trace.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }

    const evaluations = await getTraceEvalResults(params.id);
    reply.send({ evaluations });
  });

  // GET /traces/:id/tree - 查询 Trace 树形结构
  app.get('/:id/tree', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const trace = await getTraceById(params.id);

    if (!trace) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }

    const project = await getProjectById(trace.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }

    // 优先从 spans 表获取完整树
    const spanTree = await getSpanTree(trace.trace_id);
    if (spanTree) {
      return {
        trace,
        spans: spanTree.rootSpan ? [spanTree.rootSpan] : [],
        stats: spanTree.stats,
      };
    }

    // fallback 到旧接口
    const children = await getTraceTree(params.id);
    return { trace, spans: children?.children || [], _fallback: true };
  });
  
  app.patch('/:id', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Project not identified' });
      return;
    }
    
    const params = request.params as { id: string };
    const body = request.body as {
      output?: unknown;
      endedAt?: string;
      latencyMs?: number;
      status?: string;
      error?: string;
      promptId?: string;
      promptVersionId?: string;
    };
    
    const existingTrace = await getTraceById(params.id);
    if (!existingTrace || existingTrace.project_id !== request.projectId) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }
    
    const trace = await updateTrace(params.id, {
      output: body.output,
      endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
      latencyMs: body.latencyMs,
      status: body.status,
      error: body.error,
      promptId: body.promptId,
      promptVersionId: body.promptVersionId,
    });
    
    reply.send({ trace });
  });

  // POST /traces/otel-export - Receive OTel spans and create traces (OTel Collector compatible)
  app.post('/otel-export', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Project not identified' });
      return;
    }

    const body = request.body as {
      resourceSpans?: Array<{
        scopeSpans?: Array<{
          spans?: Array<{
            traceId: string;
            spanId: string;
            parentSpanId?: string;
            name: string;
            kind?: string;
            startTimeUnixNano?: string;
            endTimeUnixNano?: string;
            attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: number; boolValue?: boolean } }>;
            status?: { code?: string; message?: string };
            events?: Array<{ name: string; timeUnixNano?: string; attributes?: Array<{ key: string; value: { stringValue?: string } }> }>;
          }>;
        }>;
      }>;
    };

    const spans = body.resourceSpans?.flatMap(rs => rs.scopeSpans?.flatMap(ss => ss.spans ?? []) ?? []) ?? [];
    const createdTraces: string[] = [];

    for (const span of spans) {
      const attrs = span.attributes?.reduce((acc, a) => {
        if (a.value.stringValue !== undefined) acc[a.key] = a.value.stringValue;
        else if (a.value.intValue !== undefined) acc[a.key] = a.value.intValue;
        else if (a.value.boolValue !== undefined) acc[a.key] = a.value.boolValue;
        return acc;
      }, {} as Record<string, unknown>) ?? {};

      const trace = await createTrace({
        projectId: request.projectId,
        sessionId: attrs['trace.session_id'] as string | undefined,
        agentId: attrs['trace.agent_id'] as string | undefined,
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        traceType: attrs['trace.type'] as string || 'otel',
        name: span.name,
        input: attrs['llm.input'] ?? undefined,
        output: attrs['llm.output'] ?? undefined,
        metadata: attrs['trace.metadata'] ?? undefined,
        startedAt: span.startTimeUnixNano ? new Date(parseInt(span.startTimeUnixNano, 10) / 1000000) : new Date(),
        endedAt: span.endTimeUnixNano ? new Date(parseInt(span.endTimeUnixNano, 10) / 1000000) : undefined,
        latencyMs: attrs['llm.latency_ms'] as number | undefined,
        status: span.status?.code === 'ERROR' ? 'error' : 'success',
        error: span.status?.message || (span.events?.find(e => e.name === 'exception')?.attributes?.find(a => a.key === 'exception.message')?.value?.stringValue) || undefined,
      });
      createdTraces.push(trace.id);
    }

    reply.code(201).send({ imported: createdTraces.length, traceIds: createdTraces });
  });

  // OTel export endpoint
  app.get('/:id/otel', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const trace = await getTraceById(params.id);
    if (!trace) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }

    const project = await getProjectById(trace.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }

    // Convert to OTel Span format
    const otelSpan = {
      traceId: trace.trace_id || trace.id,
      spanId: trace.span_id || trace.id,
      parentSpanId: trace.parent_span_id || trace.parent_trace_id || null,
      name: trace.name,
      kind: 'INTERNAL',
      startTime: trace.started_at,
      endTime: trace.ended_at,
      status: trace.status === 'error' ? { code: 'ERROR', message: trace.error } : { code: 'OK' },
      attributes: {
        'trace.type': trace.trace_type,
        'trace.project_id': trace.project_id,
        'trace.session_id': trace.session_id,
        'trace.agent_id': trace.agent_id,
        'llm.latency_ms': trace.latency_ms,
        ...(trace.input ? { 'llm.input': trace.input } : {}),
        ...(trace.output ? { 'llm.output': trace.output } : {}),
        ...(trace.metadata ? { 'trace.metadata': trace.metadata } : {}),
      },
      events: trace.error ? [{ name: 'exception', timestamp: trace.ended_at, attributes: { 'exception.message': trace.error } }] : [],
    };

    reply.send({ span: otelSpan });
  });

  // Batch OTel export for a session
  app.get('/session/:sessionId/otel', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { sessionId: string };
    const query = request.query as { projectId?: string };

    if (!query.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }

    const project = await getProjectById(query.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const traces = await getTracesByProject(query.projectId, { sessionId: params.sessionId, limit: 1000 });

    const otelSpans = traces.map(trace => ({
      traceId: trace.trace_id || trace.id,
      spanId: trace.span_id || trace.id,
      parentSpanId: trace.parent_span_id || trace.parent_trace_id || null,
      name: trace.name,
      kind: 'INTERNAL',
      startTime: trace.started_at,
      endTime: trace.ended_at,
      status: trace.status === 'error' ? { code: 'ERROR', message: trace.error } : { code: 'OK' },
      attributes: {
        'trace.type': trace.trace_type,
        'trace.project_id': trace.project_id,
        'trace.session_id': trace.session_id,
        'trace.agent_id': trace.agent_id,
        'llm.latency_ms': trace.latency_ms,
        ...(trace.input ? { 'llm.input': trace.input } : {}),
        ...(trace.output ? { 'llm.output': trace.output } : {}),
      },
      events: trace.error ? [{ name: 'exception', timestamp: trace.ended_at, attributes: { 'exception.message': trace.error } }] : [],
    }));

    reply.send({ resourceSpans: [{ scopeSpans: [{ spans: otelSpans }] }] });
  });

  // POST /traces/:id/add-to-dataset - 将单条 trace 沉淀为数据集条目
  app.post('/:id/add-to-dataset', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      datasetId?: string;
      datasetName?: string;
      expectedOutput?: string;
    };

    const trace = await getTraceById(params.id);
    if (!trace) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }

    const project = await getProjectById(trace.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }

    if (!body.datasetId && !body.datasetName) {
      reply.code(400).send({ error: 'datasetId or datasetName is required' });
      return;
    }

    let dataset;
    if (body.datasetId) {
      dataset = await getProjectById(trace.project_id); // placeholder, will check dataset exists below
      // Actually we need to verify the dataset belongs to this project
      // For simplicity, we create or use dataset directly
      // Let's import getDatasetById if needed
      const { getDatasetById } = await import('../services/evaluation.js');
      dataset = await getDatasetById(body.datasetId);
      if (!dataset || dataset.project_id !== trace.project_id) {
        reply.code(404).send({ error: 'Dataset not found' });
        return;
      }
    } else {
      dataset = await createDataset(trace.project_id, body.datasetName!, `Auto-created from trace ${params.id}`, 'chat');
    }

    const input = trace.input ? JSON.stringify(trace.input) : trace.name;
    const item = await addDatasetItems(dataset.id, [{
      input,
      expected_output: body.expectedOutput || undefined,
      metadata: {
        source: 'trace_reflow',
        trace_id: trace.id,
        trace_type: trace.trace_type,
        trace_status: trace.status,
        latency_ms: trace.latency_ms,
      },
    }]);

    // Re-fetch dataset to get updated item_count
    const { getDatasetById: getDatasetByIdEval } = await import('../services/evaluation.js');
    const updatedDataset = await getDatasetByIdEval(dataset.id);

    reply.code(201).send({ item: item[0], dataset: updatedDataset || dataset });
  });

  // POST /traces/bulk-export-dataset - 批量沉淀 traces 为数据集
  app.post('/bulk-export-dataset', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      projectId: string;
      traceIds?: string[];
      filters?: { status?: string; traceType?: string; sessionId?: string };
      datasetName?: string;
      datasetId?: string;
    };

    if (!body.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }

    const project = await getProjectById(body.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    let traces;
    if (body.traceIds && body.traceIds.length > 0) {
      traces = [];
      for (const id of body.traceIds) {
        const trace = await getTraceById(id);
        if (trace && trace.project_id === body.projectId) {
          traces.push(trace);
        }
      }
    } else if (body.filters) {
      traces = await getTracesByProject(body.projectId, {
        status: body.filters.status,
        traceType: body.filters.traceType,
        sessionId: body.filters.sessionId,
        limit: 1000,
      });
    } else {
      reply.code(400).send({ error: 'traceIds or filters is required' });
      return;
    }

    if (traces.length === 0) {
      reply.code(404).send({ error: 'No traces found matching criteria' });
      return;
    }

    let dataset;
    if (body.datasetId) {
      const { getDatasetById } = await import('../services/evaluation.js');
      dataset = await getDatasetById(body.datasetId);
      if (!dataset || dataset.project_id !== body.projectId) {
        reply.code(404).send({ error: 'Dataset not found' });
        return;
      }
    } else if (body.datasetName) {
      dataset = await createDataset(body.projectId, body.datasetName, 'Bulk export from traces', 'chat');
    } else {
      reply.code(400).send({ error: 'datasetName or datasetId is required' });
      return;
    }

    const items = traces.map(trace => ({
      input: trace.input ? JSON.stringify(trace.input) : trace.name,
      expected_output: trace.output ? JSON.stringify(trace.output) : undefined,
      metadata: {
        source: 'trace_bulk_reflow',
        trace_id: trace.id,
        trace_type: trace.trace_type,
        trace_status: trace.status,
        latency_ms: trace.latency_ms,
      },
    }));

    const createdItems = await addDatasetItems(dataset.id, items);

    // Re-fetch dataset to get updated item_count
    const { getDatasetById: getDatasetByIdEval2 } = await import('../services/evaluation.js');
    const updatedDataset = await getDatasetByIdEval2(dataset.id);

    reply.code(201).send({ imported: createdItems.length, dataset: updatedDataset || dataset, traceIds: traces.map(t => t.id) });
  });
}
