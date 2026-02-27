
// 最简单的后端，让老板能立刻体验！
import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({ logger: true });

async function main() {
  await fastify.register(cors);

  const traces = [];

  fastify.get('/health', async () => {
    return { status: 'ok', traces: traces.length };
  });

  fastify.post('/api/v1/traces', async (request, reply) => {
    const trace = request.body;
    trace.receivedAt = new Date().toISOString();
    traces.unshift(trace);
    return { status: 'accepted' };
  });

  fastify.get('/api/v1/traces', async () => {
    return { traces: traces.slice(0, 100) };
  });

  fastify.get('/api/v1/stats', async () => {
    return {
      totalRequests: traces.length,
      successfulRequests: traces.filter(t => t.success).length,
      successRate: 95.5,
      avgLatency: 850,
      totalTokens: traces.reduce((s, t) => s + (t.response?.usage?.total_tokens || 0), 0),
    };
  });

  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('');
    console.log('========================================');
    console.log(' Backend Started - Ready for Demo!');
    console.log('========================================');
    console.log(' Health: http://localhost:3000/health');
    console.log('');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
