import type {
  GenerateQuizRequest,
  GenerateQuizResponse,
  GradeAnswerRequest,
  GradeAnswerResponse,
  Headline,
  NotificationSettingsResponse,
  ProgressResponse,
  PushSubscriptionInput,
  RecordReadingRequest,
  RecordReadingResponse,
  ReviewResult,
  SetTargetRequest,
  SetTargetResponse,
  SourceId,
  TranslateRequest,
  TranslateResponse,
  TranslationEntry,
  UpdateNotificationsRequest,
} from "../shared/contracts";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Errore (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // Keep the generic message when the body is not JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function fetchHeadlines(source: SourceId): Promise<Headline[]> {
  const response = await fetch(`/api/headlines?source=${encodeURIComponent(source)}`);
  return readJson<Headline[]>(response);
}

export async function fetchArticleHtml(url: string): Promise<string> {
  const response = await fetch(`/api/article-html?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error(`Impossibile caricare l'articolo (${response.status})`);
  }
  return response.text();
}

/** Translate a selected phrase, saving it to the user's vocabulary. */
export async function translateSelection(input: TranslateRequest): Promise<TranslateResponse> {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<TranslateResponse>(response);
}

/** Every phrase the user has saved, newest first. */
export async function fetchTranslations(query = ""): Promise<TranslationEntry[]> {
  const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
  const response = await fetch(`/api/translations${suffix}`);
  const data = await readJson<{ entries: TranslationEntry[] }>(response);
  return data.entries;
}

/** Record how a review card went and get the updated spaced-repetition state. */
export async function reviewTranslation(
  id: number,
  result: ReviewResult,
): Promise<TranslationEntry> {
  const response = await fetch(`/api/translations/${id}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ result }),
  });
  const data = await readJson<{ entry: TranslationEntry }>(response);
  return data.entry;
}

export async function deleteTranslation(id: number): Promise<void> {
  const response = await fetch(`/api/translations/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Impossibile eliminare la voce (${response.status})`);
  }
}

/** Generate an article quiz with the LLM. */
export async function generateQuiz(input: GenerateQuizRequest): Promise<GenerateQuizResponse> {
  const response = await fetch("/api/quiz", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<GenerateQuizResponse>(response);
}

/** Grade one open answer against the question's reference answer. */
export async function gradeQuizAnswer(input: GradeAnswerRequest): Promise<GradeAnswerResponse> {
  const response = await fetch("/api/quiz/grade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<GradeAnswerResponse>(response);
}

/** Today's reading progress, the 7-day history and the current streak. */
export async function fetchProgress(tzOffsetMinutes: number): Promise<ProgressResponse> {
  const response = await fetch(
    `/api/progress?tzOffsetMinutes=${encodeURIComponent(tzOffsetMinutes)}`,
  );
  return readJson<ProgressResponse>(response);
}

/** Credit an article's estimated read time to today's goal. */
export async function recordReading(input: RecordReadingRequest): Promise<RecordReadingResponse> {
  const response = await fetch("/api/progress/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<RecordReadingResponse>(response);
}

/** Change the daily reading target (`0` turns the goal off). */
export async function setDailyTarget(input: SetTargetRequest): Promise<SetTargetResponse> {
  const response = await fetch("/api/progress/target", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<SetTargetResponse>(response);
}

/** This device's reminder settings and the VAPID key needed to subscribe. */
export async function fetchNotificationSettings(): Promise<NotificationSettingsResponse> {
  const response = await fetch("/api/notifications");
  return readJson<NotificationSettingsResponse>(response);
}

/** Enable/disable the reminder and/or change its local time. */
export async function updateNotificationSettings(
  input: UpdateNotificationsRequest,
): Promise<NotificationSettingsResponse> {
  const response = await fetch("/api/notifications", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<NotificationSettingsResponse>(response);
}

/** Register this device's push subscription with the Worker. */
export async function subscribeToPush(input: PushSubscriptionInput): Promise<void> {
  const response = await fetch("/api/notifications/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Impossibile attivare le notifiche (${response.status})`);
  }
}

/** Remove this device's push subscription from the Worker. */
export async function unsubscribeFromPush(endpoint: string): Promise<void> {
  const response = await fetch("/api/notifications/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) {
    throw new Error(`Impossibile disattivare le notifiche (${response.status})`);
  }
}

/** Ask the Worker to push a one-off test notification. */
export async function sendTestNotification(): Promise<void> {
  const response = await fetch("/api/notifications/test", { method: "POST" });
  if (!response.ok) {
    let message = `Errore (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // Keep the generic message when the body is not JSON.
    }
    throw new Error(message);
  }
}
