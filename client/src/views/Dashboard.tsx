import { lazy, Suspense, useEffect, useState } from 'react';
import { MessageSquare, ShieldCheck, HelpCircle, AlertTriangle } from 'lucide-react';
import type { ChatMessage, Incident, MessageAnalysis, StatusPayload } from '../../../shared/src/types.js';
import { api } from '../lib/api';
import { useReducedMotion } from '../lib/socket';
import { Badge, Button, Card, EmptyState, ErrorNotice, SeverityBadge, Spinner, StatCard } from '../components/ui';
import { ChatFeed } from '../features/chat/ChatFeed';

// Recharts is heavy (~500KB minified); load the chart chunk only when a
// view that renders charts mounts, keeping the first load smaller.
const ActivityChart = lazy(() =>
  import('../features/insights/Charts').then((m) => ({ default: m.ActivityChart })),
);
const SentimentChart = lazy(() =>
  import('../features/insights/Charts').then((m) => ({ default: m.SentimentChart })),
);
import { DemoControls } from '../features/demo/DemoControls';
import type { CopilotSummaryData } from '../features/copilot/CopilotPanel';

interface ActivityResponse {
  windowMinutes: number;
  buckets: { bucketStart: string; messageCount: number; uniqueParticipants: number; flaggedCount: number }[];
}

interface SentimentResponse {
  windowMinutes: number;
  buckets: { bucketStart: string; positive: number; neutral: number; negative: number; uncertain: number; total: number }[];
}

interface SummaryCounts {
  windowMinutes: number;
  messageCount: number;
  uniqueParticipants: number;
  flaggedCount: number;
  openAlerts: number;
  questionGroupsOpen: number;
}

