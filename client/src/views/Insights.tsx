import { lazy, Suspense, useEffect, useState } from 'react';
import type { CopilotSuggestion, StatusPayload } from '../../../shared/src/types.js';
import { api } from '../lib/api';
import { Card, ErrorNotice, Spinner } from '../components/ui';
import { CopilotPanel, type CopilotSummaryData } from '../features/copilot/CopilotPanel';
import { useReducedMotion } from '../lib/socket';

// Recharts is heavy; load the chart chunk only when this view mounts.
const ActivityChart = lazy(() =>
  import('../features/insights/Charts').then((m) => ({ default: m.ActivityChart })),
);
const SentimentChart = lazy(() =>
  import('../features/insights/Charts').then((m) => ({ default: m.SentimentChart })),
);

interface ActivityResponse {
  windowMinutes: number;
  buckets: { bucketStart: string; messageCount: number; uniqueParticipants: number; flaggedCount: number }[];
}

interface SentimentResponse {
  windowMinutes: number;
  buckets: { bucketStart: string; positive: number; neutral: number; negative: number; uncertain: number; total: number }[];
}

export function InsightsView({
  status,
  moderator,
  refreshTick,
}: {
  status: StatusPayload | null;
  moderator: string | null;
  refreshTick: number;
}) {
  const reducedMotion = useReducedMotion();
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [sentiment, setSentiment] = useState<SentimentResponse | null>(null);
  const [summary, setSummary] = useState<CopilotSummaryData | null>(null);
  const [suggestions, setSuggestions] = useState<CopilotSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = async () => {
    setError(null);
    try {
      const [act, sen, sum, sug] = await Promise.all([
        api.get<ActivityResponse>('/api/insights/activity?windowMinutes=60'),
        api.get<SentimentResponse>('/api/insights/sentiment?windowMinutes=60'),
        api.get<CopilotSummaryData>('/api/copilot/summary?windowMinutes=30'),
        api.get<{ suggestions: CopilotSuggestion[] }>('/api/copilot/suggestions'),
      ]);
      setActivity(act);
      setSentiment(sen);
      setSummary(sum);
      setSuggestions(sug.suggestions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load insights');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  useEffect(() => {
    if (refreshTick > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  const windowLabel = `Last 60 minutes · ${activity?.buckets.reduce((n, b) => n + b.messageCount, 0) ?? 0} messages · ${activity?.buckets.reduce((n, b) => n + b.flaggedCount, 0) ?? 0} flagged`;

  return (
    <div className="space-y-4">
      {error && <ErrorNotice message={error} onRetry={load} />}
      {loading && !activity && <Spinner label="Loading insights…" />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Activity" description={windowLabel}>
          {activity ? (
            <Suspense fallback={<Spinner label="Loading chart…" />}>
              <ActivityChart
                buckets={activity.buckets.map((b) => ({ bucket: b.bucketStart, messages: b.messageCount, flagged: b.flaggedCount }))}
                reducedMotion={reducedMotion}
              />
            </Suspense>
          ) : (
            <Spinner />
          )}
        </Card>
        <Card title="Sentiment trend" description="Word-list estimates. Messages with no signal are counted as uncertain and excluded here.">
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
            <Spinner />
          )}
        </Card>
      </div>
      <Card
        title="Copilot"
        description="Summaries and suggested replies. Nothing is sent without moderator approval; sends are disabled in Demo Mode."
      >
        <CopilotPanel
          summary={summary}
          suggestions={suggestions}
          mode={status?.mode ?? 'demo'}
          moderator={moderator}
          onChanged={() => setTick((t) => t + 1)}
        />
      </Card>
    </div>
  );
}
