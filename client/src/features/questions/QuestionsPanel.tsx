import { useState } from 'react';
import type { QuestionGroup } from '../../../../shared/src/types.js';
import { api } from '../../lib/api';
import { Badge, Button, EmptyState } from '../../components/ui';
import { formatTime } from '../../lib/socket';

export function QuestionsPanel({
  groups,
  moderator,
  onChanged,
}: {
  groups: QuestionGroup[];
  moderator: string | null;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const markAnswered = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.post(`/api/questions/${id}/answer`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark answered');
    } finally {
      setBusyId(null);
    }
  };

  const suggestReply = async (id: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ suggestion: { text: string }; note: string }>('/api/copilot/suggest-reply', {
        questionGroupId: id,
      });
      setNotice(`Suggestion created: “${res.suggestion.text}” — review it in Community Insights. ${res.note}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create a suggestion');
    } finally {
      setBusyId(null);
    }
  };

  if (groups.length === 0) {
    return (
      <EmptyState
        title="No questions detected yet"
        body="Genuine questions from chat are grouped here by topic so streamers can answer the most-asked ones first."
      />
    );
  }

  const open = groups.filter((g) => g.status === 'open');
  const answered = groups.filter((g) => g.status === 'answered');

  const renderGroup = (g: QuestionGroup) => (
    <li key={g.id} className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">{g.count} {g.count === 1 ? 'ask' : 'asks'}</Badge>
        {g.status === 'answered' && <Badge tone="emerald">answered</Badge>}
        <span className="text-xs text-slate-500">first asked by {g.username}</span>
        <span className="ml-auto text-xs text-slate-500">
          first {formatTime(g.createdAt)} · last {formatTime(g.lastSeenAt)}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-200">{g.representativeText}</p>
      {g.status === 'open' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={!moderator || busyId === g.id} onClick={() => markAnswered(g.id)}>
            {busyId === g.id ? 'Saving…' : 'Mark answered'}
          </Button>
          <Button disabled={!moderator || busyId === g.id} onClick={() => suggestReply(g.id)}>
            Suggest a reply
          </Button>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-300">
          {notice}
        </p>
      )}
      {!moderator && (
        <p role="note" className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Sign in as a moderator (header, demo login) to mark questions answered or create reply suggestions.
        </p>
      )}
      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Unanswered ({open.length})
        </h3>
        {open.length === 0 ? (
          <p className="text-sm text-slate-400">All detected questions are answered.</p>
        ) : (
          <ul className="space-y-3">{open.map(renderGroup)}</ul>
        )}
      </div>
      {answered.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Answered ({answered.length})
          </h3>
          <ul className="space-y-3">{answered.map(renderGroup)}</ul>
        </div>
      )}
    </div>
  );
}
