import { Card } from '../components/ui';
import { IncidentTimeline } from '../features/incidents/IncidentTimeline';

export function IncidentsView() {
  return (
    <Card
      title="Incident Timeline"
      description="Bursts, coordinated behaviour, harassment, link spam, and high-risk flags. Select an incident for its detail and recorded moderation decisions."
    >
      <IncidentTimeline />
    </Card>
  );
}
