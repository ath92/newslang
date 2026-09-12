import { DurableObject } from "cloudflare:workers";
import type {
  DailyProgress,
  ReviewResult,
  TranslationContext,
  TranslationEntry,
} from "../shared/contracts";
import { DEFAULT_DAILY_TARGET_MINUTES, shiftDay } from "../shared/progress";
import { phraseKey, scheduleReview, truncateContext } from "../shared/vocab";

const ENTRY_COLUMNS = [
  "id",
  "phrase",
  "phrase_key",
  "translation",
  "source_lang",
  "target_lang",
  "provider",
  "created_at",
  "updated_at",
  "review_count",
  "correct_count",
  "last_reviewed_at",
  "box",
  "due_at",
].join(", ");

interface EntryRow {
  [key: string]: SqlStorageValue;
  id: number;
  phrase: string;
  phrase_key: string;
  translation: string;
  source_lang: string | null;
  target_lang: string;
  provider: string | null;
  created_at: number;
  updated_at: number;
  review_count: number;
  correct_count: number;
  last_reviewed_at: number | null;
  box: number;
  due_at: number;
}

interface ContextRow {
  [key: string]: SqlStorageValue;
  id: number;
  entry_id: number;
  text: string;
  before: string | null;
  after: string | null;
  article_url: string | null;
  article_title: string | null;
  created_at: number;
}

interface DailyRow {
  [key: string]: SqlStorageValue;
  day: string;
  minutes: number;
  articles: number;
}

export interface StoreContext {
  text: string;
  before?: string;
  after?: string;
  articleUrl?: string;
  articleTitle?: string;
}

export interface SaveTranslationInput {
  phrase: string;
  translation: string;
  sourceLang?: string;
  targetLang: string;
  provider?: string;
  context?: StoreContext;
  now: number;
}

export interface SaveTranslationResult {
  entry: TranslationEntry;
  /** True when this call created a brand new vocabulary entry. */
  created: boolean;
}

export interface RecordReadingInput {
  day: string;
  articleUrl: string;
  articleTitle?: string;
  minutes: number;
  tzOffsetMinutes: number;
  now: number;
}

function toContext(row: ContextRow): TranslationContext {
  return {
    id: row.id,
    text: row.text,
    before: row.before ?? undefined,
    after: row.after ?? undefined,
    articleUrl: row.article_url || undefined,
    articleTitle: row.article_title ?? undefined,
    createdAt: row.created_at,
  };
}

function toEntry(row: EntryRow, contexts: TranslationContext[]): TranslationEntry {
  return {
    id: row.id,
    phrase: row.phrase,
    translation: row.translation,
    sourceLang: row.source_lang ?? undefined,
    targetLang: row.target_lang,
    provider: row.provider ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewCount: row.review_count,
    correctCount: row.correct_count,
    lastReviewedAt: row.last_reviewed_at ?? undefined,
    box: row.box,
    dueAt: row.due_at,
    contexts,
  };
}

/**
 * Per-user vocabulary store, backed by the Durable Object's embedded SQLite
 * database. One instance (and therefore one SQLite file) exists per user.
 */
