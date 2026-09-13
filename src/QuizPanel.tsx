import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GradeAnswerResponse,
  Quiz,
  QuizQuestionResult,
  QuizResult,
} from "../shared/contracts";
import { buildQuizResult, gradeChoice, QUIZ_MAX_ARTICLE_CHARS } from "../shared/quiz";
import { generateQuiz, gradeQuizAnswer } from "./api";
import { useSettings } from "./settings";

type Phase = "generating" | "question" | "grading" | "done" | "error";

interface QuizPanelProps {
  articleUrl: string;
  title?: string;
  text: string;
  /** Collapse the sheet without discarding the quiz. */
  onClose: () => void;
}

function resultLabel(correct: boolean): string {
  return correct ? "Corretto" : "Da rivedere";
}

/**
 * Bottom-docked article quiz. Generates a quiz on mount, walks the reader
 * through the questions one at a time, and shows a final score. Keeping the
 * panel mounted preserves progress while it is collapsed.
 */
export function QuizPanel({ articleUrl, title, text, onClose }: QuizPanelProps) {
  const { quiz: preferences } = useSettings();

  const [expanded, setExpanded] = useState(true);
  const [phase, setPhase] = useState<Phase>("generating");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizQuestionResult[]>([]);
  const [current, setCurrent] = useState<QuizQuestionResult | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [openAnswer, setOpenAnswer] = useState("");
  const [feedback, setFeedback] = useState<GradeAnswerResponse | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const generated = useRef(false);

  const generate = useCallback(async () => {
    setPhase("generating");
    setError(null);
    setQuiz(null);
    setIndex(0);
    setAnswers([]);
    setCurrent(null);
    setSelectedChoice(null);
    setOpenAnswer("");
    setFeedback(null);
    setResult(null);
    startedAt.current = Date.now();
    try {
      const response = await generateQuiz({
        articleUrl,
        title,
        text: text.slice(0, QUIZ_MAX_ARTICLE_CHARS),
        mode: preferences.mode,
        count: preferences.questionCount,
      });
      setQuiz(response.quiz);
      setExpanded(true);
      setPhase("question");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile generare il quiz.");
      setPhase("error");
    }
  }, [articleUrl, title, text, preferences.mode, preferences.questionCount]);

  useEffect(() => {
    if (generated.current) return;
    generated.current = true;
    void generate();
  }, [generate]);

  const question = quiz?.questions[index] ?? null;
  const total = quiz?.questions.length ?? 0;
  const answered = current !== null;
  const isLast = total > 0 && index + 1 >= total;
  const progress = total > 0 ? (index + (answered ? 1 : 0)) / total : 0;

  const submitChoice = useCallback(
    (choiceId: string) => {
      if (!question || current) return;
      const correct = gradeChoice(question, choiceId);
      setSelectedChoice(choiceId);
      setCurrent({
        questionId: question.id,
        type: "multiple_choice",
        prompt: question.prompt,
        answer: choiceId,
        correct,
        score: correct ? 1 : 0,
      });
    },
    [current, question],
  );

  const submitOpen = useCallback(async () => {
    if (!question || current || !openAnswer.trim()) return;
    setPhase("grading");
    setError(null);
    try {
      const grade = await gradeQuizAnswer({ question, answer: openAnswer, articleTitle: title });
      setFeedback(grade);
      setCurrent({
        questionId: question.id,
        type: "open",
        prompt: question.prompt,
        answer: openAnswer.trim(),
        correct: grade.correct,
        score: grade.score,
      });
      setPhase("question");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile valutare la risposta.");
      setPhase("question");
    }
  }, [current, openAnswer, question, title]);

  const advance = useCallback(() => {
    if (!quiz || !current) return;
    const nextAnswers = [...answers, current];
    setAnswers(nextAnswers);
    setCurrent(null);
    setSelectedChoice(null);
    setOpenAnswer("");
    setFeedback(null);
    setError(null);

    if (index + 1 >= quiz.questions.length) {
      setResult(
        buildQuizResult({
          quiz,
          mode: preferences.mode,
          startedAt: startedAt.current,
          completedAt: Date.now(),
          answers: nextAnswers,
        }),
      );
      setPhase("done");
    } else {
      setIndex((value) => value + 1);
    }
  }, [answers, current, index, preferences.mode, quiz]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) {
        event.stopPropagation();
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const choiceState = useMemo(() => {
    if (!question?.choices) return () => "";
    return (id: string) => {
      if (!selectedChoice) return "";
      if (id === question.correctChoiceId) return " quiz-choice--correct";
      if (id === selectedChoice) return " quiz-choice--wrong";
      return " quiz-choice--muted";
    };
  }, [question, selectedChoice]);

  return (
    <section
      className={`quiz-sheet${expanded ? " quiz-sheet--expanded" : " quiz-sheet--collapsed"}`}
      aria-label="Quiz sull'articolo"
      data-translate-ignore
    >
      <div className="quiz-sheet__bar">
        <button
          type="button"
          className="quiz-sheet__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="quiz-sheet__title">
            🎓 Quiz
            {total > 0 && phase !== "done" ? ` · ${Math.min(index + 1, total)}/${total}` : ""}
            {result ? ` · ${result.correctCount}/${result.total}` : ""}
          </span>
        </button>
        <button
          type="button"
          className="quiz-sheet__close"
          aria-label="Chiudi il quiz"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {expanded ? (
        <div className="quiz-sheet__body">
          {phase === "generating" ? (
            <div className="quiz-state" role="status" aria-live="polite">
              <span className="quiz-spinner" aria-hidden="true" />
              <p>Sto preparando il quiz…</p>
            </div>
          ) : null}

          {phase === "error" ? (
            <div className="quiz-state">
              <p>⚠️ {error}</p>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void generate()}
              >
                Riprova
              </button>
            </div>
          ) : null}

          {phase === "question" || phase === "grading" ? (
            question ? (
              <>
                <div className="quiz-progress" aria-hidden="true">
                  <span className="quiz-progress__fill" style={{ width: `${progress * 100}%` }} />
                </div>
                <p className="quiz-counter">
                  Domanda {index + 1} di {total}
                </p>
                <p className="quiz-prompt">{question.prompt}</p>

                {question.type === "multiple_choice" && question.choices ? (
                  <ul className="quiz-choices">
                    {question.choices.map((choice) => (
                      <li key={choice.id}>
                        <button
                          type="button"
                          className={`quiz-choice${choiceState(choice.id)}`}
                          onClick={() => submitChoice(choice.id)}
                          disabled={answered}
                          aria-pressed={selectedChoice === choice.id}
                        >
                          <span className="quiz-choice__id">{choice.id}</span>
                          <span>{choice.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="quiz-open">
                    <textarea
                      className="quiz-textarea"
                      rows={3}
                      placeholder="Scrivi la tua risposta in italiano…"
                      value={openAnswer}
                      onChange={(event) => setOpenAnswer(event.target.value)}
                      disabled={answered || phase === "grading"}
                    />
                    {!answered ? (
                      <button
                        type="button"
                        className="button button--primary"
                        onClick={() => void submitOpen()}
                        disabled={phase === "grading" || !openAnswer.trim()}
                      >
                        {phase === "grading" ? "Valuto…" : "Verifica"}
                      </button>
                    ) : null}
                  </div>
                )}

                {answered && current ? (
                  <div
                    className={`quiz-feedback quiz-feedback--${current.correct ? "ok" : "ko"}`}
                    role="status"
                    aria-live="polite"
                  >
                    <p className="quiz-feedback__verdict">{resultLabel(current.correct)}</p>
                    {feedback ? (
                      <>
                        {feedback.correctness ? (
                          <p className="quiz-feedback__line">📝 {feedback.correctness}</p>
                        ) : null}
                        {feedback.language ? (
                          <p className="quiz-feedback__line">✍️ {feedback.language}</p>
                        ) : null}
                      </>
                    ) : question.explanation ? (
                      <p className="quiz-feedback__line">{question.explanation}</p>
                    ) : null}
                  </div>
                ) : null}

                {error && phase === "question" ? <p className="quiz-error">{error}</p> : null}

                {answered ? (
                  <button
                    type="button"
                    className="button button--primary quiz-next"
                    onClick={advance}
                  >
                    {isLast ? "Vedi il risultato" : "Avanti"}
                  </button>
                ) : null}
              </>
            ) : null
          ) : null}

          {phase === "done" && result ? (
            <div className="quiz-results">
              <p className="quiz-results__score">
                {result.correctCount}/{result.total}
              </p>
              <p className="quiz-results__lead">
                {result.correctCount === result.total
                  ? "Perfetto! 🎉"
                  : result.correctCount >= result.total / 2
                    ? "Bel lavoro!"
                    : "Continua così, rileggi l'articolo e riprova."}
              </p>
              <ul className="quiz-results__list">
                {result.questions.map((item, itemIndex) => (
                  <li
                    key={item.questionId}
                    className={`quiz-results__item${item.correct ? " quiz-results__item--ok" : ""}`}
                  >
                    <span aria-hidden="true">{item.correct ? "✓" : "✗"}</span>
                    <span>
                      {itemIndex + 1}. {item.prompt}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="quiz-results__actions">
                <button type="button" className="button" onClick={() => void generate()}>
                  Rigioca
                </button>
                <button type="button" className="button button--primary" onClick={onClose}>
                  Chiudi
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="quiz-sheet__collapsed-progress" aria-hidden="true">
          <span
            className="quiz-sheet__collapsed-fill"
            style={{ width: `${result ? 100 : progress * 100}%` }}
          />
        </div>
      )}
    </section>
  );
}
