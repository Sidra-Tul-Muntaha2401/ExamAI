import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RotateCcw,
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

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [result, setResult] = useState<{
    score: number;
    totalMarks: number;
    percentage: number;
    hasDescriptiveQuestions: boolean;
    breakdown: GradedBreakdownItem[];
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<{ quiz: PracticeQuizRecord }>(`/api/practice-quizzes/${quizId}`);
        setQuiz(data.quiz);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load practice quiz.');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit quiz.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setAnswers({});
    setCurrentIndex(0);
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
            <span>{error || 'Practice quiz not found.'}</span>
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
  const activeQuestion = questions[currentIndex];
  const answeredCount = questions.filter((q) => (answers[q.id] || '').trim().length > 0).length;

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
            {answeredCount}/{questions.length} answered
          </div>
        </div>
      </header>

      <main className="max-w-[1000px] mx-auto px-6 py-8">
        {result ? (
          <div className="space-y-6">
            <div className="bg-[#171717] text-white rounded-2xl p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div>
                <p className="text-xs font-semibold text-[#DFC58E]">Practice Quiz Results</p>
                <h1 className="text-2xl font-display font-bold mt-1">{quiz.title}</h1>
                <p className="text-sm text-[#D6D0C4] mt-1">
                  {result.hasDescriptiveQuestions
                    ? 'Objective questions are auto-graded below. Compare your written responses against suggested answers.'
                    : 'All objective questions graded automatically.'}
                </p>
              </div>
              <div className="flex items-center gap-6 shrink-0">
                <div>
                  <div className="font-mono text-3xl font-bold tabular-nums text-[#C9A45C]">
                    {result.percentage}%
                  </div>
                  <div className="text-xs text-[#D6D0C4] tabular-nums">
                    {result.score} / {result.totalMarks} objective marks
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Retake Quiz
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {result.breakdown.map((item, idx) => (
                <div key={item.id} className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-mono font-semibold text-[#77736C]">
                      Question {idx + 1} · {item.questionType.replace('_', ' ').toUpperCase()} · {item.marks} marks
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
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 bg-white border border-[#E3DED3] rounded-2xl p-6 lg:p-8 space-y-6">
              <div className="flex items-center justify-between text-xs text-[#77736C]">
                <span className="font-mono font-semibold text-[#66543A]">
                  Question {currentIndex + 1} of {questions.length}
                </span>
                <span>
                  {activeQuestion.questionType.replace('_', ' ').toUpperCase()} · {activeQuestion.difficulty} ·{' '}
                  {activeQuestion.marks} marks
                </span>
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
                    onClick={handleSubmit}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    Submit Practice Quiz
                  </button>
                )}
              </div>
            </div>

            <div className="lg:col-span-4 bg-white border border-[#E3DED3] rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-[#252525]">Question Navigator</h3>
              <div className="grid grid-cols-5 gap-2">
                {questions.map((q, idx) => {
                  const answered = (answers[q.id] || '').trim().length > 0;
                  const active = idx === currentIndex;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setCurrentIndex(idx)}
                      className={`h-10 rounded-lg font-mono text-xs font-semibold border transition-colors ${
                        active
                          ? 'bg-[#C9A45C] border-[#C9A45C] text-[#171717]'
                          : answered
                            ? 'bg-[#EFEBE2] border-[#66543A]/40 text-[#252525]'
                            : 'bg-[#F5F1E8] border-[#E3DED3] text-[#77736C]'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className="w-full py-2.5 rounded-xl bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold transition-colors"
              >
                Finish &amp; Grade Quiz
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
