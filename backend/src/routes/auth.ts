import { FastifyInstance } from 'fastify';
import { register, login, getUserById, refreshAccessToken, validateEmail } from '../services/auth.js';
import { authMiddleware } from '../middleware/auth.js';
import { config } from '../config.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const authRateLimit = {
    config: {
      rateLimit: {
        max: config.rateLimit.auth.max,
        timeWindow: config.rateLimit.auth.timeWindow,
      },
    },
  };

  app.post('/register', authRateLimit, async (request, reply) => {
    const body = request.body as {
      email: string;
      password: string;
      name?: string;
    };

    if (!body.email || !body.password) {
      reply.code(400).send({ error: 'Email and password are required' });
      return;
    }

    if (!validateEmail(body.email)) {
      reply.code(400).send({ error: 'Invalid email format' });
      return;
    }

    try {
      const result = await register(body.email, body.password, body.name);
      reply.code(201).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      reply.code(400).send({ error: message });
    }
  });

  app.post('/login', authRateLimit, async (request, reply) => {
    const body = request.body as {
      email: string;
      password: string;
    };

    if (!body.email || !body.password) {
      reply.code(400).send({ error: 'Email and password are required' });
      return;
    }

    try {
      const result = await login(body.email, body.password);
      reply.send(result);
    } catch (error) {
      reply.code(401).send({ error: 'Invalid credentials' });
    }
  });

  app.post('/refresh', authRateLimit, async (request, reply) => {
    const body = request.body as { refreshToken: string };

    if (!body.refreshToken) {
      reply.code(400).send({ error: 'Refresh token is required' });
      return;
    }

    try {
      const result = await refreshAccessToken(body.refreshToken);
      reply.send(result);
    } catch (error) {
      reply.code(401).send({ error: 'Invalid or expired refresh token' });
    }
  });

  app.get('/me', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const user = await getUserById(request.userId);

    if (!user) {
      reply.code(404).send({ error: 'User not found' });
      return;
    }

    reply.send(user);
  });
}
