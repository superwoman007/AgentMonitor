import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { verifyToken } from '../services/auth.js';
import { getProjectById } from '../services/project.js';
import { verifyServiceToken } from '../services/service-token.js';
import { config } from '../config.js';

interface WebSocketClient {
  socket: WebSocket;
  userId: string | null;
  projectId?: string;
  serviceTokenProjectId?: string;
  lastPing: number;
}

const clients: Set<WebSocketClient> = new Set();
// 按项目 ID 维护连接索引，广播时无需全量遍历全部连接。
const clientsByProject: Map<string, Set<WebSocketClient>> = new Map();
const MAX_CONNECTIONS = config.ws.maxConnections;
const MAX_PER_USER = config.ws.maxConnectionsPerUser;
const HEARTBEAT_INTERVAL = config.ws.heartbeatInterval;
const CONNECTION_TIMEOUT = config.ws.connectionTimeout;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 将连接加入项目广播索引
 * @param client - 待加入的客户端
 * @param projectId - 项目 ID
 */
function addToProjectIndex(client: WebSocketClient, projectId: string): void {
  let set = clientsByProject.get(projectId);
  if (!set) {
    set = new Set();
    clientsByProject.set(projectId, set);
  }
  set.add(client);
}

/**
 * 将连接从项目广播索引移除
 * @param client - 待移除的客户端
 */
function removeFromProjectIndex(client: WebSocketClient): void {
  if (client.projectId) {
    const set = clientsByProject.get(client.projectId);
    if (set) {
      set.delete(client);
      if (set.size === 0) clientsByProject.delete(client.projectId);
    }
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const client of clients) {
      if (now - client.lastPing > CONNECTION_TIMEOUT) {
        client.socket.close(1000, 'Connection timeout');
        clients.delete(client);
        removeFromProjectIndex(client);
      } else if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.ping();
      }
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * 向指定项目的全部在线连接广播消息（走项目索引）。
 * @param projectId - 项目 ID
 * @param message - 待发送的消息体
 */
export function broadcastToProject(projectId: string, message: unknown): void {
  const payload = JSON.stringify(message);
  const set = clientsByProject.get(projectId);
  if (!set) return;
  for (const client of set) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(payload);
    }
  }
}

export function broadcastToUser(userId: string, message: unknown): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.userId === userId && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(payload);
    }
  }
}

export function broadcastAll(message: unknown): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(payload);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}

interface AuthenticatedPrincipal {
  userId: string | null;
  serviceTokenProjectId?: string;
}

/**
 * 解析 WebSocket 连接的鉴权主体。
 * 凭据优先级：Authorization 头 → Sec-WebSocket-Protocol 子协议（bearer.<token>）→ query token（兼容旧客户端）。
 * 支持用户 JWT 与 Service Token（amt_ 前缀）。
 * @param request - Fastify 请求（握手阶段）
 * @returns 鉴权主体；失败返回 null
 */
