import { SOURCES, SOURCE_LANG, TARGET_LANG } from "../shared/contracts";
import type {
  GenerateQuizRequest,
  GradeAnswerRequest,
  NotificationSettingsResponse,
  ProgressResponse,
  PushSubscriptionInput,
  Quiz,
  QuizMode,
  RecordReadingRequest,
  RecordReadingResponse,
  ReviewResult,
  SetTargetRequest,
  SetTargetResponse,
  TranslateRequest,
  TranslationEntry,
  UpdateNotificationsRequest,
} from "../shared/contracts";
import {
  clampDailyTarget,
  clampReadingMinutes,
  clampTimezoneOffset,
  computeStreak,
  HISTORY_DAYS,
  isTargetMet,
  localDayKey,
  STREAK_WINDOW_DAYS,
} from "../shared/progress";
import {
  clampReminderMinutes,
  DEFAULT_REMINDER_MINUTES,
  FALLBACK_TIMEZONE,
  isValidTimeZone,
} from "../shared/reminders";
import {
  normalizePhrase,
  normalizeWhitespace,
  truncateContext,
  MAX_PHRASE_LENGTH,
} from "../shared/vocab";
import { clampQuestionCount, QUIZ_MAX_ARTICLE_CHARS, validateQuizQuestion } from "../shared/quiz";
import { vapidFromEnv } from "./push";
import { generateQuiz, gradeAnswer, QuizError } from "./quiz";
import { fetchHeadlines } from "./rss";
import { TranslationError, translateText } from "./translation";
import { resolveIdentity } from "./user";

export { TranslationStore } from "./store";

const ARTICLE_USER_AGENT = "Mozilla/5.0 (compatible; newslang/0.1; +https://newslang.workers.dev)";

const SOURCE_IDS = new Set<string>(SOURCES.map((source) => source.id));

/** Hosts (and their subdomains) we are allowed to proxy article HTML from. */
const ALLOWED_ARTICLE_HOSTS = ["ansa.it", "rainews.it"];

const MAX_ENTRIES = 500;

function isAllowedArticleUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  return ALLOWED_ARTICLE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Only trust https article URLs, and only as opaque strings (never fetched). */
function safeArticleUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Hosts allowed to receive our push sends. A subscription endpoint is a
 * client-supplied URL, so an allowlist keeps the Worker from being turned into
 * an SSRF proxy. See the push-service hosts documented by web-push libraries. */
const ALLOWED_PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com"];

function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Validate a browser-supplied push subscription before storing it. */
function readPushSubscription(value: unknown): PushSubscriptionInput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (!isAllowedPushEndpoint(candidate.endpoint)) return null;
  const p256dh = candidate.keys?.p256dh;
  const auth = candidate.keys?.auth;
  if (typeof p256dh !== "string" || p256dh.length === 0 || p256dh.length > 200) return null;
  if (typeof auth !== "string" || auth.length === 0 || auth.length > 100) return null;
  return { endpoint: candidate.endpoint, keys: { p256dh, auth } };
}

function storeFor(env: Env, userId: string) {
  const namespace = env.TRANSLATION_STORE;
  if (!namespace) throw new Error("TRANSLATION_STORE binding is not configured");
  return namespace.get(namespace.idFromName(userId));
}

/** Shared shape for the notification settings endpoints. */
async function notificationsResponse(
  env: Env,
  store: ReturnType<typeof storeFor>,
): Promise<NotificationSettingsResponse> {
  const settings = await store.getNotificationSettings();
  const subscriptions = await store.listPushSubscriptions();
  return {
    ...settings,
    vapidPublicKey: env.VAPID_PUBLIC_KEY?.trim() || null,
    subscribed: subscriptions.length > 0,
  };
}

/** Cap how many legacy mock entries we upgrade per request. */
const MOCK_REFRESH_LIMIT = 25;

/**
 * Re-translate an entry that was stored by the deterministic mock translator,
 * now that a real provider key is configured. Returns the updated entry, or
 * null when there is nothing to do (or the provider call fails).
 */
