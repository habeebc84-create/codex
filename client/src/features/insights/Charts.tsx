import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useReducedMotion } from '../../lib/socket';

const AXIS = { stroke: '#94a3b8', fontSize: 12 };

export function ActivityChart({
  buckets,
  reducedMotion,
}: {
  buckets: { bucket: string; messages: number; flagged: number }[];
  reducedMotion: boolean;
}) {
  const data = buckets.map((b) => ({
    ...b,
    time: new Date(b.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));
  return (
    <div className="h-56 w-full" role="img" aria-label="Chat activity over time chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis dataKey="time" {...AXIS} tickLine={false} axisLine={false} />
          <YAxis {...AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: '#0b1120', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
          <Area
            type="monotone"
            dataKey="messages"
            name="Messages"
            stroke="#a78bfa"
            fill="#8b5cf6"
            fillOpacity={0.25}
            isAnimationActive={!reducedMotion}
          />
          <Area
            type="monotone"
            dataKey="flagged"
            name="Flagged"
            stroke="#fb7185"
            fill="#f43f5e"
            fillOpacity={0.2}
            isAnimationActive={!reducedMotion}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SentimentChart({
  buckets,
}: {
  buckets: { bucket: string; positive: number; neutral: number; negative: number }[];
}) {
  const reducedMotion = useReducedMotion();
  const data = buckets.map((b) => ({
    ...b,
    time: new Date(b.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));
  return (
    <div className="h-56 w-full" role="img" aria-label="Sentiment trend over time chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis dataKey="time" {...AXIS} tickLine={false} axisLine={false} />
          <YAxis {...AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: '#0b1120', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
          <Line type="monotone" dataKey="positive" name="Positive" stroke="#34d399" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
          <Line type="monotone" dataKey="neutral" name="Neutral" stroke="#94a3b8" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
          <Line type="monotone" dataKey="negative" name="Negative" stroke="#fb7185" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
