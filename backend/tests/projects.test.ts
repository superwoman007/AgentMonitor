import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Projects API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  const testEmail = `test-projects-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 注册并登录测试用户
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'Project Test User'
      });
    
    authToken = registerResponse.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/projects', () => {
    it('应该成功创建项目', async () => {
      const response = await request(app.server)
        .post('/api/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Project',
          description: 'A test project'
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Test Project');
      expect(response.body.description).toBe('A test project');
      
      projectId = response.body.id;
    });

    it('应该拒绝未认证的请求', async () => {
      await request(app.server)
        .post('/api/projects')
        .send({
          name: 'Unauthorized Project'
        })
        .expect(401);
    });

    it('应该拒绝空项目名', async () => {
      await request(app.server)
        .post('/api/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: ''
        })
        .expect(400);
    });
  });

  describe('GET /api/projects', () => {
    it('应该返回项目列表', async () => {
      const response = await request(app.server)
        .get('/api/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('name');
    });

    it('应该拒绝未认证的请求', async () => {
      await request(app.server)
        .get('/api/projects')
        .expect(401);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('应该返回项目详情', async () => {
      const response = await request(app.server)
        .get(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe(projectId);
      expect(response.body.name).toBe('Test Project');
    });

    it('应该拒绝访问不存在的项目', async () => {
      await request(app.server)
        .get('/api/projects/99999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('PUT /api/projects/:id', () => {
    it('应该成功更新项目', async () => {
      const response = await request(app.server)
        .put(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Updated Project',
          description: 'Updated description'
        })
        .expect(200);

      expect(response.body.name).toBe('Updated Project');
      expect(response.body.description).toBe('Updated description');
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('应该成功删除项目', async () => {
      await request(app.server)
        .delete(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // 验证项目已删除
      await request(app.server)
        .get(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });
});
