import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { verifyToken } from '../services/auth.js';
import { getProjectById } from '../services/project.js';
import { config } from '../config.js';

interface WebSocketClient {
  socket: WebSocket;
  userId: string;
  projectId?: string;
  lastPing: number;
}

const clients: Set<WebSocketClient> = new Set();
const MAX_CONNECTIONS = config.ws.maxConnections;
const MAX_PER_USER = config.ws.maxConnectionsPerUser;
const HEARTBEAT_INTERVAL = config.ws.heartbeatInterval;
const CONNECTION_TIMEOUT = config.ws.connectionTimeout;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const client of clients) {
      if (now - client.lastPing > CONNECTION_TIMEOUT) {
        client.socket.close(1000, 'Connection timeout');
        clients.delete(client);
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

export function broadcastToProject(projectId: string, message: unknown): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.projectId === projectId && client.socket.readyState === WebSocket.OPEN) {
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

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  startHeartbeat();

  app.addHook('onClose', () => {
    stopHeartbeat();
    for (const client of clients) {
      client.socket.close(1000, 'Server shutting down');
    }
    clients.clear();
  });

  app.get('/ws', { websocket: true }, (connection, request) => {
    const socket = connection as unknown as WebSocket;

    // Authenticate via query parameter token
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.close(4001, 'Authentication required');
      return;
    }

    const payload = verifyToken(token);
    if (!payload) {
      socket.close(4001, 'Invalid or expired token');
      return;
    }

    // Check max connections
    if (clients.size >= MAX_CONNECTIONS) {
      socket.close(4003, 'Max connections reached');
      return;
    }

    // Check per-user connection limit
    let userConnections = 0;
    for (const c of clients) {
      if (c.userId === payload.userId) userConnections++;
    }
    if (userConnections >= MAX_PER_USER) {
      socket.close(4004, 'Max connections per user reached');
      return;
    }

    const client: WebSocketClient = {
      socket,
      userId: payload.userId,
      lastPing: Date.now(),
    };

    clients.add(client);
    app.log.info({ clientCount: clients.size, userId: payload.userId }, 'WebSocket client connected');

    socket.send(JSON.stringify({ type: 'connected', userId: payload.userId }));

    socket.on('pong', () => {
      client.lastPing = Date.now();
    });

    socket.on('message', async (data: Buffer) => {
      client.lastPing = Date.now();
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'subscribe' && message.projectId) {
          // Verify project ownership
          const project = await getProjectById(message.projectId);
          if (!project || project.user_id !== client.userId) {
            socket.send(JSON.stringify({ type: 'error', error: 'Project not found or unauthorized' }));
            return;
          }
          client.projectId = message.projectId;
          socket.send(JSON.stringify({ type: 'subscribed', projectId: message.projectId }));
          app.log.info({ projectId: message.projectId, userId: client.userId }, 'Client subscribed to project');
        }

        if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        app.log.error({ error }, 'Failed to parse WebSocket message');
      }
    });

    socket.on('close', () => {
      clients.delete(client);
      app.log.info({ clientCount: clients.size }, 'WebSocket client disconnected');
    });

    socket.on('error', (error: Error) => {
      app.log.error({ error: error.message }, 'WebSocket error');
      clients.delete(client);
    });
  });
}
