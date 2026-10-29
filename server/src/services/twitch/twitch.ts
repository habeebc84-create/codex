import { randomBytes } from 'node:crypto';
import { config } from '../../config.js';

/**
 * Twitch integration (Helix + EventSub over WebSocket).
 *
 * Honesty rules:
 * - Tokens live server-side only, in memory, and are never logged or sent
 *   to the client. The client only ever sees the display name and state.
 * - If credentials are missing, every function reports "not configured"
 *   instead of pretending a connection exists.
 * - EventSub failures (bad subscription, 4xx, disconnect) surface as state
 *   changes with the error message, never as fake live data.
 * - Only one scope is requested: user:read:chat (read chat via EventSub).
 *   Moderation actions need moderator:manage:banned_users and are NOT
 *   requested or performed by this MVP; approved actions are recorded as
 *   "not submitted" with the reason.
 */

export const TWITCH_SCOPES = ['user:read:chat'] as const;

export interface OAuthState {
  state: string;
  createdAt: number;
  expiresAt: number;
}

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function createOAuthState(): OAuthState {
  const now = Date.now();
  return {
    state: randomBytes(16).toString('hex'),
    createdAt: now,
    expiresAt: now + OAUTH_STATE_TTL_MS,
  };
}

export function validateOAuthState(
  expected: OAuthState | undefined,
  received: string | undefined,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  if (!received || !expected) return { ok: false, reason: 'missing state' };
  if (now > expected.expiresAt) return { ok: false, reason: 'state expired' };
  if (received !== expected.state) return { ok: false, reason: 'state mismatch' };
  return { ok: true };
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.TWITCH_CLIENT_ID ?? '',
    redirect_uri: config.TWITCH_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: TWITCH_SCOPES.join(' '),
    state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string[];
}

async function postToken(
  body: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const response = await fetchImpl('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Twitch token exchange failed (HTTP ${response.status})${detail ? ': ' + detail.slice(0, 120) : ''}`);
  }
  return (await response.json()) as TokenResponse;
}

export async function exchangeCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return postToken(
    {
      client_id: config.TWITCH_CLIENT_ID ?? '',
      client_secret: config.TWITCH_CLIENT_SECRET ?? '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.TWITCH_REDIRECT_URI ?? '',
    },
    fetchImpl,
  );
}

export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return postToken(
    {
      client_id: config.TWITCH_CLIENT_ID ?? '',
      client_secret: config.TWITCH_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
    fetchImpl,
  );
}

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
}

/** Helix GET with 429 handling. Returns null on auth failure so callers can refresh. */
export async function helixGet<T>(
  path: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; data: T } | { ok: false; status: number; retryAfterMs: number }> {
  const response = await fetchImpl(`https://api.twitch.tv/helix${path}`, {
    headers: {
      'Client-Id': config.TWITCH_CLIENT_ID ?? '',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? '1');
    return { ok: false, status: 429, retryAfterMs: retryAfter * 1000 };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, retryAfterMs: 0 };
  }
  return { ok: true, data: (await response.json()) as T };
}

export async function fetchTwitchUser(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TwitchUser | null> {
  const result = await helixGet<{ data: Array<{ id: string; login: string; display_name: string; profile_image_url: string }> }>(
    '/users',
    accessToken,
    fetchImpl,
  );
  if (!result.ok || result.data.data.length === 0) return null;
  const u = result.data.data[0];
  return { id: u.id, login: u.login, displayName: u.display_name, profileImageUrl: u.profile_image_url };
}

export interface TwitchTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  user: TwitchUser;
}

export interface ChatEventInput {
  messageId: string;
  username: string;
  userId: string | null;
  text: string;
  channel: string;
  timestamp: string;
}

type MessageHandler = (event: ChatEventInput) => void;
type StateHandler = (state: string, detail?: string) => void;

const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';

/**
 * EventSub WebSocket client. Connects, waits for session_welcome, then
 * subscribes to channel.chat.message via Helix. Handles session_reconnect
 * and keepalive timeouts with bounded reconnection attempts.
 */
