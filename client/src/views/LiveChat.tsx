import { useEffect, useMemo, useState } from 'react';
import type { ChatMessage, MessageAnalysis, StatusPayload } from '../../../shared/src/types.js';
import { api } from '../lib/api';
import { Card, EmptyState } from '../components/ui';
import { ChatFeed } from '../features/chat/ChatFeed';
import { DemoControls } from '../features/demo/DemoControls';
import type { AlertItem } from '../lib/types';

type Filter = 'all' | 'flagged' | 'questions' | 'negative';

export function LiveChatView({
  messages,
  analyses,
  status,
  moderator,
}: {
  messages: ChatMessage[];
  analyses: Map<string, MessageAnalysis>;
  status: StatusPayload | null;
  moderator: string | null;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [historyAnalyses, setHistoryAnalyses] = useState<Map<string, MessageAnalysis>>(new Map());

  // Load stored history once so the feed is not empty on reload, plus the
  // analyses of flagged messages so history shows the same badges as live.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ messages: ChatMessage[] }>('/api/messages?limit=100'),
      api.get<{ alerts: AlertItem[] }>('/api/alerts?limit=100'),
    ])
      .then(([msgData, alertData]) => {
        if (cancelled) return;
        setHistory(msgData.messages);
        const map = new Map<string, MessageAnalysis>();
        for (const a of alertData.alerts) map.set(a.message.id, a.analysis);
        setHistoryAnalyses(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const allAnalyses = useMemo(() => {
    const merged = new Map(historyAnalyses);
    for (const [id, a] of analyses) merged.set(id, a);
    return merged;
  }, [historyAnalyses, analyses]);

  // Merge stored history with live socket messages, deduped by id.
  const merged = useMemo(() => {
    const byId = new Map<string, ChatMessage>();
    for (const m of history) byId.set(m.id, m);
    for (const m of messages) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [history, messages]);

  const visible = useMemo(() => {
    switch (filter) {
      case 'flagged':
        return merged.filter((m) => {
          const a = allAnalyses.get(m.id);
          return a && a.riskCategory !== 'clean';
        });
      case 'questions':
        return merged.filter((m) => m.isQuestion);
      case 'negative':
        return merged.filter((m) => m.sentiment === 'negative');
      default:
        return merged;
    }
  }, [merged, filter, allAnalyses]);

  const counts = useMemo(
    () => ({
      flagged: merged.filter((m) => {
        const a = allAnalyses.get(m.id);
        return a && a.riskCategory !== 'clean';
      }).length,
      questions: merged.filter((m) => m.isQuestion).length,
      negative: merged.filter((m) => m.sentiment === 'negative').length,
    }),
    [merged, allAnalyses],
  );

  const filters: { id: Filter; label: string; count?: number }[] = [
    { id: 'all', label: 'All', count: merged.length },
    { id: 'flagged', label: 'Flagged', count: counts.flagged },
    { id: 'questions', label: 'Questions', count: counts.questions },
    { id: 'negative', label: 'Negative sentiment', count: counts.negative },
  ];

  return (
    <div className="space-y-4">
      <Card
        title="Live Chat"
        description={
          status?.mode === 'live'
            ? `Live Twitch chat on ${status.twitch.channel ?? 'your channel'}.`
            : 'Demo Mode — simulated sample messages, labelled as simulated in the feed.'
        }
      >
        <DemoControls
          running={status?.simulator.running ?? false}
          speed={status?.simulator.speed ?? 1}
          disabled={status?.mode === 'live'}
          moderator={moderator}
          onChanged={() => undefined}
        />
        <div className="mt-4 flex flex-wrap gap-1" role="group" aria-label="Filter messages">
          {filters.map((f) => (
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
              {f.count !== undefined && <span className="ml-1.5 text-xs opacity-80">{f.count}</span>}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Message feed" description={`${visible.length} of ${merged.length} messages shown.`}>
        {visible.length === 0 ? (
          <EmptyState
            title="No messages match this filter"
            body="Start the Demo Mode simulator above or connect Twitch in Settings to see messages flow through the pipeline."
          />
        ) : (
          <ChatFeed messages={visible} analyses={allAnalyses} maxHeightClass="max-h-[62vh]" />
        )}
      </Card>
    </div>
  );
}
