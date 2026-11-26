import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Award,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  GraduationCap,
  History,
  Home,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  Play,
  Plus,
  ShieldAlert,
  Trash2,
  TrendingUp,
  Upload,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type {
  ClassRecord,
  OfficialExamSummary,
  PracticeQuizRecord,
  StudentProgressSummary,
} from '../types/index';
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
    classesCount?: number;
    avgExamPercentage: number | null;
    avgPracticePercentage: number | null;
  };
  classes?: ClassRecord[];
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

type StudentTab = 'overview' | 'classes' | 'upload' | 'practice' | 'exams' | 'progress' | 'history';

export function StudentDashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<StudentTab>('overview');
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [progress, setProgress] = useState<StudentProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [progressLoading, setProgressLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [joiningClass, setJoiningClass] = useState(false);
  const [classNotice, setClassNotice] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashRes, clsRes] = await Promise.all([
        api.get<StudentDashboardData>('/api/student/dashboard'),
        api.get<{ classes: ClassRecord[] }>('/api/student/classes'),
      ]);
      setData(dashRes);
      setClasses(clsRes.classes || dashRes.classes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load student dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProgress = useCallback(async () => {
    setProgressLoading(true);
    try {
      const res = await api.get<{ progress: StudentProgressSummary }>('/api/student/progress');
      setProgress(res.progress);
    } catch {
      // Handled gracefully in UI
    } finally {
      setProgressLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (tab === 'progress') {
      void loadProgress();
    }
  }, [tab, loadProgress]);

  const handleDeleteQuiz = async (quizId: string) => {
    try {
      await api.delete(`/api/practice-quizzes/${quizId}`);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete practice quiz.');
    }
  };

  const handleJoinClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoiningClass(true);
    setClassNotice(null);
    setError(null);
    try {
      const res = await api.post<{ classRecord: ClassRecord }>('/api/student/classes/join', {
        enrollmentCode: joinCode.trim(),
      });
      setJoinCode('');
      setClassNotice(`Enrolled in ${res.classRecord.name} (${res.classRecord.subject}).`);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join class with that enrollment code.');
    } finally {
      setJoiningClass(false);
    }
  };

  const handleLeaveClass = async (cls: ClassRecord) => {
    setClassNotice(null);
    setError(null);
    try {
      await api.delete(`/api/student/classes/${cls.id}/leave`);
      setClassNotice(`Left ${cls.name}.`);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave class.');
    }
  };

  const handleSignOut = async () => {
    await logout();
    onNavigate('/login');
  };

  const navItems: Array<{ id: StudentTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'classes', label: 'My Classes', icon: Users },
    { id: 'upload', label: 'Upload & AI Studio', icon: Upload },
    { id: 'practice', label: 'Practice Quizzes', icon: BookOpen },
    { id: 'exams', label: 'Official Exams', icon: Clock },
    { id: 'progress', label: 'My Progress', icon: TrendingUp },
    { id: 'history', label: 'History & Results', icon: History },
  ];

  return (
    <div className="min-h-screen bg-[#F5F1E8] text-[#252525] flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="lg:w-64 lg:sticky lg:top-0 lg:h-screen bg-[#171717] text-white shrink-0 flex flex-col justify-between overflow-y-auto">
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
            <span className="text-[11px] font-medium text-[#DFC58E]">Student</span>
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

        <div className="hidden lg:block p-4 border-t border-[#303030] space-y-2">
          <div className="pb-1">
            <div className="text-sm font-semibold text-white truncate">{user?.name || 'Student'}</div>
            <div className="text-xs text-[#B5B0A6] truncate">{user?.email || 'Student Account'}</div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/profile')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[#303030] hover:bg-[#3D3D3D] text-xs font-semibold text-white transition-colors"
          >
            <UserIcon className="w-3.5 h-3.5 text-[#DFC58E]" />
            Account Profile
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-[#D6D0C4] hover:text-white hover:bg-[#303030]/60 transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            Home
          </button>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-[#E8A5A5] hover:text-white hover:bg-[#C64B4B]/25 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white border-b border-[#E3DED3] px-6 h-16 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-display font-bold text-[#252525] truncate">
              Welcome back, {user?.name || 'Student'}
            </h1>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
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
              onClick={() => onNavigate('/profile')}
              aria-label="Account profile"
              className="lg:hidden inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold text-[#252525]"
            >
              <UserIcon className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              aria-label="Logout"
              className="lg:hidden inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold text-[#C64B4B]"
            >
              <LogOut className="w-3.5 h-3.5" />
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

          {error && (
            <div className="p-4 rounded-xl bg-[#C64B4B]/10 border border-[#C64B4B]/35 text-sm text-[#982E2E]">
              {error}
            </div>
          )}

          {loading && !data ? (
            <div className="py-16 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-[#66543A] animate-spin" />
            </div>
          ) : data ? (
            <>
              {tab === 'overview' && (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">Enrolled Classes</div>
                      <div className="font-mono text-2xl font-bold text-[#252525] tabular-nums mt-1">
                        {classes.length}
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
                          No pending official exams right now. Join a class with an enrollment code or generate a practice quiz from your notes.
                        </p>
                      ) : (
                        <div className="divide-y divide-[#E3DED3]">
                          {data.availableExams.map((ex) => {
                            const expired = ex.assignmentInfo?.lifecycleStatus === 'Expired';
                            return (
                              <div
                                key={ex.id}
                                className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                              >
                                <div>
                                  <div className="text-sm font-bold text-[#252525]">{ex.title}</div>
                                  <div className="text-xs text-[#77736C] mt-0.5 tabular-nums">
                                    {ex.subject} · {ex.durationMinutes} min · {ex.totalMarks} marks ·{' '}
                                    {ex.questionCount} questions
                                    {ex.assignmentInfo?.className ? ` · Class: ${ex.assignmentInfo.className}` : ''}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={expired}
                                  onClick={() => onNavigate(`/exam/${ex.id}`)}
                                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] disabled:opacity-45 text-[#171717] text-xs font-semibold whitespace-nowrap shrink-0"
                                >
                                  <Play className="w-3.5 h-3.5" />
                                  {expired
                                    ? 'Window Closed'
                                    : ex.studentAttempt?.status === 'in_progress'
                                      ? 'Resume Exam'
                                      : 'Start Exam'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

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

                  {/* Quick Join Class + Practice Quizzes */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <form
                      onSubmit={handleJoinClass}
                      className="lg:col-span-5 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4"
                    >
                      <div className="flex items-center gap-2">
                        <GraduationCap className="w-4 h-4 text-[#66543A]" />
                        <h2 className="text-base font-display font-bold text-[#252525]">Join a Class</h2>
                      </div>
                      <p className="text-xs text-[#77736C]">
                        Enter the enrollment code shared by your teacher (e.g. EXAM-CS301A) to access class-assigned exams.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value)}
                          placeholder="EXAM-XXXXXX"
                          className="flex-1 px-3 py-2 text-xs font-mono uppercase bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none"
                        />
                        <button
                          type="submit"
                          disabled={joiningClass || !joinCode.trim()}
                          className="px-4 py-2 rounded-lg bg-[#171717] hover:bg-[#303030] disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap"
                        >
                          {joiningClass ? 'Joining...' : 'Join'}
                        </button>
                      </div>
                      {classNotice && (
                        <div className="text-xs font-medium text-[#25845D]">{classNotice}</div>
                      )}
                    </form>

                    <div className="lg:col-span-7 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
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
                        <div className="divide-y divide-[#E3DED3]">
                          {data.practiceQuizzes.slice(0, 4).map((q) => (
                            <div
                              key={q.id}
                              className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
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
                </div>
              )}

              {tab === 'classes' && (
                <div className="space-y-6">
                  <form
                    onSubmit={handleJoinClass}
                    className="bg-white border border-[#E3DED3] rounded-xl p-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <h2 className="text-lg font-display font-bold text-[#252525]">Enroll in a Class</h2>
                      <p className="text-xs text-[#77736C]">
                        Ask your instructor for their class enrollment code to receive assigned exams and track cohort progress.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 sm:min-w-[320px]">
                      <input
                        type="text"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value)}
                        placeholder="Enter class code (e.g. EXAM-CS301A)"
                        className="flex-1 px-3.5 py-2.5 text-sm font-mono uppercase bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none"
                      />
                      <button
                        type="submit"
                        disabled={joiningClass || !joinCode.trim()}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] disabled:opacity-50 text-[#171717] text-xs font-semibold whitespace-nowrap"
                      >
                        <Plus className="w-4 h-4" />
                        Join Class
                      </button>
                    </div>
                  </form>

                  {classNotice && (
                    <div className="p-3.5 rounded-xl bg-[#25845D]/10 border border-[#25845D]/30 text-xs font-medium text-[#19593E]">
                      {classNotice}
                    </div>
                  )}

                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <h2 className="text-base font-display font-bold text-[#252525]">
                      My Enrolled Classes ({classes.length})
                    </h2>
                    {classes.length === 0 ? (
                      <p className="text-sm text-[#77736C] py-6">
                        You are not enrolled in any classes yet. Join a class using an enrollment code above.
                      </p>
                    ) : (
                      <div className="divide-y divide-[#E3DED3]">
                        {classes.map((cls) => (
                          <div
                            key={cls.id}
                            className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                          >
                            <div className="space-y-1">
                              <div className="text-sm font-bold text-[#252525]">
                                {cls.name} · <span className="text-[#66543A]">{cls.subject}</span>
                              </div>
                              <div className="text-xs text-[#77736C] tabular-nums">
                                Instructor: {cls.teacherName || 'Teacher'} · Code:{' '}
                                <span className="font-mono font-semibold text-[#252525]">{cls.enrollmentCode}</span> ·{' '}
                                {cls.memberCount} students · {cls.assignedExamCount || 0} assigned exams
                              </div>
                              {cls.description && <p className="text-xs text-[#77736C]">{cls.description}</p>}
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleLeaveClass(cls)}
                              className="px-3.5 py-2 rounded-lg border border-[#E3DED3] hover:bg-[#EFEBE2] text-xs font-semibold text-[#77736C] hover:text-[#C64B4B] shrink-0"
                            >
                              Leave Class
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
                  <DocumentStudio
                    role="student"
                    onSaved={loadDashboard}
                    onStartPractice={(quizId) => onNavigate(`/practice/${quizId}?started=1`)}
                  />
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
                                {q.lastAttempt &&
                                  ` · Last Attempt: ${q.lastAttempt.score}/${q.lastAttempt.totalMarks} (${q.lastAttempt.percentage}%)`}
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
                                onClick={() => void handleDeleteQuiz(q.id)}
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
                <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                  <h2 className="text-lg font-display font-bold text-[#252525]">Official Examinations</h2>
                  {data.availableExams.length === 0 ? (
                    <p className="text-sm text-[#77736C]">No official exams currently assigned.</p>
                  ) : (
                    <div className="divide-y divide-[#E3DED3]">
                      {data.availableExams.map((ex) => {
                        const info = ex.assignmentInfo;
                        const lifecycle = info?.lifecycleStatus || 'Assigned';
                        const isExpired = lifecycle === 'Expired';
                        return (
                          <div
                            key={ex.id}
                            className="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-4"
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2.5">
                                <span className="text-base font-bold text-[#252525]">{ex.title}</span>
                                <span
                                  className={`text-[11px] font-semibold uppercase tracking-wide ${
                                    isExpired
                                      ? 'text-[#C64B4B]'
                                      : lifecycle === 'Started'
                                        ? 'text-[#B77B25]'
                                        : 'text-[#4476A8]'
                                  }`}
                                >
                                  {lifecycle}
                                </span>
                              </div>
                              <div className="text-xs text-[#77736C] tabular-nums">
                                {ex.subject} · Instructor: {ex.teacherName} · {ex.durationMinutes} min ·{' '}
                                {ex.totalMarks} total marks (Pass: {ex.passingMarks})
                                {info?.className ? ` · Class: ${info.className}` : ''}
                              </div>
                              {(info?.startTime || info?.endTime || ex.deadlineAt) && (
                                <div className="text-[11px] text-[#77736C] tabular-nums">
                                  {info?.startTime ? `Opens: ${new Date(info.startTime).toLocaleString()} · ` : ''}
                                  {info?.endTime
                                    ? `Closes: ${new Date(info.endTime).toLocaleString()}`
                                    : ex.deadlineAt
                                      ? `Deadline: ${new Date(ex.deadlineAt).toLocaleString()}`
                                      : ''}
                                </div>
                              )}
                              <p className="text-xs text-[#77736C]">{ex.instructions}</p>
                            </div>
                            <button
                              type="button"
                              disabled={isExpired}
                              onClick={() => onNavigate(`/exam/${ex.id}`)}
                              className="px-5 py-2.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] disabled:opacity-45 text-[#171717] text-xs font-semibold whitespace-nowrap shrink-0"
                            >
                              {isExpired
                                ? 'Window Closed'
                                : ex.studentAttempt?.status === 'in_progress'
                                  ? 'Resume Attempt'
                                  : 'Start Official Exam'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {tab === 'progress' && (
                <div className="space-y-6">
                  {progressLoading && !progress ? (
                    <div className="py-12 flex justify-center">
                      <Loader2 className="w-6 h-6 text-[#66543A] animate-spin" />
                    </div>
                  ) : progress ? (
                    <>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                          <div className="text-xs text-[#77736C]">Official Average</div>
                          <div className="font-mono text-2xl font-bold text-[#252525] tabular-nums mt-1">
                            {progress.averageScore !== null ? `${progress.averageScore}%` : '—'}
                          </div>
                        </div>
                        <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                          <div className="text-xs text-[#77736C]">Highest Score</div>
                          <div className="font-mono text-2xl font-bold text-[#25845D] tabular-nums mt-1">
                            {progress.highestScore !== null ? `${progress.highestScore}%` : '—'}
                          </div>
                        </div>
                        <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                          <div className="text-xs text-[#77736C]">Pass Rate</div>
                          <div className="font-mono text-2xl font-bold text-[#4476A8] tabular-nums mt-1">
                            {progress.passRate !== null ? `${progress.passRate}%` : '—'}
                          </div>
                        </div>
                        <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                          <div className="text-xs text-[#77736C]">Accuracy Split</div>
                          <div className="font-mono text-sm font-bold text-[#252525] tabular-nums mt-2">
                            {progress.totalCorrect}✓ · {progress.totalIncorrect}✕ · {progress.totalUnanswered}—
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div className="lg:col-span-6 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                          <h2 className="text-base font-display font-bold text-[#252525]">Topic Accuracy Breakdown</h2>
                          {progress.topicBreakdown.length === 0 ? (
                            <p className="text-sm text-[#77736C]">
                              Complete at least one exam or practice quiz to compute topic-level accuracy.
                            </p>
                          ) : (
                            <div className="space-y-3">
                              {progress.topicBreakdown.map((t) => (
                                <div key={`${t.subject}-${t.topic}`} className="space-y-1">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-semibold text-[#252525]">
                                      {t.topic} <span className="text-[#77736C]">({t.subject})</span>
                                    </span>
                                    <span className="font-mono tabular-nums text-[#252525]">
                                      {t.accuracyPercent}% ({t.marksEarned}/{t.marksPossible})
                                    </span>
                                  </div>
                                  <div className="h-2 bg-[#EFEBE2] rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        t.accuracyPercent >= 75
                                          ? 'bg-[#25845D]'
                                          : t.accuracyPercent >= 60
                                            ? 'bg-[#C9A45C]'
                                            : 'bg-[#C64B4B]'
                                      }`}
                                      style={{ width: `${Math.min(100, Math.max(4, t.accuracyPercent))}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="lg:col-span-6 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                          <h2 className="text-base font-display font-bold text-[#252525]">
                            Strong vs. Weak Topics &amp; Recommendations
                          </h2>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                            <div className="space-y-1.5">
                              <div className="font-bold text-[#25845D]">Strong Areas (≥75%)</div>
                              {progress.strongTopics.length === 0 ? (
                                <p className="text-[#77736C]">No strong topic threshold reached yet.</p>
                              ) : (
                                progress.strongTopics.map((st) => (
                                  <div key={st.topic} className="flex justify-between py-1 border-b border-[#E3DED3]">
                                    <span className="font-medium text-[#252525] truncate pr-2">{st.topic}</span>
                                    <span className="font-mono tabular-nums text-[#25845D]">{st.accuracyPercent}%</span>
                                  </div>
                                ))
                              )}
                            </div>
                            <div className="space-y-1.5">
                              <div className="font-bold text-[#C64B4B]">Focus Areas (&lt;65%)</div>
                              {progress.weakTopics.length === 0 ? (
                                <p className="text-[#77736C]">No weak topics flagged.</p>
                              ) : (
                                progress.weakTopics.map((wt) => (
                                  <div key={wt.topic} className="flex justify-between py-1 border-b border-[#E3DED3]">
                                    <span className="font-medium text-[#252525] truncate pr-2">{wt.topic}</span>
                                    <span className="font-mono tabular-nums text-[#C64B4B]">{wt.accuracyPercent}%</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="pt-3 border-t border-[#E3DED3] space-y-2">
                            <div className="text-xs font-bold text-[#66543A]">Actionable Next Steps</div>
                            <ul className="space-y-1.5 text-xs text-[#252525] list-disc pl-4">
                              {progress.suggestions.map((s, idx) => (
                                <li key={idx}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {tab === 'history' && (
                <div className="space-y-6">
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-5">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-[#66543A]" />
                      <h2 className="text-lg font-display font-bold text-[#252525]">Assessment Overview</h2>
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
