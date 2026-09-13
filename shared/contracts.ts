/**
 * Shared API contracts between the Cloudflare Worker backend and the React app.
 * Keep this file dependency-free so it can be imported from both projects.
 */

/** The news sources the app supports. */
export const SOURCES = [
  { id: "ansa", name: "ANSA", tagline: "Agenzia di stampa" },
  { id: "rai", name: "Rai News", tagline: "Servizio pubblico" },
] as const;

export type SourceId = (typeof SOURCES)[number]["id"];

/** Language the news is written in, and the language the reader learns. */
export const SOURCE_LANG = "IT";
/** Language translations are delivered in (DeepL-style locale code). */
export const TARGET_LANG = "EN-US";

export interface NewsSource {
  id: SourceId;
  name: string;
  tagline: string;
}

/** A single headline parsed from a source's RSS feed. */
export interface Headline {
  /** Stable identifier derived from the article URL. */
  id: string;
  title: string;
  /** Absolute URL of the full article. */
  link: string;
  /** Plain-text summary derived from the RSS description. */
  summary: string;
  author?: string;
  /** RFC 2822 date string from the feed. */
  pubDate?: string;
  /** Human-friendly section label (e.g. "Cronaca"). */
  category?: string;
  /** Thumbnail image URL, when the feed provides one. */
  image?: string;
}

/** One place a phrase was seen, with the sentence that surrounded it. */
export interface TranslationContext {
  id: number;
  /** The paragraph/sentence the phrase appeared in. */
  text: string;
  /** Text immediately before the selection inside the context. */
  before?: string;
  /** Text immediately after the selection inside the context. */
  after?: string;
  articleUrl?: string;
  articleTitle?: string;
  createdAt: number;
}

/** A saved phrase plus its translation, reviewer stats and example contexts. */
export interface TranslationEntry {
  id: number;
  phrase: string;
  translation: string;
  sourceLang?: string;
  targetLang: string;
  provider?: string;
  createdAt: number;
  updatedAt: number;
  reviewCount: number;
  correctCount: number;
  lastReviewedAt?: number;
  /** Leitner box: 0 = new/struggling, MAX_BOX = well known. */
  box: number;
  /** Unix ms timestamp of the next review. */
  dueAt: number;
  contexts: TranslationContext[];
}

/** Body of `POST /api/translate`. */
export interface TranslateRequest {
  text: string;
  /** Surrounding paragraph, used to disambiguate the translation. */
  context?: string;
  before?: string;
  after?: string;
  articleUrl?: string;
  articleTitle?: string;
}

/** Response of `POST /api/translate`. */
export interface TranslateResponse {
  entry: TranslationEntry;
  /** True when the phrase was already in the user's vocabulary. */
  cached: boolean;
}

/** How the reader answered a review card. */
export type ReviewResult = "again" | "known";

/** One calendar day of reading activity, in the reader's local timezone. */
export interface DailyProgress {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Estimated minutes credited that day. */
  minutes: number;
  /** Distinct articles credited that day. */
  articles: number;
}

/** Body of `POST /api/progress/read`. */
export interface RecordReadingRequest {
  articleUrl: string;
  articleTitle?: string;
  /** Estimated reading time of the article, in minutes. */
  minutes: number;
  /** The reader's `Date#getTimezoneOffset()`, in minutes. */
  tzOffsetMinutes: number;
}

/** Response of `GET /api/progress`. */
export interface ProgressResponse {
  targetMinutes: number;
  today: DailyProgress;
  /** Most recent days, oldest first, one entry per day (zero-filled). */
  history: DailyProgress[];
  /** Consecutive days (ending today or yesterday) that met the target. */
  streak: number;
}

/** Response of `POST /api/progress/read`. */
export interface RecordReadingResponse {
  targetMinutes: number;
  today: DailyProgress;
  streak: number;
  /** True when this article pushed the reader from below to at/above target. */
  justMetTarget: boolean;
  /** False when the article was already counted for the day. */
  counted: boolean;
}

/** Body of `PUT /api/progress/target`. */
export interface SetTargetRequest {
  /** `0` disables the daily goal. */
  targetMinutes: number;
  /** The reader's `Date#getTimezoneOffset()`, in minutes. */
  tzOffsetMinutes: number;
}

