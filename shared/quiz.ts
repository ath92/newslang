/**
 * Quiz helpers shared by the Worker (generation/grading) and the React app
 * (grading multiple choice, assembling the session result). Keep this file
 * dependency-free, like the rest of `shared/`.
 */

import type {
  Quiz,
  QuizChoice,
  QuizMode,
  QuizQuestion,
  QuizQuestionResult,
  QuizQuestionType,
  QuizResult,
} from "./contracts";

/** Bounds on how many questions a quiz may contain. */
export const QUIZ_MIN_QUESTIONS = 3;
export const QUIZ_MAX_QUESTIONS = 10;
export const QUIZ_DEFAULT_QUESTIONS = 6;
/** Longest article body we forward to the model (characters). */
export const QUIZ_MAX_ARTICLE_CHARS = 16000;
/** Score at or above which an open answer counts as correct. */
export const OPEN_PASS_THRESHOLD = 0.6;
/** Longest reader answer we accept for grading. */
export const MAX_QUIZ_ANSWER_CHARS = 2000;

const CHOICE_IDS = ["A", "B", "C"] as const;
const QUESTION_TYPES = new Set<QuizQuestionType>(["open", "multiple_choice"]);

/** Collapse whitespace and cap a reader answer for display and storage. */
export function normalizeAnswer(value: string, maxLength = MAX_QUIZ_ANSWER_CHARS): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * The question types a quiz should contain for a given mode, in order. `mixed`
 * alternates open/multiple-choice starting with open.
 */
export function plannedQuestionTypes(mode: QuizMode, count: number): QuizQuestionType[] {
  const total = clampQuestionCount(count);
  return Array.from({ length: total }, (_, index) => {
    if (mode === "open") return "open";
    if (mode === "multiple_choice") return "multiple_choice";
    return index % 2 === 0 ? "open" : "multiple_choice";
  });
}

/** Clamp a requested question count into the supported range. */
export function clampQuestionCount(value: unknown): number {
  const count = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : NaN;
  if (!Number.isFinite(count)) return QUIZ_DEFAULT_QUESTIONS;
  return Math.min(Math.max(count, QUIZ_MIN_QUESTIONS), QUIZ_MAX_QUESTIONS);
}

/** True when the reader picked the correct option. */
export function gradeChoice(question: QuizQuestion, choiceId: string): boolean {
  return question.type === "multiple_choice" && question.correctChoiceId === choiceId;
}

/** Assemble a finished session, ready to be persisted into progress later. */
export function buildQuizResult(input: {
  quiz: Pick<Quiz, "articleUrl" | "title" | "questions">;
  mode: QuizMode;
  startedAt: number;
  completedAt: number;
  answers: QuizQuestionResult[];
}): QuizResult {
  const correctCount = input.answers.filter((answer) => answer.correct).length;
  return {
    articleUrl: input.quiz.articleUrl,
    articleTitle: input.quiz.title || undefined,
    mode: input.mode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Math.max(0, input.completedAt - input.startedAt),
    correctCount,
    total: input.quiz.questions.length,
    questions: input.answers,
  };
}

/* ------------------------------------------------------------------ */
/* Model-output parsing                                                */
/* ------------------------------------------------------------------ */

/** Pull the first JSON object or array out of a (possibly chatty) model reply. */
export function extractJsonBlock(text: string): unknown {
  const cleaned = text
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .trim();

  const pairs = [
    { close: "}", start: cleaned.indexOf("{") },
    { close: "]", start: cleaned.indexOf("[") },
  ]
    .filter((pair) => pair.start !== -1)
    .sort((a, b) => a.start - b.start);

  for (const { close, start } of pairs) {
    const end = cleaned.lastIndexOf(close);
    if (end <= start) continue;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // Try the other bracket pair.
    }
  }
  return null;
}
function asNonEmptyString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeChoices(value: unknown): QuizChoice[] | null {
  if (!Array.isArray(value)) return null;
  const texts = value
    .map((entry) => {
      if (typeof entry === "string") return asNonEmptyString(entry, 300);
      if (entry && typeof entry === "object" && "text" in entry) {
        return asNonEmptyString((entry as { text?: unknown }).text, 300);
      }
      return null;
    })
    .filter((text): text is string => text !== null);

  if (texts.length !== 3) return null;
  return texts.map((text, index) => ({ id: CHOICE_IDS[index], text }));
}