async function refreshMockEntry(
  env: Env,
  store: ReturnType<typeof storeFor>,
  entry: TranslationEntry,
): Promise<TranslationEntry | null> {
  if (entry.provider !== "mock" || !env.DEEPL_API_KEY) return null;

  try {
    const result = await translateText({
      text: entry.phrase,
      context: entry.contexts[0]?.text,
      sourceLang: SOURCE_LANG,
      targetLang: TARGET_LANG,
      apiKey: env.DEEPL_API_KEY,
      allowMock: false,
    });
    return await store.updateTranslation(entry.id, {
      translation: result.translation,
      sourceLang: result.detectedSourceLang ?? SOURCE_LANG,
      provider: result.provider,
    });
  } catch (error) {
    // Keep the mock so a later request can try again instead of failing the list.
    console.warn("Failed to refresh mock translation", entry.id, error);
    return null;
  }
}

/** Upgrade any phrases still carrying a mock translation for this user. */
async function refreshMockEntries(env: Env, store: ReturnType<typeof storeFor>): Promise<void> {
  if (!env.DEEPL_API_KEY) return;
  const mocks = await store.listMock(TARGET_LANG, MOCK_REFRESH_LIMIT);
  for (const entry of mocks) {
    await refreshMockEntry(env, store, entry);
  }
}

async function handleTranslate(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<Partial<TranslateRequest>>(request);
  if (!body || typeof body.text !== "string") {
    return json({ error: "Missing `text` in request body" }, 400);
  }

  const raw = normalizeWhitespace(body.text);
  if (!raw) return json({ error: "`text` is empty" }, 400);
  if (raw.length > MAX_PHRASE_LENGTH) {
    return json({ error: "Selection is too long to translate" }, 413);
  }
  const phrase = normalizePhrase(raw);

  const contextText = typeof body.context === "string" ? truncateContext(body.context) : undefined;
  const context = {
    text: contextText ?? phrase,
    before: typeof body.before === "string" ? body.before : undefined,
    after: typeof body.after === "string" ? body.after : undefined,
    articleUrl: safeArticleUrl(body.articleUrl),
    articleTitle:
      typeof body.articleTitle === "string" ? body.articleTitle.slice(0, 300) : undefined,
  };

  const store = storeFor(env, userId);
  const now = Date.now();

  // Reuse an existing translation (and just record the new context) so repeat
  // lookups never hit the paid API.
  const existing = await store.getByPhrase(phrase, TARGET_LANG);
  if (existing) {
    // A phrase saved before DeepL was configured would otherwise stay mock
    // forever, because we reuse cached translations and never call the API.
    const current = (await refreshMockEntry(env, store, existing)) ?? existing;
    const entry = (await store.addContext(current.id, context, now)) ?? current;
    return json({ entry, cached: true });
  }

  let result;
  try {
    result = await translateText({
      text: phrase,
      context: contextText,
      sourceLang: SOURCE_LANG,
      targetLang: TARGET_LANG,
      apiKey: env.DEEPL_API_KEY,
      allowMock: env.APP_ENV !== "production",
    });
  } catch (error) {
    if (error instanceof TranslationError) {
      return json({ error: error.message }, error.status);
    }
    throw error;
  }

  const { entry } = await store.saveTranslation({
    phrase,
    translation: result.translation,
    sourceLang: result.detectedSourceLang ?? SOURCE_LANG,
    targetLang: TARGET_LANG,
    provider: result.provider,
    context,
    now,
  });

  return json({ entry, cached: false });
}

/**
 * Cheap sliding-window guards so a single user cannot run up an unbounded AI
 * bill. They are per-isolate (not shared), which is fine as a cost guardrail.
 */
const QUIZ_RATE_WINDOW_MS = 60 * 60 * 1000;

