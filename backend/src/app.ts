import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { tracesRoutes } from './routes/traces.js';
import { sessionsRoutes } from './routes/sessions.js';
import { projectsRoutes } from './routes/projects.js';
import { apikeysRoutes } from './routes/apikeys.js';
import { statsRoutes } from './routes/stats.js';
import { wsRoutes } from './routes/ws.js';
import { breakpointsRoutes } from './routes/breakpoints.js';
import { snapshotsRoutes } from './routes/snapshots.js';
import { qualityRoutes } from './routes/quality.js';
import { costRoutes } from './routes/cost.js';
import { alertsRoutes } from './routes/alerts.js';
import decisionsRoutes from './routes/decisions.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
    },
  });
  
  await app.register(cors, {
    origin: true,
  });
  
  await app.register(websocket);
  
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  
  await app.register(authRoutes, { prefix: `${config.api.prefix}/auth` });
  await app.register(tracesRoutes, { prefix: `${config.api.prefix}/traces` });
  await app.register(sessionsRoutes, { prefix: `${config.api.prefix}/sessions` });
  await app.register(projectsRoutes, { prefix: `${config.api.prefix}/projects` });
  await app.register(apikeysRoutes, { prefix: `${config.api.prefix}/apikeys` });
  await app.register(statsRoutes, { prefix: `${config.api.prefix}/stats` });
  await app.register(breakpointsRoutes, { prefix: `${config.api.prefix}/breakpoints` });
  await app.register(snapshotsRoutes, { prefix: `${config.api.prefix}/snapshots` });
  await app.register(qualityRoutes, { prefix: `${config.api.prefix}/quality` });
  await app.register(costRoutes, { prefix: `${config.api.prefix}/cost` });
  await app.register(alertsRoutes, { prefix: `${config.api.prefix}/alerts` });
  await app.register(decisionsRoutes, { prefix: config.api.prefix });
  await app.register(wsRoutes);
  
  app.setErrorHandler((error: FastifyError, request, reply) => {
    app.log.error({ error }, 'Unhandled error');
    
    if (error.validation) {
      reply.code(400).send({ error: 'Validation error', details: error.validation });
      return;
    }
    
    reply.code(error.statusCode || 500).send({
      error: error.message || 'Internal server error',
    });
  });
  
  return app;
}
