import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { queryOne } from '../db/index.js';
import { getDatasetById } from '../services/evaluation.js';
import { getProjectById } from '../services/project.js';
import {
  diffDatasetVersions,
  getDatasetVersionItem,
  listDatasetVersionItems,
} from '../services/dataset-version-item.js';

/**
 * 校验当前用户是否拥有指定项目。
 * @param userId - 用户 ID
 * @param projectId - 项目 ID
 * @returns 项目存在且属于该用户返回 true
 */
async function userOwnsProject(userId: string, projectId: string): Promise<boolean> {
  const project = await getProjectById(projectId);
  return !!project && project.user_id === userId;
}

/**
 * 根据 datasetVersionId 反查项目归属。
 * @param datasetVersionId - DatasetVersion ID
 * @returns 项目 ID 或 null
 */
async function findProjectIdForVersion(datasetVersionId: string): Promise<string | null> {
  const row = await queryOne<{ project_id: string }>(
    `SELECT d.project_id AS project_id
       FROM dataset_versions dv
       JOIN datasets d ON d.id = dv.dataset_id
      WHERE dv.id = $1`,
    [datasetVersionId]
  );
  return row?.project_id ?? null;
}

/**
 * 注册 DatasetVersionItem V2 只读路由。
 * 写入路径统一走 DatasetVersion 提交（POST /api/evaluation/datasets/:id/versions）。
 * @param app - Fastify 实例
 * @returns 无返回值
 */
export async function datasetVersionItemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dataset-versions/:id/items', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await findProjectIdForVersion(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Dataset version not found' });
      return;
    }
    const items = await listDatasetVersionItems(params.id);
    reply.send({ items });
  });

  app.get('/dataset-versions/:id/items/:caseKey', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string; caseKey: string };
    const projectId = await findProjectIdForVersion(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Dataset version not found' });
      return;
    }
    const item = await getDatasetVersionItem(params.id, decodeURIComponent(params.caseKey));
    if (!item) {
      reply.code(404).send({ error: 'Case not found' });
      return;
    }
    reply.send({ item });
  });

  app.get('/datasets/:id/versions/diff', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const query = request.query as { baselineVersionId?: string; candidateVersionId?: string };
    const dataset = await getDatasetById(params.id);
    if (!dataset || !(await userOwnsProject(request.userId, dataset.project_id))) {
      reply.code(404).send({ error: 'Dataset not found' });
      return;
    }
    if (!query.baselineVersionId || !query.candidateVersionId) {
      reply.code(400).send({ error: 'baselineVersionId and candidateVersionId are required' });
      return;
    }
    const diff = await diffDatasetVersions(query.baselineVersionId, query.candidateVersionId);
    reply.send(diff);
  });
}
