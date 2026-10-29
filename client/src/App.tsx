import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  MessageAnalysis,
  StatusPayload,
} from '../../shared/src/types.js';
import { api } from './lib/api';
import { getSocket, useSocketState } from './lib/socket';
import { alertItemSchema, socketChatSchema, statusSchema } from './lib/schemas';
import type { AlertItem } from './lib/types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './views/Dashboard';
import { LiveChatView } from './views/LiveChat';
import { ModerationView } from './views/Moderation';
import { InsightsView } from './views/Insights';
import { QuestionsView } from './views/Questions';
import { IncidentsView } from './views/Incidents';
import { SettingsView } from './views/Settings';

const VIEW_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  chat: 'Live Chat',
  moderation: 'AI Moderation',
  insights: 'Community Insights',
  questions: 'Important Questions',
  incidents: 'Incident Timeline',
  settings: 'Settings',
};

const MAX_FEED = 200;

export default function App() {
  const [view, setView] = useState('dashboard');
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [analyses, setAnalyses] = useState<Map<string, MessageAnalysis>>(new Map());
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [moderator, setModerator] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [twitchNotice, setTwitchNotice] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.get<unknown>('/api/status');
      const parsed = statusSchema.safeParse(data);
      if (parsed.success) setStatus(parsed.data);
    } catch {
      /* Status stays stale; the socket indicator shows the disconnect. */
    }
  }, []);

  const loadModerator = useCallback(async () => {
    try {
      const me = await api.get<{ session: { displayName: string } | null }>('/api/auth/me');
      setModerator(me.session?.displayName ?? null);
    } catch {
      setModerator(null);
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const data = await api.get<{ alerts: unknown[] }>('/api/alerts?unresolved=true&limit=50');
      const valid = data.alerts.flatMap((a) => {
        const parsed = alertItemSchema.safeParse(a);
        return parsed.success ? [parsed.data] : [];
      });
      setAlerts(valid);
    } catch {
      /* Queue stays as-is; socket events still append new alerts. */
    }
  }, []);

  // Throttled refresh signal for views that poll REST data.
  const bumpRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      setRefreshTick((t) => t + 1);
    }, 3000);
  }, []);

  // Twitch OAuth callback lands back at /settings?twitch=connected|error.
  // This SPA has view state, not routes, so read the query once on load,
  // show the outcome in Settings, and clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('twitch');
    if (result === 'connected') {
      setTwitchNotice('Twitch connected. Live Mode is now active — real chat will flow through the pipeline.');
      setView('settings');
    } else if (result === 'error') {
      setTwitchNotice(
        `Twitch connection failed: ${params.get('reason') ?? 'unknown error'}. Demo Mode remains available.`,
      );
      setView('settings');
    }
    if (result) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadModerator();
    void loadAlerts();
    const s = getSocket();

    const onChat = (payload: unknown) => {
      const parsed = socketChatSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn('Dropped invalid chat payload', parsed.error.flatten());
        return;
      }
      const { message, analysis } = parsed.data;
      setMessages((prev) => [...prev.slice(-(MAX_FEED - 1)), message]);
      setAnalyses((prev) => {
        const next = new Map(prev);
        next.set(message.id, analysis);
        return next;
      });
      bumpRefresh();
    };

    const onAlert = (payload: unknown) => {
      // moderation:alert carries { message, analysis }; the decision is
      // unresolved by definition for a new alert.
      const parsed = socketChatSchema.safeParse(payload);
      if (!parsed.success) return;
      const item: AlertItem = { ...parsed.data, decision: null, source: parsed.data.message.source };
      setAlerts((prev) =>
        prev.some((a) => a.message.id === item.message.id) ? prev : [item, ...prev].slice(0, 50),
      );
      if (item.analysis.severity === 'high' || item.analysis.severity === 'critical') {
        setAnnouncement(
          `New ${item.analysis.severity} severity moderation alert: ${item.analysis.riskCategory}. Review queue updated.`,
        );
      }
      bumpRefresh();
    };

    const onIncident = () => bumpRefresh();
    const onInsights = () => bumpRefresh();
    const onStatus = (payload: unknown) => {
      const parsed = statusSchema.safeParse(payload);
      if (parsed.success) setStatus(parsed.data);
    };

    s.on('chat:message', onChat);
    s.on('moderation:alert', onAlert);
    s.on('incident:new', onIncident);
    s.on('insights:update', onInsights);
    s.on('status:update', onStatus);
    return () => {
      s.off('chat:message', onChat);
      s.off('moderation:alert', onAlert);
      s.off('incident:new', onIncident);
      s.off('insights:update', onInsights);
      s.off('status:update', onStatus);
    };
  }, [loadStatus, loadModerator, loadAlerts, bumpRefresh]);

  const socketState = useSocketState();

  const navigate = (next: string) => {
    setView(next);
    document.getElementById('main-heading')?.focus();
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-slate-200">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-guard-600 focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>

      <Header
        status={status}
        socketState={socketState}
        moderator={moderator}
        pendingAlertCount={alerts.length}
        onNavigate={navigate}
        onModeratorChange={loadModerator}
      />

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="border-b border-white/10 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
          <Sidebar current={view} onNavigate={navigate} alertCount={alerts.length} />
        </div>

        <main id="main-content" className="min-w-0 flex-1 px-4 py-4 sm:px-6 sm:py-6">
          <h1
            id="main-heading"
            tabIndex={-1}
            className="mb-4 text-xl font-bold tracking-tight text-slate-50 outline-none sm:text-2xl"
          >
            {VIEW_TITLES[view] ?? 'Dashboard'}
          </h1>

          {/* Polite announcements for screen readers: high-severity alerts. */}
          <div aria-live="polite" className="sr-only">
            {announcement}
          </div>

          {view === 'dashboard' && (
            <DashboardView
              messages={messages}
              analyses={analyses}
              status={status}
              moderator={moderator}
              refreshTick={refreshTick}
              onNavigate={navigate}
            />
          )}
          {view === 'chat' && (
            <LiveChatView messages={messages} analyses={analyses} status={status} moderator={moderator} />
          )}
          {view === 'moderation' && (
            <ModerationView alerts={alerts} moderator={moderator} refreshTick={refreshTick} />
          )}
          {view === 'insights' && <InsightsView status={status} moderator={moderator} refreshTick={refreshTick} />}
          {view === 'questions' && <QuestionsView moderator={moderator} refreshTick={refreshTick} />}
          {view === 'incidents' && <IncidentsView />}
          {view === 'settings' && (
            <SettingsView status={status} moderator={moderator} twitchNotice={twitchNotice} onChanged={loadStatus} />
          )}
        </main>
      </div>

      <footer className="border-t border-white/10 px-4 py-3 text-center text-xs text-slate-500 sm:px-6">
        StreamGuardian AI — hackathon MVP. {status?.mode === 'live' ? 'Live Twitch mode.' : 'Demo Mode: simulated data only.'}{' '}
        Moderation is human-controlled; nothing is actioned automatically.
      </footer>
    </div>
  );
}
