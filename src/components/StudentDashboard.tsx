import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Award,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  History,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  Play,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { OfficialExamSummary, PracticeQuizRecord } from '../types/index';
import { DocumentStudio } from './DocumentStudio';
import { BrandMark } from './BrandMark';

interface StudentDashboardData {
  activeExamAttempt?: {
    attemptId: string;
    examId: string;
    examTitle: string;
  } | null;
  stats: {
    documentsCount: number;
    practiceQuizzesCount: number;
    availableExamsCount: number;
    completedExamsCount: number;
    avgExamPercentage: number | null;
    avgPracticePercentage: number | null;
  };
  practiceQuizzes: PracticeQuizRecord[];
  availableExams: OfficialExamSummary[];
  completedExams: OfficialExamSummary[];
  recentActivity: Array<{
    id: string;
    type: string;
    title: string;
    detail: string;
    timestamp: string;
  }>;
}

type StudentTab = 'overview' | 'upload' | 'practice' | 'exams' | 'history';

export function StudentDashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<StudentTab>('overview');
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<StudentDashboardData>('/api/student/dashboard');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load student dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleDeleteQuiz = async (quizId: string) => {
    try {
      await api.delete(`/api/practice-quizzes/${quizId}`);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete practice quiz.');
    }
  };

  const handleLogout = async () => {
    await logout();
    onNavigate('/');
  };

  const navItems: Array<{ id: StudentTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'upload', label: 'Upload & AI Studio', icon: Upload },
    { id: 'practice', label: 'My Practice Quizzes', icon: BookOpen },
    { id: 'exams', label: 'Official Exams', icon: Clock },
    { id: 'history', label: 'History & Analytics', icon: History },
  ];

  return (
    <div className="min-h-screen bg-[#F5F1E8] text-[#252525] flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="lg:w-64 bg-[#171717] text-white shrink-0 flex flex-col justify-between">
        <div>
          <div className="px-6 h-16 flex items-center justify-between border-b border-[#303030]">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              aria-label="ExamAI home"
              className="whitespace-nowrap shrink-0"
            >
              <BrandMark variant="dark" size="sm" />
            </button>
            <span className="text-[11px] font-medium text-[#DFC58E]">Study Mode</span>
          </div>

          <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#C9A45C] text-[#171717] font-semibold'
                      : 'text-[#D6D0C4] hover:bg-[#303030] hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden lg:block p-4 border-t border-[#303030] space-y-3">
          <div>
            <div className="text-sm font-semibold text-white truncate">{user?.name}</div>
            <div className="text-xs text-[#B5B0A6] truncate">{user?.email}</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[#303030] hover:bg-[#3D3D3D] text-xs font-semibold text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white border-b border-[#E3DED3] px-6 h-16 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-display font-bold text-[#252525] truncate">
              Welcome back, {user?.name}
            </h1>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {data?.activeExamAttempt ? (
              <button
                type="button"
                onClick={() => onNavigate(`/exam/${data.activeExamAttempt!.examId}`)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#B77B25] hover:bg-[#9E681E] text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                Resume Active Exam
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setTab('upload')}
                className="px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold transition-colors whitespace-nowrap"
              >
                Upload Study Material
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Sign out"
              className="lg:hidden p-2 rounded-lg border border-[#E3DED3] text-[#77736C]"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-[1200px] w-full mx-auto space-y-8">
          {data?.activeExamAttempt && (
            <div
              data-testid="active-exam-lockout-banner"
              className="p-5 rounded-xl bg-[#B77B25]/15 border border-[#B77B25] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-[#B77B25] shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-sm font-bold text-[#252525]">
                    Exam Security Lockout Active — {data.activeExamAttempt.examTitle}
                  </div>
                  <p className="text-xs text-[#7A4F12]">
                    AI question generation, uploaded study documents, and practice quizzes are locked on the server until you submit your active official examination.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(`/exam/${data.activeExamAttempt!.examId}`)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#171717] hover:bg-[#303030] text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
                Resume Active Exam
              </button>
            </div>
          )}
          {loading && !data ? (
            <div className="py-16 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-[#66543A] animate-spin" />
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-[#C64B4B]/10 border border-[#C64B4B]/35 text-sm text-[#982E2E]">
              {error}
            </div>
          ) : data ? (
            <>
              {tab === 'overview' && (
                <div className="space-y-8">
                  {/* KPI Grid */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">My Documents</div>
                      <div className="font-mono text-2xl font-bold text-[#252525] tabular-nums mt-1">
                        {data.stats.documentsCount}
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">Practice Quizzes</div>
                      <div className="font-mono text-2xl font-bold text-[#4476A8] tabular-nums mt-1">
                        {data.stats.practiceQuizzesCount}
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">Available Official Exams</div>
                      <div className="font-mono text-2xl font-bold text-[#66543A] tabular-nums mt-1">
                        {data.stats.availableExamsCount}
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">Completed Exams</div>
                      <div className="font-mono text-2xl font-bold text-[#25845D] tabular-nums mt-1">
                        {data.stats.completedExamsCount}
                      </div>
                    </div>
                  </div>

                  {/* Available Official Exams & Practice Quick Actions */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-7 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-display font-bold text-[#252525]">Available Official Exams</h2>
                        <button
                          type="button"
                          onClick={() => setTab('exams')}
                          className="text-xs font-semibold text-[#66543A] hover:underline"
                        >
                          View all
                        </button>
                      </div>

                      {data.availableExams.length === 0 ? (
                        <p className="text-sm text-[#77736C] py-4">
                          No pending official exams right now. Generate a practice quiz from your notes!
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {data.availableExams.map((ex) => (
                            <div
                              key={ex.id}
                              className="p-4 rounded-xl bg-[#F5F1E8]/70 border border-[#E3DED3] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                            >
                              <div>
                                <div className="text-sm font-bold text-[#252525]">{ex.title}</div>
                                <div className="text-xs text-[#77736C] mt-0.5 tabular-nums">
                                  {ex.subject} · {ex.durationMinutes} min · {ex.totalMarks} marks ·{' '}
                                  {ex.questionCount} questions
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => onNavigate(`/exam/${ex.id}`)}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold whitespace-nowrap shrink-0"
                              >
                                <Play className="w-3.5 h-3.5" />
                                {ex.studentAttempt?.status === 'in_progress' ? 'Resume Exam' : 'Start Exam'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Recent Activity */}
                    <div className="lg:col-span-5 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-[#4476A8]" />
                        <h2 className="text-base font-display font-bold text-[#252525]">Recent Activity</h2>
                      </div>
                      {data.recentActivity.length === 0 ? (
                        <p className="text-sm text-[#77736C]">No recent attempts recorded yet.</p>
                      ) : (
                        <div className="divide-y divide-[#E3DED3]">
                          {data.recentActivity.map((act) => (
                            <div key={act.id} className="py-3 first:pt-0 last:pb-0">
                              <div className="text-xs font-semibold text-[#252525]">{act.title}</div>
                              <div className="text-xs text-[#77736C] mt-0.5 tabular-nums">{act.detail}</div>
                              <div className="text-[11px] text-[#77736C] mt-0.5 tabular-nums">
                                {new Date(act.timestamp).toLocaleString()}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quick Practice Quizzes */}
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-display font-bold text-[#252525]">My Practice Quizzes</h2>
                      <button
                        type="button"
                        onClick={() => setTab('upload')}
                        className="text-xs font-semibold text-[#4476A8] hover:underline"
                      >
                        + Generate New Quiz
                      </button>
                    </div>
                    {data.practiceQuizzes.length === 0 ? (
                      <p className="text-sm text-[#77736C]">
                        Upload a PDF or DOCX study guide to create your first practice quiz.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {data.practiceQuizzes.slice(0, 4).map((q) => (
                          <div
                            key={q.id}
                            className="p-4 rounded-xl bg-[#F5F1E8]/70 border border-[#E3DED3] flex items-center justify-between gap-4"
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-[#252525] truncate">{q.title}</div>
                              <div className="text-xs text-[#77736C] mt-0.5 tabular-nums">
                                {q.difficulty} · {q.questions.length} questions
                                {q.lastAttempt ? ` · Last: ${q.lastAttempt.percentage}%` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={Boolean(data.activeExamAttempt)}
                              onClick={() => onNavigate(`/practice/${q.id}`)}
                              className="px-3.5 py-2 rounded-lg bg-[#171717] hover:bg-[#303030] disabled:opacity-40 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                            >
                              {data.activeExamAttempt ? 'Locked' : 'Practice'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === 'upload' &&
                (data.activeExamAttempt ? (
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-8 text-center space-y-4">
                    <div className="w-12 h-12 rounded-xl bg-[#EFEBE2] text-[#66543A] flex items-center justify-center mx-auto">
                      <Lock className="w-6 h-6" />
                    </div>
                    <h2 className="text-lg font-display font-bold text-[#252525]">
                      AI Question Studio &amp; Study Documents Locked
                    </h2>
                    <p className="text-sm text-[#77736C] max-w-lg mx-auto">
                      While your official exam ({data.activeExamAttempt.examTitle}) is in progress, study materials and AI question generation are disabled.
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigate(`/exam/${data.activeExamAttempt!.examId}`)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Resume Active Exam
                    </button>
                  </div>
                ) : (
                  <DocumentStudio role="student" onSaved={loadDashboard} />
                ))}

              {tab === 'practice' &&
                (data.activeExamAttempt ? (
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-8 text-center space-y-4">
                    <div className="w-12 h-12 rounded-xl bg-[#EFEBE2] text-[#66543A] flex items-center justify-center mx-auto">
                      <Lock className="w-6 h-6" />
                    </div>
                    <h2 className="text-lg font-display font-bold text-[#252525]">
                      Practice Quizzes Locked During Active Exam
                    </h2>
                    <p className="text-sm text-[#77736C] max-w-lg mx-auto">
                      Complete and submit {data.activeExamAttempt.examTitle} before resuming self-paced practice quizzes.
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigate(`/exam/${data.activeExamAttempt!.examId}`)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Resume Active Exam
                    </button>
                  </div>
                ) : (
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-display font-bold text-[#252525]">My Saved Practice Quizzes</h2>
                      <p className="text-sm text-[#77736C]">
                        Self-paced quizzes generated from your uploaded study materials.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab('upload')}
                      className="px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold"
                    >
                      New Practice Quiz
                    </button>
                  </div>

                  {data.practiceQuizzes.length === 0 ? (
                    <div className="py-10 text-center space-y-3">
                      <FileText className="w-8 h-8 text-[#77736C] mx-auto" />
                      <p className="text-sm text-[#77736C]">No practice quizzes saved yet.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-[#E3DED3]">
                      {data.practiceQuizzes.map((q) => (
                        <div key={q.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-bold text-[#252525]">{q.title}</div>
                            <div className="text-xs text-[#77736C] mt-0.5 tabular-nums">
                              Topic: {q.topic} · {q.difficulty} · {q.questions.length} questions
                              {q.lastAttempt && ` · Last Attempt: ${q.lastAttempt.score}/${q.lastAttempt.totalMarks} (${q.lastAttempt.percentage}%)`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => onNavigate(`/practice/${q.id}`)}
                              className="px-4 py-2 rounded-lg bg-[#171717] hover:bg-[#303030] text-white text-xs font-semibold"
                            >
                              {q.lastAttempt ? 'Retake Quiz' : 'Start Practice'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteQuiz(q.id)}
                              aria-label={`Delete practice quiz ${q.title}`}
                              className="p-2 rounded-lg border border-[#E3DED3] text-[#77736C] hover:text-[#C64B4B]"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                      </div>
                    )}
                  </div>
                ))}

              {tab === 'exams' && (
                <div className="space-y-6">
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <h2 className="text-lg font-display font-bold text-[#252525]">Available Official Examinations</h2>
                    {data.availableExams.length === 0 ? (
                      <p className="text-sm text-[#77736C]">No official exams currently open.</p>
                    ) : (
                      <div className="space-y-3">
                        {data.availableExams.map((ex) => (
                          <div
                            key={ex.id}
                            className="p-5 rounded-xl bg-[#F5F1E8]/70 border border-[#E3DED3] flex flex-col md:flex-row md:items-center justify-between gap-4"
                          >
                            <div className="space-y-1">
                              <div className="text-base font-bold text-[#252525]">{ex.title}</div>
                              <div className="text-xs text-[#77736C] tabular-nums">
                                {ex.subject} · Instructor: {ex.teacherName} · {ex.durationMinutes} min ·{' '}
                                {ex.totalMarks} total marks (Pass: {ex.passingMarks})
                              </div>
                              <p className="text-xs text-[#77736C]">{ex.instructions}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => onNavigate(`/exam/${ex.id}`)}
                              className="px-5 py-2.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold whitespace-nowrap shrink-0"
                            >
                              {ex.studentAttempt?.status === 'in_progress' ? 'Resume Attempt' : 'Start Official Exam'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === 'history' && (
                <div className="space-y-6">
                  {/* Performance Analytics */}
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-5">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-[#66543A]" />
                      <h2 className="text-lg font-display font-bold text-[#252525]">Performance Analytics</h2>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x divide-y sm:divide-y-0 divide-[#E3DED3] border-y border-[#E3DED3] py-4">
                      <div className="pb-4 sm:pb-0 sm:pr-6">
                        <div className="text-xs font-medium text-[#77736C]">Official Exam Average (Evaluated)</div>
                        <div className="font-mono text-2xl font-bold text-[#252525] tabular-nums mt-1">
                          {data.stats.avgExamPercentage !== null ? `${data.stats.avgExamPercentage}%` : '—'}
                        </div>
                      </div>
                      <div className="pt-4 sm:pt-0 sm:pl-6">
                        <div className="text-xs font-medium text-[#77736C]">Practice Quiz Average</div>
                        <div className="font-mono text-2xl font-bold text-[#4476A8] tabular-nums mt-1">
                          {data.stats.avgPracticePercentage !== null ? `${data.stats.avgPracticePercentage}%` : '—'}
                        </div>
                      </div>
                    </div>

                    {data.completedExams.length > 0 && (
                      <div className="space-y-3 pt-2">
                        <div className="text-xs font-semibold text-[#77736C]">Official Exam Score Breakdown</div>
                        {data.completedExams.map((ex) => {
                          const pct = ex.studentAttempt?.result?.percentage ?? 0;
                          const evaluated = ex.studentAttempt?.result?.status === 'evaluated';
                          return (
                            <div key={ex.id} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-[#252525]">{ex.title}</span>
                                <span className="font-mono tabular-nums text-[#77736C]">
                                  {evaluated ? `${pct}%` : 'Pending Teacher Evaluation'}
                                </span>
                              </div>
                              <div className="h-2.5 bg-[#EFEBE2] rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    ex.studentAttempt?.result?.passed ? 'bg-[#25845D]' : 'bg-[#C9A45C]'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(4, pct))}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Completed Exam History Table */}
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <Award className="w-5 h-5 text-[#4476A8]" />
                      <h2 className="text-lg font-display font-bold text-[#252525]">Completed Official Exams</h2>
                    </div>

                    {data.completedExams.length === 0 ? (
                      <p className="text-sm text-[#77736C]">You have not submitted any official exams yet.</p>
                    ) : (
                      <div className="divide-y divide-[#E3DED3]">
                        {data.completedExams.map((ex) => {
                          const res = ex.studentAttempt?.result;
                          return (
                            <div
                              key={ex.id}
                              className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                            >
                              <div>
                                <div className="text-sm font-bold text-[#252525]">{ex.title}</div>
                                <div className="text-xs text-[#77736C] mt-0.5 tabular-nums">
                                  {ex.subject} · Submitted{' '}
                                  {ex.studentAttempt?.submittedAt
                                    ? new Date(ex.studentAttempt.submittedAt).toLocaleString()
                                    : ''}
                                </div>
                              </div>
                              <div className="flex items-center gap-4 shrink-0">
                                <div className="text-right tabular-nums">
                                  {res?.status === 'evaluated' ? (
                                    <>
                                      <div className="font-mono text-sm font-bold text-[#252525]">
                                        {res.totalScore}/{res.totalMarks} ({res.percentage}%)
                                      </div>
                                      <div
                                        className={`text-xs font-semibold inline-flex items-center gap-1 ${
                                          res.passed ? 'text-[#25845D]' : 'text-[#C64B4B]'
                                        }`}
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        {res.passed ? 'Passed' : 'Did Not Pass'}
                                      </div>
                                    </>
                                  ) : (
                                    <div className="text-xs font-semibold text-[#B77B25]">
                                      Pending Descriptive Review
                                    </div>
                                  )}
                                </div>
                                {ex.studentAttempt && (
                                  <button
                                    type="button"
                                    onClick={() => onNavigate(`/results/${ex.studentAttempt!.id}`)}
                                    className="px-4 py-2 rounded-lg border border-[#E3DED3] hover:bg-[#EFEBE2] text-xs font-semibold text-[#252525]"
                                  >
                                    View Result
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
