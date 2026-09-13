import { describe, expect, it } from "vitest";
import {
  buildQuizResult,
  clampQuestionCount,
  extractJsonBlock,
  gradeChoice,
  normalizeAnswer,
  parseGradeResponse,
  parseQuizQuestions,
  plannedQuestionTypes,
  QUIZ_DEFAULT_QUESTIONS,
  QUIZ_MAX_QUESTIONS,
  QUIZ_MIN_QUESTIONS,
} from "../shared/quiz";
import type { QuizQuestionResult } from "../shared/contracts";

describe("extractJsonBlock", () => {
  it("parses a fenced JSON block", () => {
    expect(extractJsonBlock('```json\n{"questions": []}\n```')).toEqual({ questions: [] });
  });

  it("parses JSON buried in prose", () => {
    expect(extractJsonBlock('Sure! Here it is:\n[{"a":1}]\nHope that helps.')).toEqual([{ a: 1 }]);
  });

  it("returns null for malformed output", () => {
    expect(extractJsonBlock("not json at all")).toBeNull();
  });
});

describe("parseQuizQuestions", () => {
  it("accepts an object with a questions array", () => {
    const questions = parseQuizQuestions(
      JSON.stringify({
        questions: [
          {
            type: "multiple_choice",
            prompt: "Chi ha vinto?",
            choices: ["Roma", "Milano", "Napoli"],
            correctIndex: 1,
            explanation: "Milano ha vinto.",
          },
          {
            type: "open",
            prompt: "Perché è importante?",
            referenceAnswer: "Per l'economia.",
          },
        ],
      }),
    );

    expect(questions).toHaveLength(2);
    expect(questions?.[0]).toMatchObject({
      id: "q1",
      type: "multiple_choice",
      correctChoiceId: "B",
      choices: [
        { id: "A", text: "Roma" },
        { id: "B", text: "Milano" },
        { id: "C", text: "Napoli" },
      ],
    });
    expect(questions?.[1]).toMatchObject({
      id: "q2",
      type: "open",
      referenceAnswer: "Per l'economia.",
    });
  });

  it("accepts a bare array and a correctChoiceId", () => {
    const questions = parseQuizQuestions(
      '[{"prompt":"Dove?","type":"multiple_choice","choices":["A1","B1","C1"],"correctChoiceId":"c"}]',
    );
    expect(questions?.[0].correctChoiceId).toBe("C");
  });

  it("rejects multiple-choice questions without exactly three options", () => {
    const questions = parseQuizQuestions(
      '[{"type":"open","prompt":"Valida?"},{"type":"multiple_choice","prompt":"Rotta","choices":["solo","due"],"correctIndex":0}]',
    );
    expect(questions).toHaveLength(1);
    expect(questions?.[0].prompt).toBe("Valida?");
  });

  it("rejects multiple-choice questions with no correct option", () => {
    expect(
      parseQuizQuestions(
        '[{"type":"multiple_choice","prompt":"Senza risposta","choices":["a","b","c"]}]',
      ),
    ).toBeNull();
  });

  it("returns null for empty or malformed payloads", () => {
    expect(parseQuizQuestions("[]")).toBeNull();
    expect(parseQuizQuestions("garbage")).toBeNull();
  });
});

describe("parseGradeResponse", () => {
  it("parses a well-formed grading reply", () => {
    expect(
      parseGradeResponse(
        '{"correct":true,"score":0.8,"correctness":"Giusto.","language":"Buona grammatica."}',
      ),
    ).toEqual({
      correct: true,
      score: 0.8,
      correctness: "Giusto.",
      language: "Buona grammatica.",
    });
  });

  it("normalizes a 0–100 score and derives correctness", () => {
    const parsed = parseGradeResponse(
      '{"score":85,"correctness":"Ottimo.","language":"Nessun errore."}',
    );
    expect(parsed?.score).toBeCloseTo(0.85);
    expect(parsed?.correct).toBe(true);
  });

  it("returns null when there is no feedback", () => {
    expect(parseGradeResponse('{"score":1}')).toBeNull();
  });
});

describe("plannedQuestionTypes", () => {
  it("returns all open for the open mode", () => {
    expect(plannedQuestionTypes("open", 3)).toEqual(["open", "open", "open"]);
  });

  it("returns all multiple choice for the multiple choice mode", () => {
    expect(plannedQuestionTypes("multiple_choice", 3)).toEqual([
      "multiple_choice",
      "multiple_choice",
      "multiple_choice",
    ]);
  });

  it("alternates for the mixed mode", () => {
    expect(plannedQuestionTypes("mixed", 4)).toEqual([
      "open",
      "multiple_choice",
      "open",
      "multiple_choice",
    ]);
  });
});

describe("clampQuestionCount", () => {
  it("clamps into range and falls back to the default", () => {
    expect(clampQuestionCount(0)).toBe(QUIZ_MIN_QUESTIONS);
    expect(clampQuestionCount(99)).toBe(QUIZ_MAX_QUESTIONS);
    expect(clampQuestionCount("nope")).toBe(QUIZ_DEFAULT_QUESTIONS);
    expect(clampQuestionCount(5)).toBe(5);
  });
});

describe("gradeChoice", () => {
  const question = {
    id: "q1",
    type: "multiple_choice" as const,
    prompt: "?",
    choices: [
      { id: "A", text: "a" },
      { id: "B", text: "b" },
      { id: "C", text: "c" },
    ],
    correctChoiceId: "B",
  };

  it("is true only for the correct option", () => {
    expect(gradeChoice(question, "B")).toBe(true);
    expect(gradeChoice(question, "A")).toBe(false);
  });
});

describe("normalizeAnswer", () => {
  it("collapses whitespace and caps length", () => {
    expect(normalizeAnswer("  ciao   mondo  ")).toBe("ciao mondo");
    expect(normalizeAnswer("x".repeat(10), 3)).toBe("xxx");
  });
});

describe("buildQuizResult", () => {
  const answers: QuizQuestionResult[] = [
    { questionId: "q1", type: "open", prompt: "a", answer: "x", correct: true, score: 1 },
    {
      questionId: "q2",
      type: "multiple_choice",
      prompt: "b",
      answer: "A",
      correct: false,
      score: 0,
    },
  ];

  it("counts correct answers and duration", () => {
    const result = buildQuizResult({
      quiz: {
        articleUrl: "https://example.com/a",
        title: "Titolo",
        questions: [
          { id: "q1", type: "open", prompt: "a" },
          { id: "q2", type: "multiple_choice", prompt: "b" },
        ],
      },
      mode: "mixed",
      startedAt: 1000,
      completedAt: 4000,
      answers,
    });
    expect(result.correctCount).toBe(1);
    expect(result.total).toBe(2);
    expect(result.durationMs).toBe(3000);
    expect(result.articleTitle).toBe("Titolo");
  });
});