/** Response of `PUT /api/progress/target`. */
export interface SetTargetResponse {
  targetMinutes: number;
  streak: number;
}

/** Per-device daily reminder settings. */
export interface NotificationSettings {
  /** Whether the daily reminder is on for this device. */
  enabled: boolean;
  /** Local time to remind, as minutes after midnight (e.g. `1200` = 20:00). */
  reminderMinutes: number;
  /** IANA timezone, e.g. `"Europe/Rome"`. */
  timezone: string;
}

/** A Web Push subscription, as returned by `PushSubscription#toJSON()`. */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/** Response of `GET`/`PUT /api/notifications`. */
export interface NotificationSettingsResponse extends NotificationSettings {
  /** VAPID public key for `pushManager.subscribe`, or null when unconfigured. */
  vapidPublicKey: string | null;
  /** True when this device already has a stored push subscription. */
  subscribed: boolean;
}

/** Body of `PUT /api/notifications`. */
export interface UpdateNotificationsRequest {
  enabled: boolean;
  /** Minutes after local midnight; defaults to 20:00 when omitted. */
  reminderMinutes?: number;
  /** IANA timezone; falls back to UTC when missing or invalid. */
  timezone?: string;
}

/* ------------------------------------------------------------------ */
/* Article quiz                                                        */
/* ------------------------------------------------------------------ */

/** How a generated quiz mixes open-answer and multiple-choice questions. */
export type QuizMode = "open" | "multiple_choice" | "mixed";

/** The kind of question the reader answers. */
export type QuizQuestionType = "open" | "multiple_choice";

/** One of the three options of a multiple-choice question. */
export interface QuizChoice {
  /** Stable option id ("A" | "B" | "C"). */
  id: string;
  text: string;
}

/** A single quiz question, as generated by the LLM. */
export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  /** Exactly three options; only present for `multiple_choice`. */
  choices?: QuizChoice[];
  /** Id of the correct option; only present for `multiple_choice`. */
  correctChoiceId?: string;
  /** The model's ideal answer; only present for `open`. */
  referenceAnswer?: string;
  /** Short explanation shown after answering. */
  explanation?: string;
}

/** A generated quiz for one article. */
export interface Quiz {
  id: string;
  articleUrl: string;
  title: string;
  /** BCP-47 language of the questions (always `it` for now). */
  language: string;
  questions: QuizQuestion[];
}

/** Body of `POST /api/quiz`. */
export interface GenerateQuizRequest {
  articleUrl: string;
  title?: string;
  /** Plain-text article body, as extracted by Readability in the browser. */
  text: string;
  mode: QuizMode;
  /** Desired number of questions; clamped server-side. */
  count: number;
}

/** Response of `POST /api/quiz`. */
export interface GenerateQuizResponse {
  quiz: Quiz;
  /** Reserved for a future short-lived cache; always false for now. */
  cached: boolean;
}

/** Body of `POST /api/quiz/grade`. */
export interface GradeAnswerRequest {
  question: QuizQuestion;
  answer: string;
  articleTitle?: string;
}

/** Response of `POST /api/quiz/grade`. */
export interface GradeAnswerResponse {
  /** `score >= OPEN_PASS_THRESHOLD`. */
  correct: boolean;
  /** Partial credit, 0–1. */
  score: number;
  /** Feedback on the meaning of the answer. */
  correctness: string;
  /** Feedback on Italian spelling, grammar and word choice. */
  language: string;
}

/** One answered question inside a completed [`QuizResult`]. */
export interface QuizQuestionResult {
  questionId: string;
  type: QuizQuestionType;
  prompt: string;
  /** What the reader typed or the option they picked. */
  answer: string;
  correct: boolean;
  score: number;
}

/**
 * A finished quiz session. Not persisted yet — this shape exists so quiz results
 * can later be folded into reading progress without reshaping the UI state.
 */
export interface QuizResult {
  articleUrl: string;
  articleTitle?: string;
  mode: QuizMode;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  correctCount: number;
  total: number;
  questions: QuizQuestionResult[];
}
