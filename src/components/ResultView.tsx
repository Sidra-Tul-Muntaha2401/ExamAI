import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { computeAttemptAnalytics } from '../lib/examRules';
import type { ExamResultDetail, UserRole } from '../types/index';

interface ResultViewProps {
  attemptId: string;
  userRole: UserRole;
  onNavigate: (path: string) => void;
}

export function ResultView({ attemptId, userRole, onNavigate }: ResultViewProps) {
  const [result, setResult] = useState<ExamResultDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiExplanations, setAiExplanations] = useState<Record<string, string>>({});
  const [explainingId, setExplainingId] = useState<string | null>(null);
  const [explainErrors, setExplainErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get<{ result: ExamResultDetail }>(`/api/results/${attemptId}`);
        setResult(data.result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load result.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [attemptId]);

  const handleExplainQuestion = async (questionId: string) => {
    if (explainingId) return;
    setExplainingId(questionId);
    setExplainErrors((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    try {
      const res = await api.post<{ explanation: string }>(`/api/results/${attemptId}/explain`, {
        questionId,
      });
      setAiExplanations((prev) => ({ ...prev, [questionId]: res.explanation }));
    } catch (err) {
      setExplainErrors((prev) => ({
        ...prev,
        [questionId]: err instanceof Error ? err.message : 'Unable to generate explanation.',
      }));
    } finally {
      setExplainingId(null);
    }
  };

  const backPath = userRole === 'admin' ? '/admin' : userRole === 'teacher' ? '/teacher' : '/student';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F1E8] flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-[#66543A] animate-spin" />
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="min-h-screen bg-[#F5F1E8] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-[#E3DED3] rounded-2xl p-6 space-y-4">
          <div className="flex items-start gap-2 text-[#C64B4B] text-sm font-semibold">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error || 'Result not found.'}</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate(backPath)}
            className="px-4 py-2 rounded-lg bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const analytics = computeAttemptAnalytics(result);

  return (
    <div className="min-h-screen bg-[#F5F1E8] text-[#252525]">
      <header className="bg-white border-b border-[#E3DED3]">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => onNavigate(backPath)}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#66543A] hover:text-[#252525] whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
          <span className="text-xs font-mono text-[#77736C] truncate">
            Submitted {result.submittedAt ? new Date(result.submittedAt).toLocaleString() : '—'}
          </span>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Summary Banner */}
        <div className="bg-[#171717] text-white rounded-2xl p-6 sm:p-8 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-7 space-y-2">
            <div className="text-xs font-semibold text-[#DFC58E]">{result.subject}</div>
            <h1 className="text-2xl lg:text-3xl font-display font-bold">{result.examTitle}</h1>
            <p className="text-sm text-[#D6D0C4]">
              Student: {result.studentName} ({result.studentEmail})
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-3 text-xs">
              {result.status === 'pending_evaluation' ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#DFC58E]">
                  <Clock className="w-4 h-4" />
                  Objective Auto-Graded · Descriptive Questions Pending Teacher Review
                </span>
              ) : result.passed ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#6AD1A6]">
                  <CheckCircle2 className="w-4 h-4" />
                  Passed (Passing threshold: {result.passingMarks}/{result.totalMarks})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#F08A8A]">
                  <XCircle className="w-4 h-4" />
                  Did Not Pass (Passing threshold: {result.passingMarks}/{result.totalMarks})
                </span>
              )}
            </div>
          </div>

          <div className="md:col-span-5 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-2 gap-3.5 bg-[#303030] border border-white/10 rounded-xl p-4 sm:p-5">
            <div>
              <div className="text-[11px] text-[#D6D0C4]">Total Score</div>
              <div className="font-mono text-xl font-bold tabular-nums mt-0.5">
                {result.totalScore}/{result.totalMarks}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#D6D0C4]">Percentage</div>
              <div className="font-mono text-xl font-bold tabular-nums text-[#C9A45C] mt-0.5">
                {result.percentage}%
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#D6D0C4]">Time Taken</div>
              <div className="font-mono text-lg font-bold tabular-nums mt-0.5">
                {analytics.formattedDuration}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#D6D0C4]">Tab Leaves</div>
              <div className="font-mono text-lg font-bold tabular-nums mt-0.5">
                {result.tabSwitchCount}
              </div>
            </div>
          </div>
        </div>

        {/* Real Attempt Analytics & Breakdown */}
        <section aria-label="Attempt analytics" className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="bg-white border border-[#E3DED3] rounded-xl p-4">
              <div className="text-xs text-[#77736C]">Correct / Met Threshold</div>
              <div className="font-mono text-2xl font-bold text-[#25845D] tabular-nums mt-1">
                {analytics.correctCount}
              </div>
            </div>
            <div className="bg-white border border-[#E3DED3] rounded-xl p-4">
              <div className="text-xs text-[#77736C]">Incorrect</div>
              <div className="font-mono text-2xl font-bold text-[#C64B4B] tabular-nums mt-1">
                {analytics.incorrectCount}
              </div>
            </div>
            <div className="bg-white border border-[#E3DED3] rounded-xl p-4">
              <div className="text-xs text-[#77736C]">Unanswered</div>
              <div className="font-mono text-2xl font-bold text-[#77736C] tabular-nums mt-1">
                {analytics.unansweredCount}
              </div>
            </div>
            <div className="bg-white border border-[#E3DED3] rounded-xl p-4">
              <div className="text-xs text-[#77736C]">Pending Teacher Review</div>
              <div className="font-mono text-2xl font-bold text-[#4476A8] tabular-nums mt-1">
                {analytics.pendingCount}
              </div>
            </div>
          </div>

          {(analytics.byDifficulty.length > 0 || analytics.byQuestionType.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border border-[#E3DED3] rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-[#252525]">
                  <BarChart3 className="w-4 h-4 text-[#66543A]" />
                  <span>Accuracy by Question Type</span>
                </div>
                <div className="space-y-2.5">
                  {analytics.byQuestionType.map((b) => (
                    <div key={b.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#252525]">
                          {b.label} ({b.totalQuestions})
                        </span>
                        <span className="font-mono font-semibold text-[#66543A] tabular-nums">
                          {b.accuracyPercent !== null
                            ? `${b.marksEarned}/${b.marksPossible} marks (${b.accuracyPercent}%)`
                            : 'Pending review'}
                        </span>
                      </div>
                      <div className="h-1.5 bg-[#EFEBE2] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#C9A45C]"
                          style={{ width: `${b.accuracyPercent ?? 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-[#E3DED3] rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-[#252525]">
                  <BarChart3 className="w-4 h-4 text-[#66543A]" />
                  <span>Performance by Difficulty</span>
                </div>
                <div className="space-y-2.5">
                  {analytics.byDifficulty.map((b) => (
                    <div key={b.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#252525]">
                          {b.label} ({b.totalQuestions})
                        </span>
                        <span className="font-mono font-semibold text-[#66543A] tabular-nums">
                          {b.accuracyPercent !== null
                            ? `${b.marksEarned}/${b.marksPossible} marks (${b.accuracyPercent}%)`
                            : 'Pending review'}
                        </span>
                      </div>
                      <div className="h-1.5 bg-[#EFEBE2] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#66543A]"
                          style={{ width: `${b.accuracyPercent ?? 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {analytics.reviewFocusLabels.length > 0 && (
            <div className="bg-[#EFEBE2] border border-[#E3DED3] rounded-xl p-4 space-y-1.5">
              <div className="text-xs font-bold text-[#66543A]">Recommended Next Study Focus</div>
              <ul className="list-disc pl-5 text-xs text-[#252525] space-y-1">
                {analytics.reviewFocusLabels.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Question-by-Question Review */}
        <div className="space-y-4">
          <h2 className="text-lg font-display font-bold text-[#252525]">Question-by-Question Breakdown</h2>
          {result.questions.map((q, idx) => (
            <div key={q.questionId} className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-[#77736C]">
                  Question {idx + 1} · {q.questionType.replace('_', ' ').toUpperCase()} · Max {q.marks} marks
                </span>
                <span className="font-mono text-xs font-bold tabular-nums text-[#252525]">
                  {q.marksAwarded !== null ? `${q.marksAwarded} / ${q.marks} marks` : 'Pending Teacher Evaluation'}
                </span>
              </div>

              <p className="text-base font-semibold text-[#252525]">{q.prompt}</p>

              <div className="p-3.5 rounded-lg bg-[#EFEBE2] border border-[#E3DED3] text-sm">
                <span className="font-semibold text-[#66543A]">Student Response: </span>
                <span className="text-[#252525] whitespace-pre-wrap">
                  {q.studentAnswer || 'No response submitted'}
                </span>
              </div>

              {(q.questionType === 'mcq' || q.questionType === 'true_false') && (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    {q.isCorrect ? (
                      <CheckCircle2 className="w-4 h-4 text-[#25845D] shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-[#C64B4B] shrink-0" />
                    )}
                    <span>
                      <strong>Correct Answer:</strong> {q.correctAnswer}
                    </span>
                  </div>
                  {q.explanation && (
                    <div className="p-3 rounded-lg bg-[#F5F1E8] border border-[#E3DED3] text-xs text-[#252525]">
                      <strong>Explanation:</strong> {q.explanation}
                    </div>
                  )}
                </div>
              )}

              {(q.questionType === 'short_answer' || q.questionType === 'long_answer') && (
                <div className="space-y-2 text-xs">
                  {q.teacherFeedback && (
                    <div className="p-3.5 rounded-lg bg-[#25845D]/10 border border-[#25845D]/30 text-[#19593E]">
                      <strong>Teacher Feedback:</strong> {q.teacherFeedback}
                    </div>
                  )}
                  {q.suggestedAnswer && (
                    <div className="p-3.5 rounded-lg bg-[#F5F1E8] border border-[#E3DED3] text-[#252525]">
                      <strong>Model Answer Reference:</strong> {q.suggestedAnswer}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-1">
                {!aiExplanations[q.questionId] ? (
                  <button
                    type="button"
                    disabled={explainingId === q.questionId}
                    onClick={() => void handleExplainQuestion(q.questionId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E3DED3] bg-[#F5F1E8]/70 hover:bg-[#EFEBE2] text-xs font-semibold text-[#66543A] transition-colors disabled:opacity-50"
                  >
                    {explainingId === q.questionId ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-[#C9A45C]" />
                    )}
                    {explainingId === q.questionId ? 'Generating AI Concept Explanation...' : 'Explain Concept Deeper with AI'}
                  </button>
                ) : (
                  <div className="p-3.5 rounded-lg bg-[#171717] text-white text-xs space-y-1.5">
                    <div className="inline-flex items-center gap-1.5 font-semibold text-[#DFC58E]">
                      <Sparkles className="w-3.5 h-3.5" />
                      AI Study Explanation (Post-Exam Review Only)
                    </div>
                    <p className="text-[#E6E2D8] leading-relaxed whitespace-pre-wrap">
                      {aiExplanations[q.questionId]}
                    </p>
                  </div>
                )}
                {explainErrors[q.questionId] && (
                  <p className="text-xs text-[#C64B4B] mt-1.5">{explainErrors[q.questionId]}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Integrity & Activity Log */}
        <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#66543A]" />
            <h2 className="text-base font-display font-bold text-[#252525]">Exam Activity Log</h2>
          </div>
          {result.activityLogs.some((l) => l.eventType === 'auto_submitted_violation_limit') && (
            <div className="p-3.5 rounded-lg bg-[#C64B4B]/10 border border-[#C64B4B]/35 text-xs font-medium text-[#982E2E]">
              This examination was automatically submitted after reaching the configured tab-switch / lockdown violation threshold.
            </div>
          )}
          {result.activityLogs.some((l) => l.eventType === 'ai_access_blocked') && (
            <div className="p-3.5 rounded-lg bg-[#B77B25]/15 border border-[#B77B25]/40 text-xs font-medium text-[#7A4F12]">
              Attempted access to ExamAI question generation during this active examination was blocked and recorded.
            </div>
          )}
          <p className="text-xs text-[#77736C]">
            Browser visibility, clipboard, and focus events logged during the attempt. Note: browser monitoring is an integrity aid and does not access cameras or microphones.
          </p>
          {result.activityLogs.length === 0 ? (
            <p className="text-sm text-[#77736C]">No activity events recorded.</p>
          ) : (
            <div className="divide-y divide-[#E3DED3]">
              {result.activityLogs.map((log) => (
                <div key={log.id} className="py-2.5 flex items-center justify-between gap-4 text-xs">
                  <div>
                    <span className="font-mono font-semibold text-[#252525]">{log.eventType}</span>
                    <span className="text-[#77736C] ml-2">{log.details}</span>
                  </div>
                  <span className="font-mono text-[#77736C] tabular-nums shrink-0">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
