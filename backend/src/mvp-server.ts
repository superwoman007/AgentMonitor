
// AgentMonitor MVP Backend - 2天版本
// 最简可用，内存存储，无数据库

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';

const fastify = Fastify({ logger: true });

async function main() {
  await fastify.register(cors);
  await fastify.register(websocket);

  const traces = [];
  const sessions = new Map();

  fastify.get('/health', async () =&gt; {
    return {
      status: 'ok',
      service: 'agentmonitor-mvp',
      traces: traces.length,
      sessions: sessions.size,
    };
  });

  fastify.post('/api/v1/traces', async (request, reply) =&gt; {
    const trace = request.body;
    trace.receivedAt = new Date().toISOString();
    traces.unshift(trace);

    const sessionKey = trace.model;
    if (!sessions.has(sessionKey)) {
      sessions.set(sessionKey, []);
    }
    sessions.get(sessionKey).push(trace);

    fastify.websocketServer.clients.forEach((client) =&gt; {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'new_trace', data: trace }));
      }
    });

    return { status: 'accepted', traceId: trace.id };
  });

  fastify.get('/api/v1/traces', async () =&gt; {
    return { traces: traces.slice(0, 100) };
  });

  fastify.get('/api/v1/stats', async () =&gt; {
    const totalRequests = traces.length;
    const successfulRequests = traces.filter(t =&gt; t.success).length;
    const successRate = totalRequests &gt; 0 ? (successfulRequests / totalRequests * 100).toFixed(1) : 0;
    const avgLatency = totalRequests &gt; 0 
      ? (traces.reduce((sum, t) =&gt; sum + (t.latencyMs || 0), 0) / totalRequests).toFixed(0)
      : 0;
    const totalTokens = traces.reduce((sum, t) =&gt; sum + (t.response?.usage?.total_tokens || 0), 0);

    return {
      totalRequests,
      successfulRequests,
      successRate: parseFloat(successRate),
      avgLatency: parseFloat(avgLatency),
      totalTokens,
    };
  });

  fastify.get('/api/v1/ws', { websocket: true }, (connection) =&gt; {
    console.log('WebSocket client connected');

    connection.socket.send(JSON.stringify({
      type: 'init',
      data: { traces: traces.slice(0, 20) },
    }));

    connection.socket.on('message', (message) =&gt; {
      console.log('WebSocket message:', message.toString());
    });

    connection.socket.on('close', () =&gt; {
      console.log('WebSocket client disconnected');
    });
  });

  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('');
    console.log('🚀 ========================================');
    console.log('🚀 AgentMonitor MVP Backend Started');
    console.log('🚀 ========================================');
    console.log('📡 API:    http://localhost:3000');
    console.log('🔌 WS:     ws://localhost:3000/api/v1/ws');
    console.log('💾 Mode:   In-Memory (no database)');
    console.log('');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
