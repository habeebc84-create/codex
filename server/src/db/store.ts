import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from 'node:sqlite';

// node:sqlite is loaded via createRequire with a computed specifier so that
// bundlers/test runners that statically analyse imports (Vite/Vitest) do
// not try to resolve the Node builtin as a file. The type-only import above
// is erased at compile time and keeps full type checking.
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode(['node', 'sqlite'].join(':')) as {
  DatabaseSync: typeof DatabaseSyncType;
};
import type {
  ChatMessage,
  CopilotSuggestion,
  Incident,
  MessageAnalysis,
  ModerationDecision,
  QuestionGroup,
} from '../../../shared/src/types.js';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  username TEXT NOT NULL,
  user_id TEXT,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  sentiment_score REAL NOT NULL,
  is_question INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_username ON messages(username);

CREATE TABLE IF NOT EXISTS analyses (
  message_id TEXT PRIMARY KEY,
  risk_category TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence REAL NOT NULL,
  explanation TEXT NOT NULL,
  reasons TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  needs_human_review INTEGER NOT NULL,
  engine TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  message_id TEXT,
  username TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  action TEXT NOT NULL,
  moderator TEXT NOT NULL,
  note TEXT,
  submitted_to_twitch INTEGER NOT NULL,
  submit_detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_groups (
  id TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  representative_text TEXT NOT NULL,
  username TEXT NOT NULL,
  message_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  relevance REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

function rowToMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id),
    channel: String(row.channel),
    username: String(row.username),
    userId: row.user_id == null ? null : String(row.user_id),
    text: String(row.text),
    source: row.source as ChatMessage['source'],
    createdAt: String(row.created_at),
    sentiment: row.sentiment as ChatMessage['sentiment'],
    sentimentScore: Number(row.sentiment_score),
    isQuestion: Number(row.is_question) === 1,
  };
}

function rowToAnalysis(row: Record<string, unknown>): MessageAnalysis {
  return {
    messageId: String(row.message_id),
    riskCategory: row.risk_category as MessageAnalysis['riskCategory'],
    severity: row.severity as MessageAnalysis['severity'],
    confidence: Number(row.confidence),
    explanation: String(row.explanation),
    reasons: JSON.parse(String(row.reasons)) as string[],
    recommendedAction: row.recommended_action as MessageAnalysis['recommendedAction'],
    needsHumanReview: Number(row.needs_human_review) === 1,
    engine: row.engine as MessageAnalysis['engine'],
    createdAt: String(row.created_at),
  };
}

function rowToIncident(row: Record<string, unknown>): Incident {
  return {
    id: String(row.id),
    type: row.type as Incident['type'],
    title: String(row.title),
    detail: String(row.detail),
    severity: row.severity as Incident['severity'],
    status: row.status as Incident['status'],
    messageId: row.message_id == null ? null : String(row.message_id),
    username: row.username == null ? null : String(row.username),
    createdAt: String(row.created_at),
  };
}

function rowToDecision(row: Record<string, unknown>): ModerationDecision {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    action: row.action as ModerationDecision['action'],
    moderator: String(row.moderator),
    note: row.note == null ? null : String(row.note),
    submittedToTwitch: Number(row.submitted_to_twitch) === 1,
    submitDetail: row.submit_detail == null ? null : String(row.submit_detail),
    createdAt: String(row.created_at),
  };
}

function rowToQuestion(row: Record<string, unknown>): QuestionGroup {
  return {
    id: String(row.id),
    groupKey: String(row.group_key),
    representativeText: String(row.representative_text),
    username: String(row.username),
    messageId: String(row.message_id),
    count: Number(row.count),
    relevance: Number(row.relevance),
    status: row.status as QuestionGroup['status'],
    createdAt: String(row.created_at),
    lastSeenAt: String(row.last_seen_at),
  };
}

/**
 * SQLite storage using Node's built-in node:sqlite (Node >= 22.5).
 * No Prisma engine download is required. All chat text is stored exactly
 * as received and rendered by the client as plain text only.
 */
