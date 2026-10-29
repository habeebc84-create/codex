import { useState } from 'react';
import type { CopilotSuggestion } from '../../../../shared/src/types.js';
import { api } from '../../lib/api';
import { Badge, Button, EmptyState } from '../../components/ui';

export interface CopilotSummaryData {
  headline: string;
  bullets: string[];
  unansweredQuestions: number;
  openAlerts: number;
  flaggedInWindow: number;
  windowMinutes: number;
  generatedAt: string;
  engineNote: string;
}

export function CopilotPanel({
  summary,
  suggestions,
  mode,
  moderator,
  onChanged,
}: {
  summary: CopilotSummaryData | null;
  suggestions: CopilotSuggestion[];
  mode: 'demo' | 'live';
  moderator: string | null;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const decide = async (id: string, action: 'approve' | 'dismiss') => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ note?: string; status: string }>(`/api/copilot/suggestions/${id}/${action}`);
      setNotice(res.note ?? `Suggestion ${res.status}.`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Copilot action failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <section aria-labelledby="copilot-summary-heading">
        <h3 id="copilot-summary-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Stream summary
        </h3>
        {summary ? (
          <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
            <p className="font-medium text-slate-100">{summary.headline}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-300">
              {summary.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Window: last {summary.windowMinutes} minutes · {summary.unansweredQuestions} unanswered question groups ·{' '}
              {summary.openAlerts} open alerts. {summary.engineNote}
            </p>
          </div>
        ) : (
          <EmptyState title="No summary yet" body="Summaries appear once chat has flowed through the pipeline." />
        )}
      </section>

      <section aria-labelledby="copilot-suggestions-heading">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 id="copilot-suggestions-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Suggested replies
          </h3>
          <Badge tone="amber">Approval required — nothing is sent automatically</Badge>
          {mode === 'demo' && <Badge tone="slate">Sends disabled in Demo Mode</Badge>}
        </div>
        {error && (
          <p role="alert" className="mb-2 text-sm text-rose-300">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mb-2 text-sm text-emerald-300">
            {notice}
          </p>
        )}
        {suggestions.length === 0 ? (
          <EmptyState
            title="No suggestions yet"
            body="From Important Questions, use “Suggest a reply” on a question group. Each suggestion waits for a moderator to approve or dismiss it."
          />
        ) : (
          <ul className="space-y-3">
            {suggestions.map((s) => (
              <li key={s.id} className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="violet">{s.kind}</Badge>
                  <Badge tone={s.status === 'pending' ? 'amber' : 'slate'}>{s.status}</Badge>
                  <span className="ml-auto text-xs text-slate-500">{new Date(s.createdAt).toLocaleTimeString()}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-200">{s.text}</p>
                {s.status === 'pending' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      disabled={!moderator || busyId === s.id}
                      onClick={() => decide(s.id, 'approve')}
                    >
                      Approve
                    </Button>
                    <Button disabled={!moderator || busyId === s.id} onClick={() => decide(s.id, 'dismiss')}>
                      Dismiss
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!moderator && (
          <p className="mt-2 text-sm text-slate-400">Sign in as a moderator (header, demo login) to approve or dismiss suggestions.</p>
        )}
      </section>
    </div>
  );
}