async function authenticate(request: {
  headers: Record<string, unknown>;
  url?: string;
}): Promise<AuthenticatedPrincipal | null> {
  // 1. Authorization 头（浏览器 WS 无法自定义头，Node/后端客户端可用）
  const authHeader = request.headers['authorization'];
  let token: string | null = null;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // 2. Sec-WebSocket-Protocol 子协议，形如 "bearer.<jwt 或 amt token>"
  if (!token) {
    const protoHeader = request.headers['sec-websocket-protocol'];
    if (typeof protoHeader === 'string') {
      const protocols = protoHeader.split(',').map((p) => p.trim());
      const bearer = protocols.find((p) => p.startsWith('bearer.'));
      if (bearer) {
        token = bearer.slice('bearer.'.length);
      }
    }
  }

  // 3. query 参数 token（兼容旧前端；注意 token 可能出现在访问日志中，生产建议改用头/子协议）
  if (!token && request.url) {
    try {
      const url = new URL(request.url, 'http://localhost');
      token = url.searchParams.get('token');
    } catch {
      token = null;
    }
  }

  if (!token) return null;

  // Service Token
  if (token.startsWith('amt_')) {
    const result = await verifyServiceToken(token);
    if (!result.valid || !result.token) return null;
    return { userId: null, serviceTokenProjectId: result.projectId };
  }

  // 用户 JWT
  const payload = verifyToken(token);
  if (!payload) return null;
  return { userId: payload.userId };
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  startHeartbeat();

  app.addHook('onClose', () => {
    stopHeartbeat();
    for (const client of clients) {
      client.socket.close(1000, 'Server shutting down');
    }
    clients.clear();
    clientsByProject.clear();
  });

  app.get('/ws', { websocket: true }, (connection, request) => {
    const socket = connection as unknown as WebSocket;

    authenticate(request)
      .then((principal) => {
        if (!principal) {
          socket.close(4001, 'Authentication required or invalid token');
          return;
        }

        if (clients.size >= MAX_CONNECTIONS) {
          socket.close(4003, 'Max connections reached');
          return;
        }

        // Service Token 不占用按用户的连接配额；用户 JWT 校验每用户连接数。
        if (principal.userId) {
          let userConnections = 0;
          for (const c of clients) {
            if (c.userId === principal.userId) userConnections++;
          }
          if (userConnections >= MAX_PER_USER) {
            socket.close(4004, 'Max connections per user reached');
            return;
          }
        }

        const client: WebSocketClient = {
          socket,
          userId: principal.userId,
          serviceTokenProjectId: principal.serviceTokenProjectId,
          lastPing: Date.now(),
        };

        clients.add(client);
        app.log.info(
          { clientCount: clients.size, authType: principal.userId ? 'user' : 'service_token' },
          'WebSocket client connected'
        );

        socket.send(
          JSON.stringify({
            type: 'connected',
            userId: principal.userId,
            projectId: principal.serviceTokenProjectId ?? null,
          })
        );

        // Service Token 自动订阅其所属项目，无需再发 subscribe。
        if (principal.serviceTokenProjectId) {
          client.projectId = principal.serviceTokenProjectId;
          addToProjectIndex(client, principal.serviceTokenProjectId);
        }

        socket.on('pong', () => {
          client.lastPing = Date.now();
        });

        socket.on('message', async (data: Buffer) => {
          client.lastPing = Date.now();
          try {
            const message = JSON.parse(data.toString());

            if (message.type === 'subscribe' && message.projectId) {
              // Service Token 只能订阅自己所属项目；用户 JWT 校验项目归属。
              if (client.serviceTokenProjectId) {
                if (message.projectId !== client.serviceTokenProjectId) {
                  socket.send(JSON.stringify({ type: 'error', error: 'Project not authorized for this service token' }));
                  return;
                }
              } else if (client.userId) {
                const project = await getProjectById(message.projectId);
                if (!project || project.user_id !== client.userId) {
                  socket.send(JSON.stringify({ type: 'error', error: 'Project not found or unauthorized' }));
                  return;
                }
              } else {
                socket.send(JSON.stringify({ type: 'error', error: 'Unauthenticated' }));
                return;
              }

              removeFromProjectIndex(client);
              client.projectId = message.projectId;
              addToProjectIndex(client, message.projectId);
              socket.send(JSON.stringify({ type: 'subscribed', projectId: message.projectId }));
              app.log.info({ projectId: message.projectId }, 'Client subscribed to project');
            }

            if (message.type === 'ping') {
              socket.send(JSON.stringify({ type: 'pong' }));
            }
          } catch (error) {
            app.log.error({ error: error instanceof Error ? error.message : error }, 'Failed to parse WebSocket message');
          }
        });

        socket.on('close', () => {
          clients.delete(client);
          removeFromProjectIndex(client);
          app.log.info({ clientCount: clients.size }, 'WebSocket client disconnected');
        });

        socket.on('error', (error: Error) => {
          app.log.error({ error: error.message }, 'WebSocket error');
          clients.delete(client);
          removeFromProjectIndex(client);
        });
      })
      .catch(() => {
        socket.close(4001, 'Authentication failed');
      });
  });
}