export function DashboardView({
  messages,
  analyses,
  status,
  moderator,
  refreshTick,
  onNavigate,
}: {
  messages: ChatMessage[];
  analyses: Map<string, MessageAnalysis>;
  status: StatusPayload | null;
  moderator: string | null;
  refreshTick: number;
  onNavigate: (view: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [sentiment, setSentiment] = useState<SentimentResponse | null>(null);
  const [counts, setCounts] = useState<SummaryCounts | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [summary, setSummary] = useState<CopilotSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [act, sen, sum, inc, cop] = await Promise.all([
        api.get<ActivityResponse>('/api/insights/activity?windowMinutes=60'),
        api.get<SentimentResponse>('/api/insights/sentiment?windowMinutes=60'),
        api.get<SummaryCounts>('/api/insights/summary?windowMinutes=60'),
        api.get<{ incidents: Incident[] }>('/api/incidents?limit=5'),
        api.get<CopilotSummaryData>('/api/copilot/summary?windowMinutes=30'),
      ]);
      setActivity(act);
      setSentiment(sen);
      setCounts(sum);
      setIncidents(inc.incidents);
      setSummary(cop);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (refreshTick > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  const windowLabel = `Last 60 minutes · ${counts?.messageCount ?? 0} messages · ${counts?.uniqueParticipants ?? 0} participants`;

  return (
    <div className="space-y-4">
      {/* Demo Mode banner: the mode is labelled on every view. */}
      <div
        role="status"
        className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
          status?.mode === 'live'
            ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
            : 'border-amber-400/30 bg-amber-500/10 text-amber-200'
        }`}
      >
        {status?.mode === 'live' ? (
          <>Live Mode — connected to Twitch chat on {status.twitch.channel ?? 'your channel'}. Real messages, real moderation decisions.</>
        ) : (
          <>
            <strong>Demo Mode.</strong> All chat below is simulated sample data, clearly labelled. No Twitch account is
            connected and no real messages are shown. Connect Twitch in Settings to go live.
          </>
        )}
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}
      {loading && !activity && <Spinner label="Loading dashboard…" />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Messages (60 min)" value={String(counts?.messageCount ?? 0)} sub={windowLabel} icon={<MessageSquare size={18} className="text-guard-400" aria-hidden="true" />} />
        <StatCard label="Flagged (60 min)" value={String(counts?.flaggedCount ?? 0)} sub="Needs human review" icon={<ShieldCheck size={18} className="text-rose-400" aria-hidden="true" />} />
        <StatCard label="Open questions" value={String(counts?.questionGroupsOpen ?? 0)} sub="Unanswered question groups" icon={<HelpCircle size={18} className="text-sky-400" aria-hidden="true" />} />
        <StatCard label="Open alerts" value={String(counts?.openAlerts ?? 0)} sub="Awaiting a moderator decision" icon={<AlertTriangle size={18} className="text-amber-400" aria-hidden="true" />} />
      </div>

      <Card
        title="Demo Mode controls"
        description="Simulated chat for trying the pipeline without Twitch credentials."
        className="border-amber-400/20"
      >
        <DemoControls
          running={status?.simulator.running ?? false}
          speed={status?.simulator.speed ?? 1}
          disabled={status?.mode === 'live'}
          moderator={moderator}
          onChanged={load}
        />
        <p className="mt-2 text-xs text-slate-500">
          Changing the scenario restarts the simulator with that pattern. Reset clears all demo messages, alerts,
          and incidents from the local database.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <Card title="Live activity" description={windowLabel}>
            {activity ? (
              <Suspense fallback={<Spinner label="Loading chart…" />}>
                <ActivityChart
                  buckets={activity.buckets.map((b) => ({
                    bucket: b.bucketStart,
                    messages: b.messageCount,
                    flagged: b.flaggedCount,
                  }))}
                  reducedMotion={reducedMotion}
                />
              </Suspense>
            ) : (
              <Spinner label="Loading activity…" />
            )}
          </Card>
          <Card title="Sentiment trend" description="Estimates from a word list — not verified facts. Messages with no signal are counted as uncertain and excluded here.">
            {sentiment ? (
              <Suspense fallback={<Spinner label="Loading chart…" />}>
                <SentimentChart
                  buckets={sentiment.buckets.map((b) => ({
                    bucket: b.bucketStart,
                    positive: b.positive,
                    neutral: b.neutral,
                    negative: b.negative,
                  }))}
                />
              </Suspense>
            ) : (
              <Spinner label="Loading sentiment…" />
            )}
          </Card>
          <Card title="Copilot summary" description="Deterministic summary of the last 30 minutes.">
            {summary ? (
              <>
                <p className="font-medium text-slate-100">{summary.headline}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-300">
                  {summary.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState title="No summary yet" body="Start the simulator or connect Twitch; the summary appears once messages flow." />
            )}
            <Button className="mt-3" onClick={() => onNavigate('insights')}>
              Open Community Insights
            </Button>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <Card
            title="Recent incidents"
            description="Newest first."
            actions={
              <Button onClick={() => onNavigate('incidents')}>View all</Button>
            }
          >
            {incidents.length === 0 ? (
              <EmptyState title="No incidents yet" body="Spam bursts, coordinated messages, and high-risk flags create incidents here." />
            ) : (
              <ul className="space-y-2">
                {incidents.map((i) => (
                  <li key={i.id} className="rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/10">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={i.severity} />
                      <Badge tone="violet">{i.type.replace('_', ' ')}</Badge>
                      <Badge tone={i.status === 'open' ? 'amber' : 'slate'}>{i.status}</Badge>
                    </div>
                    <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-100">{i.title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{i.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Live chat"
            description="Newest messages. Full feed and filters live in Live Chat."
            actions={
              <Button onClick={() => onNavigate('chat')}>Open Live Chat</Button>
            }
          >
            <ChatFeed messages={messages.slice(-8)} analyses={analyses} maxHeightClass="max-h-[320px]" />
          </Card>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Signed in as: {moderator ?? 'not signed in'}. Moderation decisions and demo controls require the demo moderator sign-in.
      </p>
    </div>
  );
}
