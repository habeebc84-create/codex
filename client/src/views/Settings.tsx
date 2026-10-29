import { useState } from 'react';
import { Twitch } from 'lucide-react';
import type { StatusPayload } from '../../../shared/src/types.js';
import { api } from '../lib/api';
import { Badge, Button, Card } from '../components/ui';
import { DemoControls } from '../features/demo/DemoControls';

export function SettingsView({
  status,
  moderator,
  twitchNotice,
  onChanged,
}: {
  status: StatusPayload | null;
  moderator: string | null;
  twitchNotice: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<{ ok: boolean; mode: string }>('/api/auth/twitch/disconnect');
      setNotice('Twitch disconnected. The app is back in Demo Mode.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  };

  const mode = status?.mode ?? 'demo';
  const twitch = status?.twitch;
  const ai = status?.ai;

  return (
    <div className="space-y-4">
      {twitchNotice && (
        <div role="status" className="rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
          {twitchNotice}
        </div>
      )}

      <Card title="Connection" description="What this app is actually connected to — no simulated connection is ever shown as live.">
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="w-36 text-slate-400">Mode</dt>
            <dd>
              <Badge tone={mode === 'live' ? 'emerald' : 'amber'}>{mode === 'live' ? 'Live' : 'Demo Mode'}</Badge>
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-36 text-slate-400">Twitch</dt>
            <dd className="text-slate-200">
              {twitch?.state ?? 'disconnected'}
              {twitch?.login ? ` · signed in as ${twitch.login}` : ''}
              {twitch?.channel ? ` · channel ${twitch.channel}` : ''}
            </dd>
          </div>
          {twitch?.lastError && (
            <div className="flex flex-wrap gap-2">
              <dt className="w-36 text-slate-400">Last Twitch error</dt>
              <dd className="text-rose-300">{twitch.lastError}</dd>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <dt className="w-36 text-slate-400">Scopes requested</dt>
            <dd className="text-slate-200">{twitch?.scopes.length ? twitch.scopes.join(', ') : 'user:read:chat (only scope requested)'}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-36 text-slate-400">AI engine</dt>
            <dd className="text-slate-200">
              {ai?.engine === 'openai' ? 'OpenAI (API key configured)' : 'Deterministic fallback — no AI call made'}
              {ai?.note ? ` · ${ai.note}` : ''}
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-36 text-slate-400">Simulator</dt>
            <dd className="text-slate-200">
              {status?.simulator.running ? 'running' : 'stopped'} · {status?.simulator.speed ?? 1}× ·{' '}
              {status?.simulator.emitted ?? 0} messages emitted
            </dd>
          </div>
        </dl>

        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3 text-sm text-emerald-300">
            {notice}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {mode === 'live' ? (
            <Button variant="danger" disabled={busy || !moderator} onClick={disconnect}>
              Disconnect Twitch
            </Button>
          ) : (
            <a
              href="/api/auth/twitch"
              className="inline-flex items-center gap-2 rounded-full bg-guard-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-guard-500"
            >
              <Twitch size={16} aria-hidden="true" /> Connect with Twitch
            </a>
          )}
        </div>
        {!moderator && mode === 'live' && (
          <p className="mt-2 text-sm text-amber-200">Sign in as a moderator to disconnect Twitch.</p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Connecting with Twitch requires TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and TWITCH_REDIRECT_URI in the
          server environment. If they are missing, the connect link returns a clear error instead of pretending to
          work. The OAuth callback validates a one-time state value and keeps tokens on the server only.
        </p>
      </Card>

      <Card title="Demo Mode" description="Simulated chat, honestly labelled.">
        <DemoControls
          running={status?.simulator.running ?? false}
          speed={status?.simulator.speed ?? 1}
          disabled={mode === 'live'}
          moderator={moderator}
          onChanged={onChanged}
        />
      </Card>

      <Card title="Security notes" description="How this demo handles access — read before running it anywhere public.">
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-300">
          <li>
            Moderator sign-in is a <strong>demo-only session cookie</strong> (HttpOnly, SameSite=Lax). It is not real
            authentication. Replace it with a real identity provider before any production use.
          </li>
          <li>Secrets live only in environment variables. Nothing secret is logged or sent to the browser.</li>
          <li>Chat text is untrusted input: it is stored verbatim, rendered as plain text, and sent to OpenAI only as JSON data — never as instructions.</li>
          <li>Moderation actions are never automatic and are never submitted to Twitch without live credentials and scopes.</li>
          <li>Rate limits apply to login, demo controls, and moderation endpoints.</li>
          <li>Data is stored in a local SQLite file (data/streamguardian.db) for the demo. Delete the file to wipe demo data.</li>
        </ul>
      </Card>
    </div>
  );
}
