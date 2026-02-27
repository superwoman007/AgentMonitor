
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';

const fastify = Fastify({
  logger: true,
});

// 注册插件
await fastify.register(cors);
await fastify.register(websocket);

// 健康检查
fastify.get('/health', async () =&gt; {
  return { status: 'ok', service: 'agentmonitor-backend' };
});

// 事件接收 API
fastify.post('/api/v1/events', async (request, reply) =&gt; {
  // TODO: 实现事件存储逻辑
  return { status: 'accepted' };
});

// WebSocket 实时监控
fastify.get('/api/v1/ws', { websocket: true }, (connection) =&gt; {
  connection.socket.on('message', (message) =&gt; {
    console.log('WebSocket message:', message.toString());
  });
});

// 启动服务
const start = async () =&gt; {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('AgentMonitor Backend started on http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
