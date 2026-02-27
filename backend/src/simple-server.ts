
/**
 * AgentMonitor 最简 MVP 后端 - 内存版本
 * 跳过数据库，直接用内存存储，先跑通！
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors);
await fastify.register(websocket);

// 内存存储
const sessions: Map&lt;string, any&gt; = new Map();
const messages: any[] = [];
const events: any[] = [];

// 健康检查
fastify.get('/health', async () =&gt; {
  return {
    status: 'ok',
    service: 'agentmonitor-mvp',
    sessions: sessions.size,
    messages: messages.length,
    events: events.length,
  };
});

// 事件接收 API
fastify.post('/api/v1/events', async (request, reply) =&gt; {
  const body: any = request.body;
  const newEvents = body.events || [];

  for (const event of newEvents) {
    events.push({
      ...event,
      receivedAt: new Date(),
    });

    if (event.type === 'session_start') {
      sessions.set(event.data.id, event.data);
    }

    if (event.type === 'session_end') {
      const session = sessions.get(event.data.id);
      if (session) {
        sessions.set(event.data.id, { ...session, ...event.data });
      }
    }

    if (event.type === 'message') {
      messages.push(event.data);
    }
  }

  // 广播给 WebSocket 客户端
  fastify.websocketServer.clients.forEach((client) =&gt; {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'new_events', data: newEvents }));
    }
  });

  return { status: 'accepted', count: newEvents.length };
});

// 获取会话列表
fastify.get('/api/v1/sessions', async () =&gt; {
  return { sessions: Array.from(sessions.values()) };
});

// 获取消息列表
fastify.get('/api/v1/messages', async () =&gt; {
  return { messages };
});

// 获取事件列表
fastify.get('/api/v1/events', async () =&gt; {
  return { events };
});

// WebSocket 实时监控
fastify.get('/api/v1/ws', { websocket: true }, (connection) =&gt; {
  console.log('WebSocket client connected');

  connection.socket.on('message', (message) =&gt; {
    console.log('WebSocket message:', message.toString());
  });

  connection.socket.on('close', () =&gt; {
    console.log('WebSocket client disconnected');
  });
});

// 启动服务
const start = async () =&gt; {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('🚀 AgentMonitor MVP Backend started on http://localhost:3000');
    console.log('✅ 内存存储模式，无数据库依赖');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
