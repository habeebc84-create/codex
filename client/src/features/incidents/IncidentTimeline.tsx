import { useEffect, useState } from 'react';
import type { ChatMessage, Incident, IncidentType, MessageAnalysis } from '../../../../shared/src/types.js';
import { api } from '../../lib/api';
import { Badge, Button, EmptyState, SeverityBadge, Spinner, ErrorNotice } from '../../components/ui';
import { formatTime } from '../../lib/socket';

type Filter = 'all' | IncidentType | 'high_risk';

const FILTERS: { id: Filter; label: string; type?: IncidentType }[] = [
  { id: 'all', label: 'All' },
  { id: 'spam_burst', label: 'Spam bursts', type: 'spam_burst' },
  { id: 'coordinated_activity', label: 'Coordinated', type: 'coordinated_activity' },
  { id: 'flagged_message', label: 'Flagged messages', type: 'flagged_message' },
  { id: 'moderator_review', label: 'Moderator reviews', type: 'moderator_review' },
  { id: 'high_risk', label: 'High & critical' },
];

export function IncidentTimeline() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Incident | null>(null);
  const [detailMessage, setDetailMessage] = useState<ChatMessage | null>(null);
  const [detailAnalysis, setDetailAnalysis] = useState<MessageAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (current: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const active = FILTERS.find((f) => f.id === current);
      const query = active?.type ? `?limit=50&type=${active.type}` : '?limit=50';
      const data = await api.get<{ incidents: Incident[] }>(`/api/incidents${query}`);
      setIncidents(
        current === 'high_risk'
          ? data.incidents.filter((i) => i.severity === 'high' || i.severity === 'critical')
          : data.incidents,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const openDetail = async (incident: Incident) => {
    setSelected(incident);
    setDetailMessage(null);
    setDetailAnalysis(null);
    try {
      const data = await api.get<{ incident: Incident; message: ChatMessage | null; analysis: MessageAnalysis | null }>(
        `/api/incidents/${incident.id}`,
      );
      setDetailMessage(data.message);
      setDetailAnalysis(data.analysis);
    } catch {
      /* Detail still shows the incident itself. */
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Filter incidents">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                filter === f.id ? 'bg-guard-600 text-white' : 'bg-white/10 text-slate-200 hover:bg-white/15'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {loading && <Spinner label="Loading incidents…" />}
        {error && <ErrorNotice message={error} onRetry={() => load(filter)} />}
        {!loading && !error && incidents.length === 0 && (
          <EmptyState
            title="No incidents yet"
            body="Incidents are created when the pipeline detects a spam burst or coordinated messages, when a message is flagged, and when a moderator records a decision."
          />
        )}
        <ol className="space-y-3">
          {incidents.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => openDetail(i)}
                aria-expanded={selected?.id === i.id}
                className={`w-full rounded-xl bg-white/[0.03] p-4 text-left ring-1 transition-colors hover:bg-white/[0.06] ${
                  selected?.id === i.id ? 'ring-guard-400' : 'ring-white/10'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={i.severity} />
                  <Badge tone="violet">{i.type.replace('_', ' ')}</Badge>
                  <Badge tone={i.status === 'open' ? 'amber' : 'slate'}>{i.status}</Badge>
                  <span className="ml-auto text-xs text-slate-500">{formatTime(i.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-100">{i.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{i.detail}</p>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div>
        {selected ? (
          <div className="glass rounded-2xl p-4 sm:p-5" aria-live="polite">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-100">Incident detail</h2>
              <Button onClick={() => setSelected(null)}>Close</Button>
            </div>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-100">{selected.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">{selected.detail}</p>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-slate-500">Type</dt>
                <dd className="text-slate-200">{selected.type.replace('_', ' ')}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-500">Severity</dt>
                <dd className="text-slate-200">{selected.severity}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-500">Status</dt>
                <dd className="text-slate-200">{selected.status}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-500">Created</dt>
                <dd className="text-slate-200">{formatTime(selected.createdAt)}</dd>
              </div>
              {selected.username && (
                <div className="flex gap-2">
                  <dt className="text-slate-500">User</dt>
                  <dd className="text-slate-200">{selected.username}</dd>
                </div>
              )}
            </dl>
            {detailMessage && (
              <div className="mt-4 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/10">
                <p className="text-sm text-slate-200">
                  <span className="font-semibold text-guard-300">{detailMessage.username}</span>
                  {': '}
                  {detailMessage.text}
                </p>
                {detailAnalysis && (
                  <p className="mt-1 text-xs text-slate-400">
                    {detailAnalysis.riskCategory.replace('_', ' ')} · {detailAnalysis.severity} ·{' '}
                    {detailAnalysis.explanation}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-slate-400">
            Select an incident to see its detail and the message behind it, when one is linked.
          </p>
        )}
      </div>
    </div>
  );
}
