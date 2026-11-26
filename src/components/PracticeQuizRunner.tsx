import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Flag,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import type { PracticeQuizRecord, QuizQuestion } from '../types/index';

interface PracticeQuizRunnerProps {
  quizId: string;
  onNavigate: (path: string) => void;
}

interface GradedBreakdownItem extends QuizQuestion {
  studentAnswer: string;
  isCorrect: boolean | null;
  marksAwarded: number | null;
}

export function PracticeQuizRunner({ quizId, onNavigate }: PracticeQuizRunnerProps) {
  const [quiz, setQuiz] = useState<PracticeQuizRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [hasStarted, setHasStarted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('started') === '1';
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [markedForReview, setMarkedForReview] = useState<Record<string, boolean>>({});
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'incorrect' | 'correct'>('all');

  const [result, setResult] = useState<{
    score: number;
    totalMarks: number;
    percentage: number;
    hasDescriptiveQuestions: boolean;
    breakdown: GradedBreakdownItem[];
  } | null>(null);

  useEffect(() => {
    const startedFromQuery =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('started') === '1';
    setHasStarted(startedFromQuery);
    setResult(null);
    setAnswers({});
    setMarkedForReview({});
    setCurrentIndex(0);
    setReviewFilter('all');

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<{ quiz: PracticeQuizRecord }>(`/api/practice-quizzes/${quizId}`);
        setQuiz(data.quiz);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load practice exam.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [quizId]);

  const handleSubmit = async () => {
    if (!quiz) return;
    setSubmitting(true);
    try {
      const data = await api.post<{
        attempt: {
          score: number;
          totalMarks: number;
          percentage: number;
          hasDescriptiveQuestions: boolean;
          breakdown: GradedBreakdownItem[];
        };
      }>(`/api/practice-quizzes/${quiz.id}/attempt`, { answers });
      setResult(data.attempt);
      setShowConfirmModal(false);
      setReviewFilter('all');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit exam.');
    } finally {
      setSubmitting(false);
    }
  };

  const requestSubmit = () => {
    if (!quiz) return;
    const unanswered =
      quiz.questions.length - quiz.questions.filter((q) => (answers[q.id] || '').trim().length > 0).length;
    const flagged = quiz.questions.filter((q) => Boolean(markedForReview[q.id])).length;
    if (unanswered > 0 || flagged > 0) {
      setShowConfirmModal(true);
    } else {
      void handleSubmit();
    }
  };

  const handleRetry = () => {
    setResult(null);
    setAnswers({});
    setMarkedForReview({});
    setShowConfirmModal(false);
    setCurrentIndex(0);
    setReviewFilter('all');
    setHasStarted(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F1E8] flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-[#66543A] animate-spin" />
      </div>
    );
  }

  if (error || !quiz) {
    return (
      <div className="min-h-screen bg-[#F5F1E8] p-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-white border border-[#E3DED3] rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-[#C64B4B] font-semibold">
            <AlertCircle className="w-5 h-5" />
            <span>{error || 'Practice exam not found.'}</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/student')}
            className="px-4 py-2 rounded-lg bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const questions = quiz.questions;
  const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 0), 0);
  const activeQuestion = questions[currentIndex];
  const answeredCount = questions.filter((q) => (answers[q.id] || '').trim().length > 0).length;
  const flaggedCount = questions.filter((q) => Boolean(markedForReview[q.id])).length;

  const correctCount = result ? result.breakdown.filter((b) => b.isCorrect === true).length : 0;
  const incorrectCount = result ? result.breakdown.filter((b) => b.isCorrect === false).length : 0;
  const selfReviewCount = result ? result.breakdown.filter((b) => b.isCorrect === null).length : 0;
  const filteredBreakdown = result
    ? result.breakdown.filter((item) => {
        if (reviewFilter === 'incorrect') return item.isCorrect === false;
        if (reviewFilter === 'correct') return item.isCorrect === true;
        return true;
      })
    : [];

  return (
    <div className="min-h-screen bg-[#F5F1E8] text-[#252525]">
      <header className="bg-white border-b border-[#E3DED3]">
        <div className="max-w-[1000px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => onNavigate('/student')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#66543A] hover:text-[#252525]"
          >
            <ArrowLeft className="w-4 h-4" />
            Student Dashboard
          </button>
          <div className="text-sm font-semibold truncate">{quiz.title}</div>
          <div className="text-xs font-mono text-[#77736C] tabular-nums">
            {hasStarted ? `${answeredCount}/${questions.length} answered` : `${questions.length} questions`}
          </div>
        </div>
      </header>

      <main className="max-w-[1000px] mx-auto px-6 py-8">
        {!hasStarted && !result ? (
          <div
            data-testid="practice-instructions-screen"
            className="bg-white border border-[#E3DED3] rounded-2xl overflow-hidden max-w-3xl mx-auto"
          >
            <div className="bg-[#171717] text-white p-6 sm:p-8 space-y-2">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#DFC58E]">
                <ShieldCheck className="w-4 h-4" />
                Exam Instructions
              </div>
              <h1 className="text-2xl font-display font-bold">{quiz.title}</h1>
              <p className="text-sm text-[#D6D0C4]">
                Topic: {quiz.topic} · Difficulty: {quiz.difficulty}
              </p>
            </div>

            <div className="p-6 sm:p-8 space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-[#F5F1E8]/80 border border-[#E3DED3]">
                  <div className="text-[11px] font-medium text-[#77736C]">Total Questions</div>
                  <div className="font-mono text-lg font-bold text-[#252525] tabular-nums mt-0.5">
                    {questions.length}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-[#F5F1E8]/80 border border-[#E3DED3]">
                  <div className="text-[11px] font-medium text-[#77736C]">Format</div>
                  <div className="text-sm font-bold text-[#252525] mt-1">
                    {quiz.questionType.replace('_', ' ').toUpperCase()}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-[#F5F1E8]/80 border border-[#E3DED3]">
                  <div className="text-[11px] font-medium text-[#77736C]">Total Marks</div>
                  <div className="font-mono text-lg font-bold text-[#252525] tabular-nums mt-0.5">
                    {totalMarks}
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-[#F5F1E8]/70 border border-[#E3DED3] p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-[#252525]">
                  <BookOpen className="w-4 h-4 text-[#66543A]" />
                  Before You Begin
                </div>
                <ul className="space-y-2 text-sm text-[#4F4B45] list-disc pl-5">
                  <li>
                    Correct answers and explanations remain hidden until you submit the exam.
                  </li>
                  <li>
                    You can navigate between questions with <strong>Next</strong>, <strong>Previous</strong>, and the <strong>Question Navigator</strong>.
                  </li>
                  <li>
                    Click <strong>Submit Exam</strong> at the end to grade your answers and review explanations.
                  </li>
                </ul>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#E3DED3]">
                <button
                  type="button"
                  onClick={() => onNavigate('/student')}
                  className="px-4 py-2.5 rounded-xl border border-[#E3DED3] bg-white hover:bg-[#EFEBE2] text-sm font-semibold text-[#252525]"
                >
                  Back to Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => setHasStarted(true)}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-bold transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Start Practice Exam
                </button>
              </div>
            </div>
          </div>
        ) : result ? (
          <div className="space-y-6">
            <div className="bg-[#171717] text-white rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div>
                <p className="text-xs font-semibold text-[#DFC58E]">Practice Exam Results</p>
                <h1 className="text-2xl font-display font-bold mt-1">{quiz.title}</h1>
                <p className="text-sm text-[#D6D0C4] mt-1">
                  {result.hasDescriptiveQuestions
                    ? 'Objective questions are auto-graded below. Compare your written responses against suggested answers.'
                    : 'All objective questions graded automatically.'}
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-4 text-xs">
                  <span className="px-2.5 py-1 rounded-md bg-white/10 text-white font-semibold tabular-nums">
                    {result.breakdown.length} Total Questions
                  </span>
                  <span className="px-2.5 py-1 rounded-md bg-[#25845D]/20 text-[#7CE3B6] font-semibold tabular-nums">
                    {correctCount} Correct
                  </span>
                  <span className="px-2.5 py-1 rounded-md bg-[#C64B4B]/20 text-[#F49A9A] font-semibold tabular-nums">
                    {incorrectCount} Incorrect
                  </span>
                  {result.hasDescriptiveQuestions && (
                    <span className="px-2.5 py-1 rounded-md bg-[#4476A8]/25 text-[#9CC7F0] font-semibold tabular-nums">
                      {selfReviewCount} Self-Review
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-6 shrink-0">
                <div>
                  <div className="font-mono text-3xl font-bold tabular-nums text-[#C9A45C]">
                    {result.percentage}%
                  </div>
                  <div className="text-xs text-[#D6D0C4] tabular-nums">
                    {result.score} / {result.totalMarks} marks
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Retake Exam
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-display font-bold text-[#252525]">Answer Review</h2>
              <div className="flex items-center gap-2">
                {(['all', 'incorrect', 'correct'] as const).map((filterKey) => (
                  <button
                    key={filterKey}
                    type="button"
                    onClick={() => setReviewFilter(filterKey)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      reviewFilter === filterKey
                        ? 'bg-[#171717] border-[#171717] text-white'
                        : 'bg-white border-[#E3DED3] text-[#77736C] hover:text-[#252525]'
                    }`}
                  >
                    {filterKey === 'all'
                      ? `All (${result.breakdown.length})`
                      : filterKey === 'incorrect'
                        ? `Incorrect (${incorrectCount})`
                        : `Correct (${correctCount})`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              {filteredBreakdown.map((item) => {
                const questionNumber = result.breakdown.findIndex((b) => b.id === item.id) + 1;
                return (
                  <div key={item.id} className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs font-mono font-semibold text-[#77736C]">
                        Question {questionNumber} · {item.questionType.replace('_', ' ').toUpperCase()} · {item.marks} marks
                      </span>
                      {item.isCorrect === true && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#25845D]">
                          <CheckCircle2 className="w-4 h-4" />
                          Correct
                        </span>
                      )}
                      {item.isCorrect === false && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#C64B4B]">
                          <XCircle className="w-4 h-4" />
                          Incorrect
                        </span>
                      )}
                      {item.isCorrect === null && (
                        <span className="text-xs font-semibold text-[#4476A8]">Self-Review</span>
                      )}
                    </div>

                    <p className="text-base font-semibold text-[#252525]">{item.prompt}</p>

                    <div className="text-sm space-y-1.5 pt-1">
                      <div>
                        <span className="font-semibold text-[#77736C]">Your Answer: </span>
                        <span className="text-[#252525]">{item.studentAnswer || 'No answer provided'}</span>
                      </div>
                      {item.correctAnswer && (
                        <div>
                          <span className="font-semibold text-[#25845D]">Correct Answer: </span>
                          <span className="text-[#19593E] font-medium">{item.correctAnswer}</span>
                        </div>
                      )}
                      {item.explanation && (
                        <div className="p-3 rounded-lg bg-[#EFEBE2] text-xs text-[#252525] mt-2">
                          <strong>Explanation:</strong> {item.explanation}
                        </div>
                      )}
                      {item.suggestedAnswer && (
                        <div className="p-3 rounded-lg bg-[#F5F1E8] border border-[#E3DED3] text-xs text-[#252525] mt-2 space-y-1">
                          <div>
                            <strong>Suggested Answer:</strong> {item.suggestedAnswer}
                          </div>
                          {item.markingGuidance && (
                            <div>
                              <strong>Marking Guidance:</strong> {item.markingGuidance}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 bg-white border border-[#E3DED3] rounded-2xl p-6 lg:p-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#77736C]">
                <span className="font-mono font-semibold text-[#66543A]">
                  Question {currentIndex + 1} of {questions.length}
                </span>
                <div className="flex items-center gap-3">
                  <span>
                    {activeQuestion.questionType.replace('_', ' ').toUpperCase()} · {activeQuestion.difficulty} ·{' '}
                    {activeQuestion.marks} marks
                  </span>
                  <button
                    type="button"
                    aria-pressed={Boolean(markedForReview[activeQuestion.id])}
                    onClick={() =>
                      setMarkedForReview((prev) => ({
                        ...prev,
                        [activeQuestion.id]: !prev[activeQuestion.id],
                      }))
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                      markedForReview[activeQuestion.id]
                        ? 'bg-[#B77B25]/15 border-[#B77B25] text-[#7A4F12]'
                        : 'bg-[#F5F1E8] border-[#E3DED3] text-[#77736C] hover:text-[#252525]'
                    }`}
                  >
                    <Flag className="w-3 h-3" />
                    {markedForReview[activeQuestion.id] ? 'Flagged' : 'Flag'}
                  </button>
                </div>
              </div>

              <div className="w-full h-1.5 bg-[#EFEBE2] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#C9A45C] transition-all duration-200"
                  style={{ width: `${Math.round(((currentIndex + 1) / questions.length) * 100)}%` }}
                />
              </div>

              <h2 className="text-xl font-display font-semibold text-[#252525] leading-snug">
                {activeQuestion.prompt}
              </h2>

              {activeQuestion.questionType === 'mcq' || activeQuestion.questionType === 'true_false' ? (
                <div className="space-y-3">
                  {activeQuestion.options.map((opt) => {
                    const selected = answers[activeQuestion.id] === opt;
                    return (
                      <label
                        key={opt}
                        className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                          selected
                            ? 'bg-[#EFEBE2] border-[#C9A45C] text-[#252525]'
                            : 'bg-[#F5F1E8]/60 border-[#E3DED3] hover:bg-[#EFEBE2]/60'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`pq-${activeQuestion.id}`}
                          checked={selected}
                          onChange={() => setAnswers((prev) => ({ ...prev, [activeQuestion.id]: opt }))}
                          className="accent-[#66543A] w-4 h-4 shrink-0"
                        />
                        <span className="text-sm font-medium">{opt}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <textarea
                  rows={activeQuestion.questionType === 'long_answer' ? 7 : 4}
                  value={answers[activeQuestion.id] || ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [activeQuestion.id]: e.target.value }))}
                  placeholder="Write your practice answer here..."
                  className="w-full p-4 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-xl focus:bg-white focus:border-[#C9A45C] outline-none"
                />
              )}

              <div className="flex items-center justify-between pt-4 border-t border-[#E3DED3]">
                <button
                  type="button"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E3DED3] text-sm font-semibold text-[#252525] disabled:opacity-40 hover:bg-[#EFEBE2]"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Previous
                </button>

                {currentIndex < questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold"
                  >
                    Next
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={requestSubmit}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    Submit Exam
                  </button>
                )}
              </div>
            </div>

            <div className="lg:col-span-4 bg-white border border-[#E3DED3] rounded-2xl p-6 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">Question Navigator</h3>
                <p className="text-xs text-[#77736C] mt-0.5 tabular-nums">
                  {answeredCount} answered · {questions.length - answeredCount} remaining
                  {flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ''}
                </p>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {questions.map((q, idx) => {
                  const answered = (answers[q.id] || '').trim().length > 0;
                  const flagged = Boolean(markedForReview[q.id]);
                  const active = idx === currentIndex;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setCurrentIndex(idx)}
                      aria-current={active ? 'step' : undefined}
                      className={`relative h-10 rounded-lg font-mono text-xs font-semibold border transition-colors ${
                        active
                          ? 'bg-[#C9A45C] border-[#C9A45C] text-[#171717]'
                          : flagged
                            ? 'bg-[#B77B25]/15 border-[#B77B25] text-[#7A4F12]'
                            : answered
                              ? 'bg-[#EFEBE2] border-[#66543A]/40 text-[#252525]'
                              : 'bg-[#F5F1E8] border-[#E3DED3] text-[#77736C]'
                      }`}
                    >
                      {idx + 1}
                      {flagged && (
                        <span
                          aria-hidden="true"
                          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#B77B25]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={requestSubmit}
                className="w-full py-2.5 rounded-xl bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold transition-colors"
              >
                Submit Exam
              </button>
            </div>
          </div>
        )}
      </main>

      {showConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 bg-[#171717]/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-[#E3DED3] rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-display font-bold text-[#252525]">Submit Practice Exam?</h3>
            <p className="text-sm text-[#77736C]">
              You answered <strong className="text-[#252525]">{answeredCount}</strong> of{' '}
              <strong className="text-[#252525]">{questions.length}</strong> questions
              {flaggedCount > 0 ? ` and flagged ${flaggedCount} for review` : ''}.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-lg border border-[#E3DED3] text-sm font-semibold text-[#77736C] hover:text-[#252525]"
              >
                Keep Reviewing
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit()}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Submit &amp; Grade Exam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
