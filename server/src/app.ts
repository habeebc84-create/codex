import { createServer, type Server as HttpServer } from 'node:http';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { Store } from './db/store.js';
import { attachSession } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { createAuthRouter } from './routes/auth.js';
import { createDataRouter } from './routes/data.js';
import { RealtimeRunner } from './services/realtime/runner.js';

export interface AppHandles {
  app: Express;
  httpServer: HttpServer;
  io: SocketServer;
  store: Store;
  runner: RealtimeRunner;
}

export function createApp(dbPath: string = config.DATABASE_PATH): AppHandles {
  const store = new Store(dbPath);
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: config.CLIENT_URL, methods: ['GET', 'POST'] },
  });
  const runner = new RealtimeRunner(store, io);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: config.CLIENT_URL,
      credentials: true,
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
    }),
  );
  app.use(attachSession);

  app.use('/api/auth', createAuthRouter(runner));
  app.use('/api', createDataRouter(store, runner));

  io.on('connection', (socket) => {
    // Push current state immediately so a fresh client renders correctly.
    socket.emit('status:update', runner.getStatus());
    socket.on('disconnect', () => {
      // Nothing per-socket to clean up; the runner is process-wide.
    });
  });

  app.use(notFound);
  app.use(errorHandler);

  return { app, httpServer, io, store, runner };
}
