import { describe, expect, it } from 'vitest';
import { validateEnv } from '../src/config.js';
import {
  buildAuthorizeUrl,
  createOAuthState,
  validateOAuthState,
  TWITCH_SCOPES,
} from '../src/services/twitch/twitch.js';

describe('environment validation', () => {
  it('accepts a minimal dev environment', () => {
    const result = validateEnv({ NODE_ENV: 'development', PORT: '4000' });
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range port', () => {
    const result = validateEnv({ PORT: '99999' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid CLIENT_URL', () => {
    const result = validateEnv({ CLIENT_URL: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('accepts missing optional Twitch/OpenAI variables (Demo Mode)', () => {
    const result = validateEnv({ NODE_ENV: 'test' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TWITCH_CLIENT_ID).toBeUndefined();
      expect(result.data.OPENAI_API_KEY).toBeUndefined();
    }
  });
});

describe('Twitch OAuth state validation', () => {
  it('accepts a matching, unexpired state', () => {
    const state = createOAuthState();
    expect(validateOAuthState(state, state.state).ok).toBe(true);
  });

  it('rejects a mismatched state (CSRF protection)', () => {
    const state = createOAuthState();
    const result = validateOAuthState(state, 'different-state-value');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('state mismatch');
  });

  it('rejects an expired state', () => {
    const state = createOAuthState();
    const result = validateOAuthState(state, state.state, state.expiresAt + 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('state expired');
  });

  it('rejects a missing state', () => {
    expect(validateOAuthState(undefined, 'anything').ok).toBe(false);
    expect(validateOAuthState(createOAuthState(), undefined).ok).toBe(false);
  });

  it('generates unique random states', () => {
    const a = createOAuthState();
    const b = createOAuthState();
    expect(a.state).not.toBe(b.state);
    expect(a.state).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('Twitch authorize URL', () => {
  it('requests only the minimal documented scope', () => {
    expect(TWITCH_SCOPES).toEqual(['user:read:chat']);
    const url = new URL(buildAuthorizeUrl('test-state-123'));
    expect(url.hostname).toBe('id.twitch.tv');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('test-state-123');
    expect(url.searchParams.get('scope')).toBe('user:read:chat');
  });
});