function resolveCorrectChoiceId(
  value: Record<string, unknown>,
  choices: QuizChoice[],
): string | null {
  const raw = value.correctChoiceId ?? value.correct_choice_id;
  if (typeof raw === "string" && choices.some((choice) => choice.id === raw.toUpperCase())) {
    return raw.toUpperCase();
  }
  const index = value.correctIndex ?? value.correct_index ?? value.answerIndex;
  if (
    typeof index === "number" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < choices.length
  ) {
    return choices[index].id;
  }
  return null;
}

/** Validate and normalize a single question. Returns null when unusable. */
export function validateQuizQuestion(value: unknown, id: string): QuizQuestion | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const prompt = asNonEmptyString(record.prompt ?? record.question ?? record.text, 500);
  if (!prompt) return null;

  const rawType = record.type;
  const type: QuizQuestionType =
    typeof rawType === "string" && QUESTION_TYPES.has(rawType.toLowerCase() as QuizQuestionType)
      ? (rawType.toLowerCase() as QuizQuestionType)
      : Array.isArray(record.choices)
        ? "multiple_choice"
        : "open";

  const explanation = asNonEmptyString(record.explanation, 500) ?? undefined;

  if (type === "multiple_choice") {
    const choices = normalizeChoices(record.choices);
    if (!choices) return null;
    const correctChoiceId = resolveCorrectChoiceId(record, choices);
    if (!correctChoiceId) return null;
    return { id, type, prompt, choices, correctChoiceId, explanation };
  }

  const referenceAnswer =
    asNonEmptyString(record.referenceAnswer ?? record.reference_answer ?? record.answer, 600) ??
    undefined;
  return { id, type, prompt, referenceAnswer, explanation };
}

/**
 * Turn a raw model response into normalized questions. Accepts either a bare
 * array or an object with a `questions` array.
 */
export function parseQuizQuestions(text: string): QuizQuestion[] | null {
  const payload = extractJsonBlock(text);
  if (!payload) return null;

  const list = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { questions?: unknown }).questions)
      ? (payload as { questions: unknown[] }).questions
      : null;
  if (!list || list.length === 0) return null;

  const questions = list
    .map((entry, index) => validateQuizQuestion(entry, `q${index + 1}`))
    .filter((question): question is QuizQuestion => question !== null);

  return questions.length > 0 ? questions : null;
}

/** Parsed shape of the grading model's reply. */
export interface ParsedGrade {
  correct: boolean;
  score: number;
  correctness: string;
  language: string;
}

function clampScore(value: unknown): number {
  const score = typeof value === "number" && Number.isFinite(value) ? value : NaN;
  if (!Number.isFinite(score)) return 0;
  // Accept both 0–1 and 0–100 scales.
  const normalized = score > 1 ? score / 100 : score;
  return Math.min(Math.max(normalized, 0), 1);
}

/** Parse the grading model's reply, tolerating surrounding prose. */
export function parseGradeResponse(text: string): ParsedGrade | null {
  const payload = extractJsonBlock(text);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  const score = clampScore(record.score);
  const correctness =
    asNonEmptyString(record.correctness ?? record.content ?? record.feedback, 600) ?? "";
  const language = asNonEmptyString(record.language ?? record.grammar, 600) ?? "";
  const rawCorrect = record.correct ?? record.isCorrect ?? record.is_correct;
  const correct = typeof rawCorrect === "boolean" ? rawCorrect : score >= OPEN_PASS_THRESHOLD;

  if (!correctness && !language) return null;
  return { correct, score, correctness, language };
}