export class Store {
  private db: DatabaseSyncType;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  insertMessage(message: ChatMessage): void {
    this.db
      .prepare(
        `INSERT INTO messages (id, channel, username, user_id, text, source, sentiment, sentiment_score, is_question, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.channel,
        message.username,
        message.userId,
        message.text,
        message.source,
        message.sentiment,
        message.sentimentScore,
        message.isQuestion ? 1 : 0,
        message.createdAt,
      );
  }

  insertAnalysis(analysis: MessageAnalysis): void {
    this.db
      .prepare(
        `INSERT INTO analyses (message_id, risk_category, severity, confidence, explanation, reasons, recommended_action, needs_human_review, engine, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        analysis.messageId,
        analysis.riskCategory,
        analysis.severity,
        analysis.confidence,
        analysis.explanation,
        JSON.stringify(analysis.reasons),
        analysis.recommendedAction,
        analysis.needsHumanReview ? 1 : 0,
        analysis.engine,
        analysis.createdAt,
      );
  }

  getMessage(id: string): ChatMessage | null {
    const row = this.db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToMessage(row) : null;
  }

  getAnalysis(messageId: string): MessageAnalysis | null {
    const row = this.db
      .prepare('SELECT * FROM analyses WHERE message_id = ?')
      .get(messageId) as Record<string, unknown> | undefined;
    return row ? rowToAnalysis(row) : null;
  }

  listMessages(limit: number, before?: string): ChatMessage[] {
    const rows = (
      before
        ? this.db
            .prepare(
              'SELECT * FROM messages WHERE created_at < ? ORDER BY created_at DESC, id DESC LIMIT ?',
            )
            .all(before, limit)
        : this.db
            .prepare('SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT ?')
            .all(limit)
    ) as Record<string, unknown>[];
    return rows.map(rowToMessage);
  }

  /** Messages in [since, until], oldest first — used by analysis windows.
   * The upper bound is inclusive so messages stamped in the same
   * millisecond as the current event are visible to burst detection. */
  messagesInWindow(sinceIso: string, untilIso: string): ChatMessage[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM messages WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC, id ASC',
      )
      .all(sinceIso, untilIso) as Record<string, unknown>[];
    return rows.map(rowToMessage);
  }

