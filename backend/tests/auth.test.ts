import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Auth API', () => {
  let app: FastifyInstance;
  let testEmail: string;
  let testPassword: string;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    
    // 生成唯一测试邮箱
    testEmail = `test-${Date.now()}@example.com`;
    testPassword = 'Test123456!';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/auth/register', () => {
    it('应该成功注册新用户', async () => {
      const response = await request(app.server)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          name: 'Test User'
        })
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(testEmail);
      
      authToken = response.body.token;
    });

    it('应该拒绝重复邮箱注册', async () => {
      await request(app.server)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          name: 'Duplicate User'
        })
        .expect(400);
    });

    it('应该拒绝无效邮箱', async () => {
      await request(app.server)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: testPassword,
          name: 'Test User'
        })
        .expect(400);
    });

    it('应该拒绝弱密码', async () => {
      await request(app.server)
        .post('/api/auth/register')
        .send({
          email: `test-weak-${Date.now()}@example.com`,
          password: '123',
          name: 'Test User'
        })
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('应该成功登录', async () => {
      const response = await request(app.server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword
        })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(testEmail);
    });

    it('应该拒绝错误密码', async () => {
      await request(app.server)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!'
        })
        .expect(401);
    });

    it('应该拒绝不存在的用户', async () => {
      await request(app.server)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: testPassword
        })
        .expect(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('应该返回当前用户信息', async () => {
      const response = await request(app.server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.email).toBe(testEmail);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name');
    });

    it('应该拒绝无 token 的请求', async () => {
      await request(app.server)
        .get('/api/auth/me')
        .expect(401);
    });

    it('应该拒绝无效 token', async () => {
      await request(app.server)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });
});
