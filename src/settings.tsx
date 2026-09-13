import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { QuizMode } from "../shared/contracts";
import { clampQuestionCount, QUIZ_DEFAULT_QUESTIONS } from "../shared/quiz";

/** Per-device quiz preferences, persisted in `localStorage`. */
export interface QuizPreferences {
  /** Default question mode: open answer out of the box. */
  mode: QuizMode;
  questionCount: number;
}

export const DEFAULT_QUIZ_PREFERENCES: QuizPreferences = {
  mode: "open",
  questionCount: QUIZ_DEFAULT_QUESTIONS,
};

const STORAGE_KEY = "newslang.quiz";

const QUIZ_MODES = new Set<QuizMode>(["open", "multiple_choice", "mixed"]);

/** Coerce an unknown stored value into valid preferences. Exported for tests. */
export function parseQuizPreferences(value: unknown): QuizPreferences {
  if (!value || typeof value !== "object") return DEFAULT_QUIZ_PREFERENCES;
  const record = value as { mode?: unknown; questionCount?: unknown };
  const mode =
    typeof record.mode === "string" && QUIZ_MODES.has(record.mode as QuizMode)
      ? (record.mode as QuizMode)
      : DEFAULT_QUIZ_PREFERENCES.mode;
  const questionCount =
    typeof record.questionCount === "number"
      ? clampQuestionCount(record.questionCount)
      : DEFAULT_QUIZ_PREFERENCES.questionCount;
  return { mode, questionCount };
}

function loadQuizPreferences(): QuizPreferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? parseQuizPreferences(JSON.parse(stored)) : DEFAULT_QUIZ_PREFERENCES;
  } catch {
    // localStorage may be unavailable or hold malformed JSON.
    return DEFAULT_QUIZ_PREFERENCES;
  }
}

function saveQuizPreferences(preferences: QuizPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore write failures (e.g. private browsing).
  }
}

interface SettingsContextValue {
  quiz: QuizPreferences;
  /** Merge and persist a change to the quiz preferences. */
  setQuiz: (patch: Partial<QuizPreferences>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used within SettingsProvider");
  return value;
}

/** Holds client-side preferences (currently the quiz settings). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [quiz, setQuizState] = useState<QuizPreferences>(loadQuizPreferences);

  useEffect(() => {
    saveQuizPreferences(quiz);
  }, [quiz]);

  const setQuiz = useCallback((patch: Partial<QuizPreferences>) => {
    setQuizState((previous) => parseQuizPreferences({ ...previous, ...patch }));
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({ quiz, setQuiz }), [quiz, setQuiz]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
