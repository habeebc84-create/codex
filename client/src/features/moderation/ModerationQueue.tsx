import { useState } from 'react';
import type { AlertItem } from '../../lib/types';
import { api } from '../../lib/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Badge, Button, EmptyState, SeverityBadge } from '../../components/ui';
import { formatTime } from '../../lib/socket';

type DecisionAction = 'approve' | 'dismiss' | 'false_positive';

const ACTION_LABEL: Record<DecisionAction, string> = {
  approve: 'Approve action',
  dismiss: 'Dismiss',
  false_positive: 'Mark false positive',
};

export function ModerationQueue({
  alerts,
  moderator,
  onChanged,
}: {
  alerts: AlertItem[];
  moderator: string | null;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<{ alert: AlertItem; action: DecisionAction } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/moderation/${pending.alert.message.id}/decision`, {
        action: pending.action,
        note: note || undefined,
      });
      setPending(null);
      setNote('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed');
    } finally {
      setBusy(false);
    }
  };

  if (alerts.length === 0) {
    return (
      <EmptyState
        title="Review queue is clear"
        body="Flagged messages will appear here for human review. Nothing is actioned automatically — every decision needs a moderator."
      />
    );
  }

  return (
    <div>
      {!moderator && (
        <p role="note" className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          You are not signed in as a moderator. Sign in from the header (demo login) to review alerts. Decisions are
          recorded with the moderator name and are never sent to Twitch automatically.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 text-sm text-rose-300">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {alerts.map((alert) => {
          const { message, analysis } = alert;
          return (
            <li key={message.id} className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={analysis.severity} />
                <Badge tone="violet">{analysis.riskCategory.replace('_', ' ')}</Badge>
                <Badge tone="slate">{analysis.engine === 'openai' ? 'OpenAI analysis' : 'Deterministic fallback'}</Badge>
                <Badge tone="slate">confidence {Math.round(analysis.confidence * 100)}%</Badge>
                <span className="ml-auto text-xs text-slate-500">{formatTime(message.createdAt)}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">
                <span className="font-semibold text-guard-300">{message.username}</span>
                {': '}
                {message.text}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{analysis.explanation}</p>
              {analysis.reasons.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">Signals: {analysis.reasons.join(' · ')}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Recommended: {analysis.recommendedAction.replace('_', ' ')} — human review required.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(Object.keys(ACTION_LABEL) as DecisionAction[]).map((action) => (
                  <Button
                    key={action}
                    variant={action === 'approve' ? 'danger' : 'secondary'}
                    disabled={!moderator || busy}
                    onClick={() => setPending({ alert, action })}
                  >
                    {ACTION_LABEL[action]}
                  </Button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === 'approve'
            ? 'Approve this moderation action?'
            : pending?.action === 'false_positive'
              ? 'Mark this alert a false positive?'
              : 'Dismiss this alert?'
        }
        body={
          pending && (
            <>
              <p>
                {pending.action === 'approve' ? (
                  <>
                    The recommended action is{' '}
                    <strong>{pending.alert.analysis.recommendedAction.replace('_', ' ')}</strong>. This is{' '}
                    <strong>recorded only and is not submitted to Twitch</strong> — this build requests only the
                    user:read:chat scope, and moderation actions need a scope it does not request. Nothing is sent
                    to Twitch without live credentials and scopes.
                  </>
                ) : (
                  'This decision is recorded in the audit trail with your moderator name and the time.'
                )}
              </p>
              <label className="mt-3 block">
                <span className="text-slate-300">Moderator note (optional)</span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={280}
                  className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 text-slate-100 placeholder:text-slate-500"
                  placeholder="Why this decision?"
                />
              </label>
            </>
          )
        }
        confirmLabel={pending ? ACTION_LABEL[pending.action] : 'Confirm'}
        danger={pending?.action === 'approve'}
        onConfirm={decide}
        onCancel={() => {
          setPending(null);
          setNote('');
        }}
      />
    </div>
  );
}
