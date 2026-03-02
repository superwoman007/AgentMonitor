import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { closeDb } from './db/index.js';
import { config } from './config.js';

async function main() {
  console.log('Starting AgentMonitor backend...');
  console.log(`Environment: ${config.nodeEnv}`);
  
  console.log('Running database migrations...');
  await runMigrations();
  
  const app = await buildApp();
  
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    try {
      await app.close();
      await closeDb();
      console.log('Server closed');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`Server listening on http://0.0.0.0:${config.port}`);
    console.log(`API prefix: ${config.api.prefix}`);
    console.log(`Health check: http://localhost:${config.port}/health`);
  } catch (error) {
    app.log.error(error, 'Failed to start server');
    await closeDb();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
