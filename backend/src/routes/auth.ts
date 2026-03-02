import { FastifyInstance } from 'fastify';
import { register, login, getUserById } from '../services/auth.js';
import { authMiddleware } from '../middleware/auth.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', async (request, reply) => {
    const body = request.body as {
      email: string;
      password: string;
      name?: string;
    };
    
    if (!body.email || !body.password) {
      reply.code(400).send({ error: 'Email and password are required' });
      return;
    }
    
    if (body.password.length < 6) {
      reply.code(400).send({ error: 'Password must be at least 6 characters' });
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
  
  app.post('/login', async (request, reply) => {
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
      const message = error instanceof Error ? error.message : 'Login failed';
      reply.code(401).send({ error: message });
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