function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (userId: string, now: number): boolean => {
    const recent = (hits.get(userId) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      hits.set(userId, recent);
      return true;
    }
    recent.push(now);
    hits.set(userId, recent);
    return false;
  };
}

const isQuizRateLimited = createRateLimiter(20, QUIZ_RATE_WINDOW_MS);
// A single open quiz can need one grading call per question, so allow more.
const isGradeRateLimited = createRateLimiter(80, QUIZ_RATE_WINDOW_MS);

function readQuizMode(value: unknown): QuizMode {
  return value === "multiple_choice" || value === "mixed" || value === "open" ? value : "open";
}

async function handleGenerateQuiz(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<Partial<GenerateQuizRequest>>(request);
  if (!body || typeof body.text !== "string") {
    return json({ error: "Missing `text` in request body" }, 400);
  }

  const articleUrl = safeArticleUrl(body.articleUrl);
  const text = normalizeWhitespace(body.text);
  if (!articleUrl || !text) {
    return json({ error: "`articleUrl` and a non-empty `text` are required" }, 400);
  }

  if (isQuizRateLimited(userId, Date.now())) {
    return json({ error: "Hai generato troppi quiz. Riprova più tardi." }, 429);
  }

  const mode = readQuizMode(body.mode);
  const count = clampQuestionCount(body.count);
  const title = typeof body.title === "string" ? body.title.slice(0, 300) : undefined;

  try {
    const draft = await generateQuiz(env, {
      articleUrl,
      title,
      text: text.slice(0, QUIZ_MAX_ARTICLE_CHARS),
      mode,
      count,
      language: "it",
    });
    const quiz: Quiz = {
      id: crypto.randomUUID(),
      articleUrl,
      title: title ?? "",
      language: "it",
      questions: draft.questions,
    };
    return json({ quiz, cached: false });
  } catch (error) {
    if (error instanceof QuizError) return json({ error: error.message }, error.status);
    throw error;
  }
}

async function handleGradeAnswer(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJson<Partial<GradeAnswerRequest>>(request);
  if (!body || typeof body.answer !== "string" || !body.question) {
    return json({ error: "`question` and `answer` are required" }, 400);
  }

  const question = validateQuizQuestion(
    body.question,
    typeof body.question.id === "string" ? body.question.id : "q1",
  );
  if (!question) return json({ error: "Invalid question" }, 400);
  if (question.type !== "open") {
    return json({ error: "Only open answers can be graded" }, 400);
  }

  if (isGradeRateLimited(userId, Date.now())) {
    return json({ error: "Troppe verifiche. Riprova più tardi." }, 429);
  }

  try {
    const result = await gradeAnswer(env, {
      question,
      answer: body.answer,
      language: "it",
    });
    return json(result);
  } catch (error) {
    if (error instanceof QuizError) return json({ error: error.message }, error.status);
    throw error;
  }
}

