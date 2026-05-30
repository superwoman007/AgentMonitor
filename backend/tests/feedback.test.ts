import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('User Feedback API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let apiKey: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-feedback-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test12345678!', name: 'Feedback Test User' });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Feedback Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Feedback Test Key' });

    apiKey = keyResponse.body.key;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/feedbacks', () => {
    it('should create feedback with auth token', async () => {
      const response = await request(app.server)
        .post('/api/feedbacks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          projectId,
          sessionId: 'session-1',
          messageId: 'msg-1',
          rating: 1,
          reason: 'helpful',
          comment: 'Great response!',
          dimensions: { accuracy: 5, relevance: 4 },
        })
        .expect(201);

      expect(response.body).toHaveProperty('feedback');
      expect(response.body.feedback.rating).toBe(1);
      expect(response.body.feedback.reason).toBe('helpful');
      expect(response.body.feedback.comment).toBe('Great response!');
    });

    it('should create feedback with API key', async () => {
      const response = await request(app.server)
        .post('/api/feedbacks')
        .set('X-API-Key', apiKey)
        .send({
          sessionId: 'session-2',
          messageId: 'msg-2',
          rating: -1,
          reason: 'incorrect',
          comment: 'Wrong answer',
        })
        .expect(201);

      expect(response.body).toHaveProperty('feedback');
      expect(response.body.feedback.rating).toBe(-1);
      expect(response.body.feedback.reason).toBe('incorrect');
    });

    it('should reject invalid rating', async () => {
      await request(app.server)
        .post('/api/feedbacks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          projectId,
          rating: 5,
          reason: 'helpful',
        })
        .expect(400);
    });

    it('should reject unauthorized', async () => {
      await request(app.server)
        .post('/api/feedbacks')
        .send({ rating: 1, reason: 'helpful' })
        .expect(401);
    });
  });

  describe('GET /api/feedbacks', () => {
    it('should return feedback list for project', async () => {
      const response = await request(app.server)
        .get(`/api/feedbacks?projectId=${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('feedbacks');
      expect(Array.isArray(response.body.feedbacks)).toBe(true);
      expect(response.body.feedbacks.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by rating', async () => {
      const response = await request(app.server)
        .get(`/api/feedbacks?projectId=${projectId}&rating=-1`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.feedbacks.length).toBeGreaterThanOrEqual(1);
      expect(response.body.feedbacks[0].rating).toBe(-1);
    });

    it('should reject missing projectId', async () => {
      await request(app.server)
        .get('/api/feedbacks')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('GET /api/feedbacks/stats', () => {
    it('should return feedback stats', async () => {
      const response = await request(app.server)
        .get(`/api/feedbacks/stats?projectId=${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('stats');
      expect(response.body.stats).toHaveProperty('total');
      expect(response.body.stats).toHaveProperty('positive');
      expect(response.body.stats).toHaveProperty('negative');
      expect(response.body.stats).toHaveProperty('positiveRate');
      expect(response.body.stats.total).toBeGreaterThanOrEqual(2);
    });
  });
});
