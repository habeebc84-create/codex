import { useCallback, useEffect, useState } from 'react';
import type { AlertItem } from '../lib/types';
import type { ModerationDecision } from '../../../shared/src/types.js';
import { api } from '../lib/api';
import { Card, ErrorNotice, Spinner } from '../components/ui';
import { ModerationQueue } from '../features/moderation/ModerationQueue';
import { formatTime } from '../lib/socket';

export function ModerationView({
  alerts,
  moderator,
  refreshTick,
}: {
  alerts: AlertItem[];
  moderator: string | null;
  refreshTick: number;
}) {
  const [decisions, setDecisions] = useState<ModerationDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const loadDecisions = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ decisions: ModerationDecision[] }>('/api/decisions?limit=50');
      setDecisions(data.decisions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load decisions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDecisions();
  }, [loadDecisions, tick]);

  useEffect(() => {
    if (refreshTick > 0) void loadDecisions();
  }, [refreshTick, loadDecisions]);

  return (
    <div className="space-y-4">
      <Card
        title="AI Moderation — human review queue"
        description="The pipeline flags; a human decides. No message is ever timed out or banned automatically. Approving an action in Demo Mode records it only — it is not submitted to Twitch."
      >
        <ModerationQueue alerts={alerts} moderator={moderator} onChanged={() => setTick((t) => t + 1)} />
      </Card>

      <Card title="Decision audit trail" description="Every decision, who made it, and whether it was submitted to Twitch.">
        {loading && <Spinner label="Loading decisions…" />}
        {error && <ErrorNotice message={error} onRetry={loadDecisions} />}
        {!loading && !error && decisions.length === 0 && (
          <p className="text-sm text-slate-400">No decisions recorded yet.</p>
        )}
        <ul className="space-y-2">
          {decisions.map((d) => (
            <li key={d.id} className="rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm ring-1 ring-white/10">
              <p className="text-slate-200">
                <strong>{d.action.replace('_', ' ')}</strong> · message {d.messageId.slice(0, 8)}… · by {d.moderator}{' '}
                · {formatTime(d.createdAt)}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Submitted to Twitch: {d.submittedToTwitch ? 'yes' : 'no'}
                {d.submitDetail ? ` — ${d.submitDetail}` : ''}
              </p>
              {d.note && <p className="mt-0.5 text-xs text-slate-400">{d.note}</p>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
