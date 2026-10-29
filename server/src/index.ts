import { config } from './config.js';
import { createApp } from './app.js';

const { httpServer, runner, store } = createApp();

httpServer.listen(config.PORT, () => {
  console.log(`[streamguardian] server listening on http://localhost:${config.PORT}`);
  console.log(
    `[streamguardian] mode: ${config.twitchConfigured ? 'Twitch configured — Demo Mode until OAuth connects' : 'Demo Mode only (Twitch credentials not configured)'}`,
  );
  console.log(
    `[streamguardian] AI engine: ${config.openaiConfigured ? 'OpenAI enabled (deterministic fallback on failure)' : 'deterministic fallback — no AI call will be made'}`,
  );
  // Seed demo content so the first visit shows a working dashboard.
  void runner.seedDemo().catch((err: unknown) => {
    console.error('[seed] demo seed failed:', err instanceof Error ? err.message : err);
  });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[streamguardian] ${signal} received — shutting down gracefully…`);
  runner.shutdown();
  httpServer.close(() => {
    store.close();
    console.log('[streamguardian] shutdown complete.');
    process.exit(0);
  });
  // Force exit if something hangs (e.g. an open socket).
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
