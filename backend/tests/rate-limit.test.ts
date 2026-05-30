import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import supertest from 'supertest';

describe('Rate Limiting', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('全局限流: 超过限制应返回 429', async () => {
    const statuses: number[] = [];
    // Send requests sequentially to avoid connection reset
    for (let i = 0; i < 110; i++) {
      const res = await supertest(app.server).get('/health');
      statuses.push(res.status);
      if (res.status === 429) break;
    }
    expect(statuses).toContain(429);
  });

  it('登录限流: 5次失败后应返回 429', async () => {
    const results = [];
    for (let i = 0; i < 7; i++) {
      const res = await supertest(app.server)
        .post('/api/auth/login')
        .send({ email: 'nonexist@test.com', password: 'wrong' });
      results.push(res.status);
    }
    // After 5 attempts, should get 429
    expect(results.filter(s => s === 429).length).toBeGreaterThan(0);
  });

  it('正常请求应包含 rate limit headers', async () => {
    const res = await supertest(app.server).get('/health');
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });
});
