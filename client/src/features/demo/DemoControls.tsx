import { useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui';

const SCENARIOS = [
  { id: 'mixed', label: 'Mixed chat' },
  { id: 'spam_burst', label: 'Spam burst' },
  { id: 'toxic', label: 'Toxic flags' },
  { id: 'questions', label: 'Questions' },
  { id: 'calm', label: 'Calm chat' },
] as const;

const SPEEDS = [
  { value: 0.5, label: '0.5×' },
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 4, label: '4×' },
];

/**
 * Demo Mode controls. Every button calls a real server endpoint.
 * The server requires a moderator session for demo controls, so the
 * controls stay disabled with a sign-in prompt until one exists.
 */
export function DemoControls({
  running,
  speed,
  disabled,
  moderator,
  onChanged,
}: {
  running: boolean;
  speed: number;
  disabled: boolean;
  moderator: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<string>('mixed');

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Demo control failed');
    } finally {
      setBusy(false);
    }
  };

  const locked = disabled || !moderator;

  return (
    <div aria-label="Demo Mode controls">
      {!moderator && (
        <p role="note" className="mb-2 text-sm text-amber-200">
          Sign in as a moderator from the header to run the simulator — the server requires a moderator session for
          demo controls.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button disabled={busy || locked} onClick={() => act(() => api.post('/api/demo/pause'))}>
            <Pause size={16} aria-hidden="true" /> Pause simulator
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={busy || locked}
            onClick={() => act(() => api.post('/api/demo/start', { scenario }))}
          >
            <Play size={16} aria-hidden="true" /> Start simulator
          </Button>
        )}
        <Button disabled={busy || locked} onClick={() => act(() => api.post('/api/demo/reset'))}>
          <RotateCcw size={16} aria-hidden="true" /> Reset demo data
        </Button>
        <label className="ml-1 flex items-center gap-2 text-sm text-slate-300">
          Scenario
          <select
            value={scenario}
            disabled={busy || locked}
            onChange={(e) => {
              const next = e.target.value;
              setScenario(next);
              void act(() => api.post('/api/demo/scenario', { scenario: next }));
            }}
            className="rounded-full bg-white/10 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex items-center gap-1" disabled={busy || locked}>
          <legend className="sr-only">Simulator speed</legend>
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              type="button"
              disabled={busy || locked}
              aria-pressed={speed === s.value}
              onClick={() => act(() => api.post('/api/demo/speed', { speed: s.value }))}
              className={`rounded-full px-3 py-2 text-sm font-medium ${
                speed === s.value ? 'bg-guard-600 text-white' : 'bg-white/10 text-slate-200 hover:bg-white/15'
              } disabled:opacity-50`}
            >
              {s.label}
            </button>
          ))}
        </fieldset>
      </div>
      {disabled && (
        <p className="mt-2 text-sm text-slate-400">
          The simulator is paused while Twitch Live Mode is connected. Disconnect Twitch to run the demo.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
