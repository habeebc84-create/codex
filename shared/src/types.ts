/**
 * Shared type definitions for StreamGuardian AI.
 * Pure TypeScript types only — no runtime code — so both the Express
 * server and the Vite client can import this file safely.
 */

export type MessageSource = 'demo' | 'twitch';

export type RiskCategory =
  | 'clean'
  | 'spam'
  | 'harassment'
  | 'suspicious_link'
  | 'coordinated'
  | 'uncertain';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type SentimentLabel = 'positive' | 'neutral' | 'negative' | 'uncertain';

export type RecommendedAction =
  | 'none'
  | 'monitor'
  | 'review'
  | 'timeout_suggested'
  | 'ban_suggested';

export type AnalysisEngine = 'deterministic' | 'openai';

export interface ChatMessage {
  id: string;
  channel: string;
  username: string;
  userId: string | null;
  text: string;
  source: MessageSource;
  createdAt: string;
  sentiment: SentimentLabel;
  sentimentScore: number;
  isQuestion: boolean;
}

export interface MessageAnalysis {
  messageId: string;
  riskCategory: RiskCategory;
  severity: Severity;
  confidence: number;
  explanation: string;
  reasons: string[];
  recommendedAction: RecommendedAction;
  needsHumanReview: boolean;
  engine: AnalysisEngine;
  createdAt: string;
}

export type IncidentType =
  | 'spam_burst'
  | 'flagged_message'
  | 'moderator_review'
  | 'approved_action'
  | 'coordinated_activity'
  | 'connection';

export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';

export interface Incident {
  id: string;
  type: IncidentType;
  title: string;
  detail: string;
  severity: Severity;
  status: IncidentStatus;
  messageId: string | null;
  username: string | null;
  createdAt: string;
}

export type DecisionAction = 'dismiss' | 'false_positive' | 'approve';

export interface ModerationDecision {
  id: string;
  messageId: string;
  action: DecisionAction;
  moderator: string;
  note: string | null;
  submittedToTwitch: boolean;
  submitDetail: string | null;
  createdAt: string;
}

export type QuestionStatus = 'open' | 'answered';

export interface QuestionGroup {
  id: string;
  groupKey: string;
  representativeText: string;
  username: string;
  messageId: string;
  count: number;
  relevance: number;
  status: QuestionStatus;
  createdAt: string;
  lastSeenAt: string;
}

export type ConnectionMode = 'demo' | 'live';

export type TwitchConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface StatusPayload {
  mode: ConnectionMode;
  twitch: {
    state: TwitchConnectionState;
    login: string | null;
    channel: string | null;
    lastError: string | null;
    scopes: string[];
  };
  ai: {
    available: boolean;
    engine: AnalysisEngine;
    note: string;
  };
  simulator: {
    running: boolean;
    speed: number;
    emitted: number;
  };
  serverTime: string;
}

export interface ActivityBucket {
  bucketStart: string;
  messageCount: number;
  uniqueParticipants: number;
  flaggedCount: number;
}

export interface SentimentBucket {
  bucketStart: string;
  positive: number;
  neutral: number;
  negative: number;
  uncertain: number;
  total: number;
}

export interface CopilotSuggestion {
  id: string;
  kind: 'reply' | 'summary' | 'alert';
  text: string;
  status: 'pending' | 'approved' | 'dismissed';
  createdAt: string;
}

export interface SocketChatPayload {
  message: ChatMessage;
  analysis: MessageAnalysis;
}

export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  clean: 'Clean',
  spam: 'Spam',
  harassment: 'Harassment',
  suspicious_link: 'Suspicious link',
  coordinated: 'Coordinated activity',
  uncertain: 'Uncertain',
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};