export class TranslationStore extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phrase TEXT NOT NULL,
        phrase_key TEXT NOT NULL,
        translation TEXT NOT NULL,
        source_lang TEXT,
        target_lang TEXT NOT NULL,
        provider TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        review_count INTEGER NOT NULL DEFAULT 0,
        correct_count INTEGER NOT NULL DEFAULT 0,
        last_reviewed_at INTEGER,
        box INTEGER NOT NULL DEFAULT 0,
        due_at INTEGER NOT NULL
      );
    `);
    ctx.storage.sql.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS entries_phrase_unique ON entries (phrase_key, target_lang);`,
    );
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        before TEXT,
        after TEXT,
        article_url TEXT NOT NULL DEFAULT '',
        article_title TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    ctx.storage.sql.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS contexts_unique ON contexts (entry_id, text, article_url);`,
    );
    ctx.storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS contexts_entry ON contexts (entry_id, created_at DESC);`,
    );

    // Daily reading goal + one row per article credited per local day.
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reading_goal (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        minutes INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reading_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        article_url TEXT NOT NULL,
        article_title TEXT,
        minutes INTEGER NOT NULL,
        tz_offset INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);
    ctx.storage.sql.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS reading_log_unique ON reading_log (day, article_url);`,
    );
    ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS reading_log_day ON reading_log (day);`);
  }

  /** Look up an existing entry so we can reuse its translation (and skip the API). */
  async getByPhrase(phrase: string, targetLang: string): Promise<TranslationEntry | null> {
    const row = this.sql
      .exec<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM entries WHERE phrase_key = ? AND target_lang = ?`,
        phraseKey(phrase),
        targetLang,
      )
      .toArray()[0];
    return row ? this.hydrate(row) : null;
  }

  /**
   * Entries still carrying the development mock translation. Used to upgrade
   * phrases that were saved before a real provider key was configured.
   */
  async listMock(targetLang: string, limit: number): Promise<TranslationEntry[]> {
    const rows = this.sql
      .exec<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM entries
         WHERE provider = 'mock' AND target_lang = ?
         ORDER BY updated_at ASC LIMIT ?`,
        targetLang,
        limit,
      )
      .toArray();
    return this.hydrateAll(rows);
  }

  /**
   * Replace an entry's translation in place (e.g. upgrade a mock to a real
   * provider). `updated_at` is intentionally left alone so refreshing does not
   * reshuffle the vocabulary list.
   */
  async updateTranslation(
    id: number,
    input: { translation: string; sourceLang?: string; provider?: string },
  ): Promise<TranslationEntry | null> {
    const result = this.sql.exec(
      `UPDATE entries SET translation = ?, source_lang = ?, provider = ? WHERE id = ?`,
      input.translation,
      input.sourceLang ?? null,
      input.provider ?? null,
      id,
    );
    if (result.rowsWritten === 0) return null;
    return this.getEntry(id);
  }

  /** Record a new phrase (or attach a context to an existing one). */
  async saveTranslation(input: SaveTranslationInput): Promise<SaveTranslationResult> {
    const key = phraseKey(input.phrase);
    let row = this.sql
      .exec<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM entries WHERE phrase_key = ? AND target_lang = ?`,
        key,
        input.targetLang,
      )
      .toArray()[0];

    const created = !row;
    if (!row) {
      this.sql.exec(
        `INSERT INTO entries
           (phrase, phrase_key, translation, source_lang, target_lang, provider,
            created_at, updated_at, review_count, correct_count, last_reviewed_at, box, due_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, 0, ?)`,
        input.phrase,
        key,
        input.translation,
        input.sourceLang ?? null,
        input.targetLang,
        input.provider ?? null,
        input.now,
        input.now,
        input.now,
      );
      row = this.sql
        .exec<EntryRow>(
          `SELECT ${ENTRY_COLUMNS} FROM entries WHERE phrase_key = ? AND target_lang = ?`,
          key,
          input.targetLang,
        )
        .toArray()[0];
    }

    if (!row) throw new Error("Failed to persist translation entry");
    if (input.context) this.insertContext(row.id, input.context, input.now);
    return { entry: this.hydrate(row), created };
  }

  /** Attach another real-world example of a phrase the user already saved. */
  async addContext(
    entryId: number,
    context: StoreContext,
    now: number,
  ): Promise<TranslationEntry | null> {
    this.insertContext(entryId, context, now);
    return this.getEntry(entryId);
  }

  async list(query: string, limit: number): Promise<TranslationEntry[]> {
    const trimmed = query.trim().slice(0, 100);
    let rows: EntryRow[];
    if (trimmed) {
      const like = `%${trimmed}%`;
      rows = this.sql
        .exec<EntryRow>(
          `SELECT ${ENTRY_COLUMNS} FROM entries
           WHERE phrase LIKE ? OR translation LIKE ?
           ORDER BY updated_at DESC LIMIT ?`,
          like,
          like,
          limit,
        )
        .toArray();
    } else {
      rows = this.sql
        .exec<EntryRow>(
          `SELECT ${ENTRY_COLUMNS} FROM entries ORDER BY updated_at DESC LIMIT ?`,
          limit,
        )
        .toArray();
    }
    return this.hydrateAll(rows);
  }

  async getEntry(id: number): Promise<TranslationEntry | null> {
    const row = this.sql
      .exec<EntryRow>(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ?`, id)
      .toArray()[0];
    return row ? this.hydrate(row) : null;
  }

  async stats(now: number): Promise<{ total: number; due: number }> {
    const total = this.sql.exec(`SELECT COUNT(*) AS c FROM entries`).one().c as number;
    const due = this.sql.exec(`SELECT COUNT(*) AS c FROM entries WHERE due_at <= ?`, now).one()
      .c as number;
    return { total, due };
  }

  async review(id: number, result: ReviewResult, now: number): Promise<TranslationEntry | null> {
    const row = this.sql.exec(`SELECT box FROM entries WHERE id = ?`, id).toArray()[0] as
      { box: number } | undefined;
    if (!row) return null;

    const schedule = scheduleReview(row.box, result, now);
    this.sql.exec(
      `UPDATE entries
       SET box = ?, due_at = ?, review_count = review_count + 1,
           correct_count = correct_count + ?, last_reviewed_at = ?
       WHERE id = ?`,
      schedule.box,
      schedule.dueAt,
      result === "known" ? 1 : 0,
      now,
      id,
    );
    return this.getEntry(id);
  }

  async remove(id: number): Promise<boolean> {
    this.sql.exec(`DELETE FROM contexts WHERE entry_id = ?`, id);
    return this.sql.exec(`DELETE FROM entries WHERE id = ?`, id).rowsWritten > 0;
  }

  /** The reader's daily target; falls back to the default when unset. */
  async getDailyTarget(): Promise<number> {
    const row = this.sql
      .exec<DailyRow>(`SELECT minutes FROM reading_goal WHERE id = 1`)
      .toArray()[0];
    return row ? Number(row.minutes) : DEFAULT_DAILY_TARGET_MINUTES;
  }

  /** Persist the reader's daily target. */
  async setDailyTarget(minutes: number, now: number): Promise<number> {
    this.sql.exec(
      `INSERT INTO reading_goal (id, minutes, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET minutes = excluded.minutes, updated_at = excluded.updated_at`,
      minutes,
      now,
    );
    return minutes;
  }

  /** Minutes and distinct articles credited on one local day. */
  async getDailyProgress(day: string): Promise<DailyProgress> {
    const row = this.sql
      .exec<DailyRow>(
        `SELECT COALESCE(SUM(minutes), 0) AS minutes, COUNT(*) AS articles
         FROM reading_log WHERE day = ?`,
        day,
      )
      .one();
    return { day, minutes: Number(row.minutes), articles: Number(row.articles) };
  }

  /** A zero-filled, oldest-first day history ending on `today`. */
  async getHistory(today: string, limit: number): Promise<DailyProgress[]> {
    const rows = this.sql
      .exec<DailyRow>(
        `SELECT day, COALESCE(SUM(minutes), 0) AS minutes, COUNT(*) AS articles
         FROM reading_log WHERE day >= ? AND day <= ? GROUP BY day`,
        shiftDay(today, -(limit - 1)),
        today,
      )
      .toArray();
    const byDay = new Map(rows.map((row) => [row.day, row]));
    const history: DailyProgress[] = [];
    for (let offset = limit - 1; offset >= 0; offset -= 1) {
      const day = shiftDay(today, -offset);
      const row = byDay.get(day);
      history.push({
        day,
        minutes: row ? Number(row.minutes) : 0,
        articles: row ? Number(row.articles) : 0,
      });
    }
    return history;
  }

  /** Credit an article once per local day; duplicate opens are ignored. */
  async recordReading(input: RecordReadingInput): Promise<{
    counted: boolean;
    today: DailyProgress;
  }> {
    const alreadyCounted =
      this.sql
        .exec(
          `SELECT 1 AS present FROM reading_log WHERE day = ? AND article_url = ? LIMIT 1`,
          input.day,
          input.articleUrl,
        )
        .toArray().length > 0;

    if (!alreadyCounted) {
      this.sql.exec(
        `INSERT OR IGNORE INTO reading_log
           (day, article_url, article_title, minutes, tz_offset, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        input.day,
        input.articleUrl,
        input.articleTitle ?? null,
        input.minutes,
        input.tzOffsetMinutes,
        input.now,
      );
    }

    const today = await this.getDailyProgress(input.day);
    return { counted: !alreadyCounted, today };
  }

  private insertContext(entryId: number, context: StoreContext, now: number): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO contexts
         (entry_id, text, before, after, article_url, article_title, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      entryId,
      truncateContext(context.text),
      context.before ? truncateContext(context.before, 400) : null,
      context.after ? truncateContext(context.after, 400) : null,
      context.articleUrl ?? "",
      context.articleTitle ?? null,
      now,
    );
  }

  private hydrate(row: EntryRow): TranslationEntry {
    return toEntry(row, this.contextsFor([row.id]).get(row.id) ?? []);
  }

  private hydrateAll(rows: EntryRow[]): TranslationEntry[] {
    const contexts = this.contextsFor(rows.map((row) => row.id));
    return rows.map((row) => toEntry(row, contexts.get(row.id) ?? []));
  }

  private contextsFor(ids: number[]): Map<number, TranslationContext[]> {
    const grouped = new Map<number, TranslationContext[]>();
    if (ids.length === 0) return grouped;

    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.sql
      .exec<ContextRow>(
        `SELECT * FROM contexts WHERE entry_id IN (${placeholders}) ORDER BY created_at DESC`,
        ...ids,
      )
      .toArray();

    for (const row of rows) {
      const list = grouped.get(row.entry_id) ?? [];
      list.push(toContext(row));
      grouped.set(row.entry_id, list);
    }
    return grouped;
  }
}