  recentByUser(username: string, sinceIso: string): ChatMessage[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM messages WHERE username = ? AND created_at >= ? ORDER BY created_at ASC, id ASC',
      )
      .all(username, sinceIso) as Record<string, unknown>[];
    return rows.map(rowToMessage);
  }

  listAlerts(limit: number, onlyUnresolved = false): Array<{
    message: ChatMessage;
    analysis: MessageAnalysis;
    decision: ModerationDecision | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT m.*, a.risk_category, a.severity, a.confidence, a.explanation, a.reasons,
                a.recommended_action, a.needs_human_review, a.engine, a.created_at AS analysis_created_at
         FROM messages m
         JOIN analyses a ON a.message_id = m.id
         WHERE a.needs_human_review = 1 AND a.risk_category != 'clean'
         ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
    return rows
      .map((row) => {
        const message = rowToMessage(row);
        const analysis: MessageAnalysis = {
          messageId: message.id,
          riskCategory: row.risk_category as MessageAnalysis['riskCategory'],
          severity: row.severity as MessageAnalysis['severity'],
          confidence: Number(row.confidence),
          explanation: String(row.explanation),
          reasons: JSON.parse(String(row.reasons)) as string[],
          recommendedAction:
            row.recommended_action as MessageAnalysis['recommendedAction'],
          needsHumanReview: Number(row.needs_human_review) === 1,
          engine: row.engine as MessageAnalysis['engine'],
          createdAt: String(row.analysis_created_at),
        };
        const decision = this.getLatestDecision(message.id);
        return { message, analysis, decision };
      })
      .filter((item) => !onlyUnresolved || item.decision == null);
  }

  insertIncident(incident: Incident): void {
    this.db
      .prepare(
        `INSERT INTO incidents (id, type, title, detail, severity, status, message_id, username, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        incident.id,
        incident.type,
        incident.title,
        incident.detail,
        incident.severity,
        incident.status,
        incident.messageId,
        incident.username,
        incident.createdAt,
      );
  }

  listIncidents(limit: number, type?: string, severity?: string): Incident[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (type) {
      clauses.push('type = ?');
      params.push(type);
    }
    if (severity) {
      clauses.push('severity = ?');
      params.push(severity);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM incidents ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(...params, limit) as Record<string, unknown>[];
    return rows.map(rowToIncident);
  }

  getIncident(id: string): Incident | null {
    const row = this.db
      .prepare('SELECT * FROM incidents WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToIncident(row) : null;
  }

  insertDecision(decision: ModerationDecision): void {
    this.db
      .prepare(
        `INSERT INTO decisions (id, message_id, action, moderator, note, submitted_to_twitch, submit_detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        decision.id,
        decision.messageId,
        decision.action,
        decision.moderator,
        decision.note,
        decision.submittedToTwitch ? 1 : 0,
        decision.submitDetail,
        decision.createdAt,
      );
  }

  getLatestDecision(messageId: string): ModerationDecision | null {
    const row = this.db
      .prepare(
        'SELECT * FROM decisions WHERE message_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      )
      .get(messageId) as Record<string, unknown> | undefined;
    return row ? rowToDecision(row) : null;
  }

  listDecisions(limit: number): ModerationDecision[] {
    const rows = this.db
      .prepare('SELECT * FROM decisions ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToDecision);
  }

  upsertQuestionGroup(group: QuestionGroup): void {
    this.db
      .prepare(
        `INSERT INTO question_groups (id, group_key, representative_text, username, message_id, count, relevance, status, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET count = excluded.count, relevance = excluded.relevance, last_seen_at = excluded.last_seen_at, status = excluded.status`,
      )
      .run(
        group.id,
        group.groupKey,
        group.representativeText,
        group.username,
        group.messageId,
        group.count,
        group.relevance,
        group.status,
        group.createdAt,
        group.lastSeenAt,
      );
  }

  listQuestionGroups(status?: string): QuestionGroup[] {
    const rows = (
      status
        ? this.db
            .prepare(
              'SELECT * FROM question_groups WHERE status = ? ORDER BY last_seen_at DESC, id DESC',
            )
            .all(status)
        : this.db
            .prepare(
              'SELECT * FROM question_groups ORDER BY last_seen_at DESC, id DESC',
            )
            .all()
    ) as Record<string, unknown>[];
    return rows.map(rowToQuestion);
  }

  getQuestionGroup(id: string): QuestionGroup | null {
    const row = this.db
      .prepare('SELECT * FROM question_groups WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToQuestion(row) : null;
  }

  setQuestionStatus(id: string, status: QuestionGroup['status']): void {
    this.db
      .prepare('UPDATE question_groups SET status = ? WHERE id = ?')
      .run(status, id);
  }

  insertSuggestion(suggestion: CopilotSuggestion): void {
    this.db
      .prepare(
        'INSERT INTO suggestions (id, kind, text, status, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        suggestion.id,
        suggestion.kind,
        suggestion.text,
        suggestion.status,
        suggestion.createdAt,
      );
  }

  listSuggestions(limit: number): CopilotSuggestion[] {
    const rows = this.db
      .prepare('SELECT * FROM suggestions ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      kind: row.kind as CopilotSuggestion['kind'],
      text: String(row.text),
      status: row.status as CopilotSuggestion['status'],
      createdAt: String(row.created_at),
    }));
  }

  setSuggestionStatus(id: string, status: CopilotSuggestion['status']): void {
    this.db
      .prepare('UPDATE suggestions SET status = ? WHERE id = ?')
      .run(status, id);
  }

  countMessages(sinceIso: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?')
      .get(sinceIso) as { n: number };
    return Number(row.n);
  }

  countFlagged(sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM analyses WHERE created_at >= ? AND risk_category != 'clean'`,
      )
      .get(sinceIso) as { n: number };
    return Number(row.n);
  }

  countOpenAlerts(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM analyses a
         LEFT JOIN decisions d ON d.message_id = a.message_id
         WHERE a.needs_human_review = 1 AND a.risk_category != 'clean' AND d.id IS NULL`,
      )
      .get() as { n: number };
    return Number(row.n);
  }

  countUniqueParticipants(sinceIso: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(DISTINCT username) AS n FROM messages WHERE created_at >= ?',
      )
      .get(sinceIso) as { n: number };
    return Number(row.n);
  }

  clearDemoData(): void {
    this.db.exec(
      'DELETE FROM suggestions; DELETE FROM question_groups; DELETE FROM decisions; DELETE FROM incidents; DELETE FROM analyses; DELETE FROM messages;',
    );
  }
}
