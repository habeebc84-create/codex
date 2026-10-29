import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

/**
 * Session handling.
 *
 * DEMO-ONLY AUTH: this MVP has no user database. A moderator session is a
 * random token stored server-side in memory and sent as an HttpOnly,
 * SameSite=Lax cookie. In production this must be replaced with a real
 * identity provider and persistent, encrypted session storage.
 * Twitch OAuth sessions reuse the same mechanism and additionally hold
 * Twitch tokens server-side only (never in cookies, never logged).
 */

export interface Session {
  id: string;
  displayName: string;
  kind: 'demo' | 'twitch';
  twitchLogin: string | null;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sessions = new Map<string, Session>();

export function createSession(displayName: string, kind: Session['kind'], twitchLogin: string | null = null): Session {
  const now = Date.now();
  const session: Session = {
    id: randomBytes(24).toString('hex'),
    displayName,
    kind,
    twitchLogin,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(token: string | undefined): Session | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

export function clearSessions(): void {
  sessions.clear();
}

export const SESSION_COOKIE = 'sg_session';

export function setSessionCookie(res: Response, session: Session): void {
  res.cookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

declare global {
  namespace Express {
    interface Request {
      session?: Session | null;
    }
  }
}

export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  req.session = getSession(req.cookies?.[SESSION_COOKIE]);
  next();
}

/** Require a logged-in moderator session for privileged operations. */
export function requireModerator(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Moderator sign-in required.' } });
    return;
  }
  next();
}
