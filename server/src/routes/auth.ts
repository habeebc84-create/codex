import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import {
  clearSessionCookie,
  clearSessions,
  createSession,
  destroySession,
  requireModerator,
  setSessionCookie,
} from '../middleware/auth.js';
import { parseBody } from '../middleware/errors.js';
import {
  buildAuthorizeUrl,
  createOAuthState,
  exchangeCode,
  validateOAuthState,
  type OAuthState,
} from '../services/twitch/twitch.js';
import type { RealtimeRunner } from '../services/realtime/runner.js';

const demoLoginSchema = z.object({
  displayName: z.string().trim().min(1).max(30).default('Demo Moderator'),
});

const demoLoginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Please wait a minute and try again.' } },
});

export function createAuthRouter(runner: RealtimeRunner): Router {
  const router = Router();
  let pendingState: OAuthState | null = null;

  router.post('/demo-login', demoLoginLimiter, (req, res) => {
    const parsed = parseBody(demoLoginSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ error: { code: 'invalid_body', message: parsed.message } });
      return;
    }
    const session = createSession(parsed.data.displayName, 'demo');
    setSessionCookie(res, session);
    res.json({
      session: { displayName: session.displayName, kind: session.kind, twitchLogin: null },
      mode: 'demo',
      note: 'Demo-only session. No Twitch credentials are involved.',
    });
  });

  router.post('/logout', (req, res) => {
    destroySession(req.cookies?.sg_session);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    if (!req.session) {
      res.json({ session: null });
      return;
    }
    res.json({
      session: {
        displayName: req.session.displayName,
        kind: req.session.kind,
        twitchLogin: req.session.twitchLogin,
      },
    });
  });

  // --- Twitch OAuth ---------------------------------------------------------
  // Real authorization-code flow. The client secret and tokens never leave
  // the server. State is a single-use random value validated on callback.

  router.get('/twitch', (req, res) => {
    if (!config.twitchConfigured) {
      res.status(503).json({
        error: {
          code: 'twitch_not_configured',
          message: 'Twitch credentials are not configured. Set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET and TWITCH_REDIRECT_URI, then restart. Demo Mode remains available.',
        },
      });
      return;
    }
    const state = createOAuthState();
    pendingState = state;
    res.cookie('sg_oauth_state', state.state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(buildAuthorizeUrl(state.state));
  });

  router.get('/twitch/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const cookieState = req.cookies?.sg_oauth_state as string | undefined;
    const errorParam = typeof req.query.error === 'string' ? req.query.error : undefined;

    const fail = (message: string) => {
      res.redirect(`${config.CLIENT_URL}/settings?twitch=error&reason=${encodeURIComponent(message)}`);
    };

    if (errorParam) {
      fail(`Twitch authorization was ${errorParam}.`);
      return;
    }
    if (!code) {
      fail('Missing authorization code.');
      return;
    }
    const validation = validateOAuthState(
      pendingState && cookieState === pendingState.state ? pendingState : undefined,
      state,
    );
    pendingState = null;
    res.clearCookie('sg_oauth_state', { path: '/' });
    if (!validation.ok) {
      fail(`OAuth state validation failed: ${validation.reason}.`);
      return;
    }
    try {
      const tokens = await exchangeCode(code);
      await runner.connectTwitch({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        scopes: tokens.scope,
      });
      const session = createSession(
        runner.twitchTokens?.user.displayName ?? 'Twitch user',
        'twitch',
        runner.twitchTokens?.user.login ?? null,
      );
      setSessionCookie(res, session);
      res.redirect(`${config.CLIENT_URL}/settings?twitch=connected`);
    } catch {
      // Token exchange failures never leak provider details to the client.
      fail('Could not complete Twitch authorization. Please try again.');
    }
  });

  router.post('/twitch/disconnect', requireModerator, (_req, res) => {
    runner.disconnectTwitch();
    res.json({ ok: true, mode: 'demo' });
  });

  // Test-only helper (never exposed in production builds of the API docs):
  // clears all in-memory sessions. Used by the automated test suite.
  router.post('/_test/clear-sessions', (_req, res) => {
    if (config.NODE_ENV === 'production') {
      res.status(404).json({ error: { code: 'not_found', message: 'Resource not found.' } });
      return;
    }
    clearSessions();
    res.json({ ok: true });
  });

  return router;
}
