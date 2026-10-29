import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppHandles } from '../src/app.js';

let handles: AppHandles;
let base: string;

function cookieFrom(res: Response): string | null {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

async function demoLogin(): Promise<string> {
  const res = await fetch(`${base}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Test Mod' }),
  });
  expect(res.status).toBe(200);
  const cookie = cookieFrom(res);
  expect(cookie).toBeTruthy();
  return cookie as string;
}

beforeAll(async () => {
  handles = createApp(':memory:');
  await new Promise<void>((resolve) => {
    handles.httpServer.listen(0, () => resolve());
  });
  const address = handles.httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
  // Seed one flagged message via the pipeline so moderation endpoints have data.
  const { processIncomingEvent } = await import('../src/services/realtime/pipeline.js');
  await processIncomingEvent(
    { username: 'spammer', text: 'FOLLOW 4 FOLLOW check out my channel!!', channel: 'demo', source: 'demo' },
    { store: handles.store, broadcast: () => {}, aiEnabled: false },
  );
});

afterAll(async () => {
  handles.runner.shutdown();
  await new Promise<void>((resolve) => handles.httpServer.close(() => resolve()));
  handles.store.close();
});

describe('API errors and safe shapes', () => {
  it('returns a safe 404 shape for unknown routes', async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).not.toMatch(/stack|node_modules/i);
  });

  it('returns 400 for an invalid decision body', async () => {
    const cookie = await demoLogin();
    const alerts = (await (await fetch(`${base}/api/alerts`)).json()) as { alerts: Array<{ message: { id: string } }> };
    const messageId = alerts.alerts[0].message.id;
    const res = await fetch(`${base}/api/moderation/${messageId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'explode' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a decision on a missing message', async () => {
    const cookie = await demoLogin();
    const res = await fetch(`${base}/api/moderation/does-not-exist/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'dismiss' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when a clean message is sent for review', async () => {
    const cookie = await demoLogin();
    const { processIncomingEvent } = await import('../src/services/realtime/pipeline.js');
    const { message } = await processIncomingEvent(
      { username: 'nice', text: 'great stream, thanks!', channel: 'demo', source: 'demo' },
      { store: handles.store, broadcast: () => {}, aiEnabled: false },
    );
    const res = await fetch(`${base}/api/moderation/${message.id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'dismiss' }),
    });
    expect(res.status).toBe(409);
  });
});

describe('moderation authorization', () => {
  it('rejects unauthenticated moderation decisions with 401', async () => {
    const alerts = (await (await fetch(`${base}/api/alerts`)).json()) as { alerts: Array<{ message: { id: string } }> };
    const messageId = alerts.alerts[0].message.id;
    const res = await fetch(`${base}/api/moderation/${messageId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated question answering with 401', async () => {
    const res = await fetch(`${base}/api/questions/abc/answer`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('records an authenticated decision as not submitted to Twitch', async () => {
    const cookie = await demoLogin();
    const alerts = (await (await fetch(`${base}/api/alerts`)).json()) as { alerts: Array<{ message: { id: string } }> };
    const messageId = alerts.alerts[0].message.id;
    const res = await fetch(`${base}/api/moderation/${messageId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'approve', note: 'reviewed in test' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { decision: { submittedToTwitch: boolean; submitDetail: string } };
    expect(body.decision.submittedToTwitch).toBe(false);
    expect(body.decision.submitDetail).toMatch(/Not submitted/);
  });
});

describe('status and demo endpoints', () => {
  it('reports Demo Mode when Twitch is not configured', async () => {
    const res = await fetch(`${base}/api/status`);
    const body = (await res.json()) as { mode: string; twitch: { state: string }; ai: { engine: string } };
    expect(body.mode).toBe('demo');
    expect(body.twitch.state).toBe('disconnected');
    expect(body.ai.engine).toBe('deterministic');
  });

  it('rejects demo start without a session', async () => {
    const res = await fetch(`${base}/api/demo/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('starts and pauses the simulator with a session', async () => {
    const cookie = await demoLogin();
    const start = await fetch(`${base}/api/demo/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ scenario: 'calm', speed: 1 }),
    });
    expect(start.status).toBe(200);
    const pause = await fetch(`${base}/api/demo/pause`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(pause.status).toBe(200);
  });
});

describe('rate limiting', () => {
  it('rate-limits repeated demo logins', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await fetch(`${base}/api/auth/demo-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Spammer' }),
      });
      statuses.push(res.status);
    }
    // 10 allowed per minute on this endpoint; at least one must be 429.
    expect(statuses).toContain(429);
  });
});

