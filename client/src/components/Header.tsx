import { useState } from 'react';
import { Bell, LogOut, Shield, User } from 'lucide-react';
import type { StatusPayload } from '../lib/schemas';
import { api } from '../lib/api';
import { Button } from './ui';

export function Header({
  status,
  socketState,
  moderator,
  pendingAlertCount,
  onNavigate,
  onModeratorChange,
}: {
  status: StatusPayload | null;
  socketState: string;
  moderator: string | null;
  pendingAlertCount: number;
  onNavigate: (view: string) => void;
  onModeratorChange: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [username, setUsername] = useState('Demo Moderator');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode = status?.mode ?? 'demo';
  const twitchState = status?.twitch.state ?? 'disconnected';

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/demo-login', { displayName: username.trim() || 'Demo Moderator' });
      setMenuOpen(false);
      onModeratorChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await api.post('/api/auth/logout');
      setMenuOpen(false);
      onModeratorChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/85 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-guard-500 to-spark-400 text-white"
          >
            <Shield size={20} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-tight text-slate-50">StreamGuardian AI</p>
            <p className="hidden truncate text-xs text-slate-400 sm:block">Safer Streams. Stronger Communities.</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Connection status: reflects the real server state. */}
          <span
            role="status"
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
              mode === 'live'
                ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30'
                : 'bg-amber-500/15 text-amber-300 ring-amber-400/30'
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${mode === 'live' ? 'bg-emerald-400 live-dot' : 'bg-amber-400'}`}
            />
            {mode === 'live' ? `Live · ${status?.twitch.channel ?? 'Twitch'}` : 'Demo Mode'}
          </span>
          <span className="hidden text-xs text-slate-400 md:block" title={`Twitch: ${twitchState}; socket: ${socketState}`}>
            Twitch: {twitchState} · Socket: {socketState}
          </span>

          <button
            type="button"
            onClick={() => onNavigate('moderation')}
            className="relative rounded-full bg-white/10 p-2 text-slate-200 hover:bg-white/15"
            aria-label={`${pendingAlertCount} pending moderation alerts — open review queue`}
          >
            <Bell size={18} aria-hidden="true" />
            {pendingAlertCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                {pendingAlertCount > 99 ? '99+' : pendingAlertCount}
              </span>
            )}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/15"
            >
              <User size={16} aria-hidden="true" />
              <span className="max-w-28 truncate">{moderator ?? 'Moderator'}</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-ink-900 p-4 shadow-2xl">
                {moderator ? (
                  <>
                    <p className="text-sm text-slate-300">
                      Signed in as <strong className="text-slate-100">{moderator}</strong> (demo session).
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      Demo-only authentication. Do not use this in production — replace with a real identity
                      provider.
                    </p>
                    <Button className="mt-3 w-full" disabled={busy} onClick={logout}>
                      <LogOut size={16} aria-hidden="true" /> Sign out
                    </Button>
                  </>
                ) : (
                  <form onSubmit={login}>
                    <p className="text-sm font-medium text-slate-100">Demo moderator sign-in</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      No password. This demo session only gates the review controls in this browser.
                    </p>
                    <label className="mt-3 block text-sm text-slate-300">
                      Display name
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        maxLength={40}
                        className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 text-slate-100"
                      />
                    </label>
                    {error && (
                      <p role="alert" className="mt-2 text-sm text-rose-300">
                        {error}
                      </p>
                    )}
                    <Button type="submit" variant="primary" className="mt-3 w-full" disabled={busy}>
                      {busy ? 'Signing in…' : 'Sign in as moderator'}
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
