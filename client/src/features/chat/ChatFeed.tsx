import { useEffect, useRef } from 'react';
import type { ChatMessage, MessageAnalysis } from '../../../../shared/src/types.js';
import { Badge } from '../../components/ui';
import { formatTime } from '../../lib/socket';

const SENTIMENT_DOT: Record<ChatMessage['sentiment'], string> = {
  positive: 'bg-emerald-400',
  neutral: 'bg-slate-400',
  negative: 'bg-rose-400',
  uncertain: 'bg-slate-500',
};

export function ChatFeed({
  messages,
  analyses,
  emptyTitle = 'No messages yet',
  emptyBody = 'Start the Demo Mode simulator or connect Twitch to see chat flow through the analysis pipeline.',
  maxHeightClass = 'max-h-[560px]',
  autoScroll = true,
}: {
  messages: ChatMessage[];
  analyses: Map<string, MessageAnalysis>;
  emptyTitle?: string;
  emptyBody?: string;
  maxHeightClass?: string;
  autoScroll?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (autoScroll && stickRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [messages, autoScroll]);

  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center">
        <p className="font-medium text-slate-200">{emptyTitle}</p>
        <p className="mt-1 text-sm text-slate-400">{emptyBody}</p>
      </div>
    );
  }

  return (
    <div
      className={`nice-scroll overflow-y-auto pr-1 ${maxHeightClass}`}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      role="log"
      aria-label="Chat messages"
      aria-live="off"
    >
      <ul className="space-y-2">
        {messages.map((m) => {
          const analysis = analyses.get(m.id);
          const flagged = analysis && analysis.riskCategory !== 'clean';
          return (
            <li
              key={m.id}
              className={`rounded-xl px-3 py-2 ${flagged ? 'bg-rose-500/10 ring-1 ring-rose-400/20' : 'bg-white/[0.03]'}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-semibold text-guard-300">{m.username}</span>
                <span className="text-xs text-slate-500">{formatTime(m.createdAt)}</span>
                <span
                  aria-hidden="true"
                  title={`Sentiment: ${m.sentiment}`}
                  className={`inline-block h-2 w-2 rounded-full ${SENTIMENT_DOT[m.sentiment]}`}
                />
                {m.source === 'demo' && (
                  <Badge tone="slate">simulated</Badge>
                )}
                {m.isQuestion && <Badge tone="blue">question</Badge>}
                {flagged && (
                  <Badge tone={analysis.severity === 'critical' || analysis.severity === 'high' ? 'red' : 'amber'}>
                    {analysis.riskCategory.replace('_', ' ')} · {analysis.severity}
                  </Badge>
                )}
              </div>
              {/* Rendered as plain text only — React escapes markup, so chat
                  content can never inject HTML or scripts. */}
              <p className="mt-0.5 break-words text-sm leading-relaxed text-slate-200">{m.text}</p>
              {flagged && (
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{analysis.explanation}</p>
              )}
            </li>
          );
        })}
      </ul>
      <div ref={endRef} />
    </div>
  );
}
