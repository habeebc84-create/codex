import { useEffect, useState } from 'react';
import type { QuestionGroup } from '../../../shared/src/types.js';
import { api } from '../lib/api';
import { Card, ErrorNotice, Spinner } from '../components/ui';
import { QuestionsPanel } from '../features/questions/QuestionsPanel';

export function QuestionsView({ moderator, refreshTick }: { moderator: string | null; refreshTick: number }) {
  const [groups, setGroups] = useState<QuestionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = async () => {
    setError(null);
    try {
      const data = await api.get<{ questions: QuestionGroup[] }>('/api/questions');
      setGroups(data.questions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load questions');
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

  return (
    <Card
      title="Important Questions"
      description="Genuine questions detected in chat, grouped by topic so the most-asked ones surface first. Grouping is approximate — similar wording is merged by word overlap."
    >
      {loading && <Spinner label="Loading questions…" />}
      {error && <ErrorNotice message={error} onRetry={load} />}
      {!loading && !error && (
        <QuestionsPanel groups={groups} moderator={moderator} onChanged={() => setTick((t) => t + 1)} />
      )}
    </Card>
  );
}