export class TwitchChatListener {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private stopped = false;
  private tokens: TwitchTokens;
  private onMessage: MessageHandler;
  private onState: StateHandler;
  private fetchImpl: typeof fetch;

  constructor(
    tokens: TwitchTokens,
    handlers: { onMessage: MessageHandler; onState: StateHandler },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.tokens = tokens;
    this.onMessage = handlers.onMessage;
    this.onState = handlers.onState;
    this.fetchImpl = fetchImpl;
  }

  start(): void {
    this.stopped = false;
    this.connect(EVENTSUB_WS_URL);
  }

  stop(): void {
    this.stopped = true;
    this.clearKeepalive();
    this.ws?.close();
    this.ws = null;
  }

  private connect(url: string): void {
    if (this.stopped) return;
    this.onState('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('message', (event) => {
      void this.handlePayload(String(event.data));
    });
    ws.addEventListener('close', () => {
      this.clearKeepalive();
      if (this.stopped) return;
      this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      // 'close' follows; reconnection is handled there.
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectAttempts >= 5) {
      this.onState('error', 'EventSub connection lost after repeated retries');
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    setTimeout(() => this.connect(EVENTSUB_WS_URL), delay);
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }

  private armKeepalive(seconds: number): void {
    this.clearKeepalive();
    this.keepaliveTimer = setTimeout(() => {
      this.ws?.close();
    }, seconds * 1000 + 5000);
  }

  private async handlePayload(raw: string): Promise<void> {
    let payload: {
      metadata?: { message_type?: string; message_id?: string };
      payload?: {
        session?: { id?: string; keepalive_timeout_seconds?: number; reconnect_url?: string };
        subscription?: { status?: string };
        event?: {
          message_id?: string;
          broadcaster_user_login?: string;
          chatter_user_login?: string;
          chatter_user_id?: string;
          message?: { text?: string };
        };
      };
    };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return;
    }
    const type = payload.metadata?.message_type;
    if (type === 'session_welcome') {
      this.sessionId = payload.payload?.session?.id ?? null;
      this.reconnectAttempts = 0;
      const keepalive = payload.payload?.session?.keepalive_timeout_seconds ?? 10;
      this.armKeepalive(keepalive);
      await this.subscribe();
      return;
    }
    if (type === 'session_keepalive') {
      this.armKeepalive(10);
      return;
    }
    if (type === 'session_reconnect') {
      const url = payload.payload?.session?.reconnect_url;
      this.clearKeepalive();
      this.ws?.close();
      if (url) this.connect(url);
      return;
    }
    if (type === 'notification') {
      const event = payload.payload?.event;
      if (!event?.message?.text || !event.chatter_user_login) return;
      this.onMessage({
        messageId: event.message_id ?? `twitch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        username: event.chatter_user_login,
        userId: event.chatter_user_id ?? null,
        text: event.message.text,
        channel: event.broadcaster_user_login ?? this.tokens.user.login,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (type === 'revocation') {
      this.onState('error', 'EventSub subscription revoked; reconnect Twitch to continue');
    }
  }

  private async subscribe(): Promise<void> {
    if (!this.sessionId) return;
    const response = await this.fetchImpl('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: {
        'Client-Id': config.TWITCH_CLIENT_ID ?? '',
        Authorization: `Bearer ${this.tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'channel.chat.message',
        version: '1',
        condition: {
          broadcaster_user_id: this.tokens.user.id,
          user_id: this.tokens.user.id,
        },
        transport: { method: 'websocket', session_id: this.sessionId },
      }),
    });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? '5');
      this.onState('error', `Twitch rate limit while subscribing; retrying in ${retryAfter}s`);
      setTimeout(() => void this.subscribe(), retryAfter * 1000);
      return;
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.onState('error', `EventSub subscription failed (HTTP ${response.status})${detail ? ': ' + detail.slice(0, 120) : ''}`);
      return;
    }
    this.onState('connected');
  }
}
