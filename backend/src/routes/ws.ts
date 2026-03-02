import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';

interface WebSocketClient {
  socket: WebSocket;
  projectId?: string;
  userId?: string;
}

const clients: Set<WebSocketClient> = new Set();

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

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (connection) => {
    const socket = connection as unknown as WebSocket;
    const client: WebSocketClient = {
      socket,
    };
    
    clients.add(client);
    app.log.info({ clientCount: clients.size }, 'WebSocket client connected');
    
    socket.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'subscribe' && message.projectId) {
          client.projectId = message.projectId;
          app.log.info({ projectId: message.projectId }, 'Client subscribed to project');
        }
        
        if (message.type === 'auth' && message.userId) {
          client.userId = message.userId;
          app.log.info({ userId: message.userId }, 'Client authenticated');
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
    
    socket.send(JSON.stringify({ type: 'connected' }));
  });
}