async function handleApi(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return Response.json({ ok: true, env: env.APP_ENV ?? "production" });
  }

  if (url.pathname === "/api/headlines") {
    const source = url.searchParams.get("source") ?? "ansa";
    if (!SOURCE_IDS.has(source)) {
      return Response.json({ error: `Unknown source: ${source}` }, { status: 400 });
    }

    try {
      const headlines = await fetchHeadlines(source as (typeof SOURCES)[number]["id"]);
      return Response.json(headlines, {
        headers: {
          "cache-control": "public, max-age=300, stale-while-revalidate=600",
        },
      });
    } catch {
      return Response.json({ error: "Failed to fetch headlines" }, { status: 502 });
    }
  }

  if (url.pathname === "/api/article-html") {
    const target = url.searchParams.get("url");
    if (!target) {
      return Response.json({ error: "Missing `url` query parameter" }, { status: 400 });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      return Response.json({ error: "Invalid `url` query parameter" }, { status: 400 });
    }

    if (!isAllowedArticleUrl(targetUrl)) {
      return Response.json(
        { error: "Only supported news site article URLs are allowed" },
        { status: 400 },
      );
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "user-agent": ARTICLE_USER_AGENT,
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        return Response.json(
          { error: `Article request failed with status ${response.status}` },
          { status: 502 },
        );
      }

      // Return the raw HTML. The client extracts readable content with
      // @mozilla/readability in the browser (avoids any server-side DOM).
      const html = await response.text();
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    } catch {
      return Response.json({ error: "Failed to fetch article" }, { status: 502 });
    }
  }

  if (url.pathname === "/api/translate" && request.method === "POST") {
    return handleTranslate(request, env, userId);
  }

  if (url.pathname === "/api/quiz" && request.method === "POST") {
    return handleGenerateQuiz(request, env, userId);
  }

  if (url.pathname === "/api/quiz/grade" && request.method === "POST") {
    return handleGradeAnswer(request, env, userId);
  }

  if (url.pathname === "/api/translations" && request.method === "GET") {
    const query = url.searchParams.get("q") ?? "";
    const store = storeFor(env, userId);
    await refreshMockEntries(env, store);
    const entries = await store.list(query, MAX_ENTRIES);
    return json({ entries });
  }

  const reviewMatch = url.pathname.match(/^\/api\/translations\/(\d+)\/review$/);
  if (reviewMatch && request.method === "POST") {
    const body = await readJson<{ result?: ReviewResult }>(request);
    if (body?.result !== "again" && body?.result !== "known") {
      return json({ error: '`result` must be "again" or "known"' }, 400);
    }
    const entry = await storeFor(env, userId).review(
      Number(reviewMatch[1]),
      body.result,
      Date.now(),
    );
    if (!entry) return json({ error: "Translation not found" }, 404);
    return json({ entry });
  }

  const deleteMatch = url.pathname.match(/^\/api\/translations\/(\d+)$/);
  if (deleteMatch && request.method === "DELETE") {
    const removed = await storeFor(env, userId).remove(Number(deleteMatch[1]));
    if (!removed) return json({ error: "Translation not found" }, 404);
    return new Response(null, { status: 204 });
  }

  if (url.pathname === "/api/progress" && request.method === "GET") {
    const tzOffsetMinutes = clampTimezoneOffset(Number(url.searchParams.get("tzOffsetMinutes")));
    const store = storeFor(env, userId);
    const targetMinutes = await store.getDailyTarget();
    const today = localDayKey(Date.now(), tzOffsetMinutes);
    const wide = await store.getHistory(today, STREAK_WINDOW_DAYS);
    const response: ProgressResponse = {
      targetMinutes,
      today: wide[wide.length - 1],
      history: wide.slice(-HISTORY_DAYS),
      streak: computeStreak(wide, targetMinutes, today),
    };
    return json(response);
  }

  if (url.pathname === "/api/progress/read" && request.method === "POST") {
    const body = await readJson<Partial<RecordReadingRequest>>(request);
    const articleUrl = safeArticleUrl(body?.articleUrl);
    if (!body || typeof body.minutes !== "number" || !articleUrl) {
      return json({ error: "`articleUrl` and `minutes` are required" }, 400);
    }

    const tzOffsetMinutes = clampTimezoneOffset(
      typeof body.tzOffsetMinutes === "number" ? body.tzOffsetMinutes : 0,
    );
    const minutes = clampReadingMinutes(body.minutes);
    const now = Date.now();
    const day = localDayKey(now, tzOffsetMinutes);
    const store = storeFor(env, userId);

    const targetMinutes = await store.getDailyTarget();
    const before = await store.getDailyProgress(day);
    const { counted, today } = await store.recordReading({
      day,
      articleUrl,
      articleTitle:
        typeof body.articleTitle === "string" ? body.articleTitle.slice(0, 300) : undefined,
      minutes,
      tzOffsetMinutes,
      now,
    });
    const wide = await store.getHistory(day, STREAK_WINDOW_DAYS);

    const response: RecordReadingResponse = {
      targetMinutes,
      today,
      streak: computeStreak(wide, targetMinutes, day),
      justMetTarget:
        counted &&
        !isTargetMet(before.minutes, targetMinutes) &&
        isTargetMet(today.minutes, targetMinutes),
      counted,
    };
    return json(response);
  }

  if (url.pathname === "/api/progress/target" && request.method === "PUT") {
    const body = await readJson<Partial<SetTargetRequest>>(request);
    if (!body || typeof body.targetMinutes !== "number") {
      return json({ error: "`targetMinutes` is required" }, 400);
    }

    const targetMinutes = clampDailyTarget(body.targetMinutes);
    const tzOffsetMinutes = clampTimezoneOffset(
      typeof body.tzOffsetMinutes === "number" ? body.tzOffsetMinutes : 0,
    );
    const store = storeFor(env, userId);
    await store.setDailyTarget(targetMinutes, Date.now());

    const today = localDayKey(Date.now(), tzOffsetMinutes);
    const wide = await store.getHistory(today, STREAK_WINDOW_DAYS);
    const response: SetTargetResponse = {
      targetMinutes,
      streak: computeStreak(wide, targetMinutes, today),
    };
    return json(response);
  }

  if (url.pathname === "/api/notifications" && request.method === "GET") {
    return json(await notificationsResponse(env, storeFor(env, userId)));
  }

  if (url.pathname === "/api/notifications" && request.method === "PUT") {
    const body = await readJson<Partial<UpdateNotificationsRequest>>(request);
    if (!body || typeof body.enabled !== "boolean") {
      return json({ error: "`enabled` is required" }, 400);
    }

    const store = storeFor(env, userId);
    await store.setNotificationSettings(
      {
        enabled: body.enabled,
        reminderMinutes: clampReminderMinutes(
          typeof body.reminderMinutes === "number"
            ? body.reminderMinutes
            : DEFAULT_REMINDER_MINUTES,
        ),
        timezone: isValidTimeZone(body.timezone) ? body.timezone : FALLBACK_TIMEZONE,
      },
      Date.now(),
    );
    await store.scheduleReminder();
    // Opting in after today's reminder time delivers the nudge right away.
    await store.maybeSendReminderNow();
    return json(await notificationsResponse(env, store));
  }

  if (url.pathname === "/api/notifications/subscribe" && request.method === "POST") {
    const subscription = readPushSubscription(await readJson<unknown>(request));
    if (!subscription) return json({ error: "Invalid push subscription" }, 400);
    await storeFor(env, userId).upsertPushSubscription(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      Date.now(),
    );
    return new Response(null, { status: 204 });
  }

  if (url.pathname === "/api/notifications/unsubscribe" && request.method === "POST") {
    const body = await readJson<{ endpoint?: unknown }>(request);
    if (typeof body?.endpoint !== "string" || body.endpoint.length === 0) {
      return json({ error: "`endpoint` is required" }, 400);
    }
    await storeFor(env, userId).removePushSubscription(body.endpoint);
    return new Response(null, { status: 204 });
  }

  if (url.pathname === "/api/notifications/test" && request.method === "POST") {
    if (!vapidFromEnv(env)) {
      return json({ error: "Push notifications are not configured" }, 503);
    }
    const result = await storeFor(env, userId).deliverPush({
      title: "Notifiche attive 🔔",
      body: "Riceverai un promemoria se a fine giornata non avrai ancora letto.",
      url: "/",
      tag: "notification-test",
    });
    if (result.delivered + result.gone + result.failed === 0) {
      return json({ error: "No push subscription for this device" }, 400);
    }
    return json({ ok: true, ...result });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    const { userId, setCookie } = resolveIdentity(request);

    let response: Response;
    try {
      response = await handleApi(request, env, userId);
    } catch (error) {
      console.error("Unhandled API error", error);
      response = json({ error: "Internal error" }, 500);
    }

    if (setCookie) {
      const withCookie = new Response(response.body, response);
      withCookie.headers.append("set-cookie", setCookie);
      response = withCookie;
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
