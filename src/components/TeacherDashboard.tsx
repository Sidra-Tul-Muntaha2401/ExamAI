import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  BookMarked,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type {
  Difficulty,
  ExamResultDetail,
  OfficialExamSummary,
  QuestionType,
  QuizQuestion,
} from '../types/index';
import { DocumentStudio } from './DocumentStudio';
import { BrandMark } from './BrandMark';

interface TeacherDashboardData {
  stats: {
    totalStudents: number;
    totalExams: number;
    pendingEvaluations: number;
    completedExams: number;
    classAverage: number | null;
    passRate: number | null;
  };
  students: Array<{ id: string; name: string; email: string; created_at: string }>;
  exams: OfficialExamSummary[];
  submissions: Array<{
    attemptId: string;
    examId: string;
    examTitle: string;
    subject: string;
    studentId: string;
    studentName: string;
    studentEmail: string;
    status: 'submitted' | 'evaluated';
    submittedAt: string | null;
    tabSwitchCount: number;
    focusLossCount: number;
    totalScore: number;
    totalMarks: number;
    percentage: number;
    passed: boolean;
  }>;
}

type TeacherTab = 'overview' | 'upload' | 'bank' | 'exams' | 'submissions';

export function TeacherDashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<TeacherTab>('overview');
  const [data, setData] = useState<TeacherDashboardData | null>(null);
  const [bankQuestions, setBankQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Exam Composer State
  const [examTitle, setExamTitle] = useState('');
  const [examSubject, setExamSubject] = useState('');
  const [examInstructions, setExamInstructions] = useState(
    'Answer all questions carefully. Progress is saved automatically.'
  );
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [passingMarks, setPassingMarks] = useState(10);
  const [deadlineAt, setDeadlineAt] = useState('');
  const [publishNow, setPublishNow] = useState(true);
  const [randomizeQuestions, setRandomizeQuestions] = useState(true);
  const [randomizeOptions, setRandomizeOptions] = useState(true);
  const [trackTabSwitches, setTrackTabSwitches] = useState(true);
  const [warnOnTabLeave, setWarnOnTabLeave] = useState(true);
  const [requireFullscreen, setRequireFullscreen] = useState(true);
  const [blockCopyPaste, setBlockCopyPaste] = useState(true);
  const [maxTabSwitches, setMaxTabSwitches] = useState(3);
  const [assignAll, setAssignAll] = useState(true);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [examQuestions, setExamQuestions] = useState<QuizQuestion[]>([]);
  const [creatingExam, setCreatingExam] = useState(false);
  const [examMsg, setExamMsg] = useState<string | null>(null);

  // Manual Question Bank Modal/Inline Form
  const [manualType, setManualType] = useState<QuestionType>('mcq');
  const [manualDiff, setManualDiff] = useState<Difficulty>('Medium');
  const [manualTopic, setManualTopic] = useState('');
  const [manualPrompt, setManualPrompt] = useState('');
  const [manualOptions, setManualOptions] = useState(['Option A', 'Option B', 'Option C', 'Option D']);
  const [manualCorrect, setManualCorrect] = useState('Option A');
  const [manualSuggested, setManualSuggested] = useState('');
  const [manualGuidance, setManualGuidance] = useState('');
  const [manualMarks, setManualMarks] = useState(2);

  // Evaluation Drawer State
  const [evaluatingAttemptId, setEvaluatingAttemptId] = useState<string | null>(null);
  const [evaluationDetail, setEvaluationDetail] = useState<ExamResultDetail | null>(null);
  const [evalInputs, setEvalInputs] = useState<Record<string, { marks: number; feedback: string }>>({});
  const [savingEval, setSavingEval] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, bank] = await Promise.all([
        api.get<TeacherDashboardData>('/api/teacher/dashboard'),
        api.get<{ questions: QuizQuestion[] }>('/api/teacher/question-bank'),
      ]);
      setData(dash);
      setBankQuestions(bank.questions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load teacher dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleLogout = async () => {
    await logout();
    onNavigate('/');
  };

  const handleAddManualBankQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (manualPrompt.trim().length < 5) return;
    try {
      await api.post('/api/teacher/question-bank', {
        questions: [
          {
            questionType: manualType,
            difficulty: manualDiff,
            topic: manualTopic || 'General',
            prompt: manualPrompt,
            options: manualType === 'mcq' ? manualOptions : manualType === 'true_false' ? ['True', 'False'] : [],
            correctAnswer:
              manualType === 'mcq' ? manualCorrect : manualType === 'true_false' ? manualCorrect : '',
            suggestedAnswer: manualSuggested,
            markingGuidance: manualGuidance,
            marks: manualMarks,
          },
        ],
      });
      setManualPrompt('');
      setManualSuggested('');
      setManualGuidance('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save question.');
    }
  };

  const handleDeleteBankQuestion = async (id: string) => {
    try {
      await api.delete(`/api/teacher/question-bank/${id}`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete question.');
    }
  };

  const toggleBankQuestionInExam = (q: QuizQuestion) => {
    setExamQuestions((prev) => {
      const exists = prev.some((item) => item.id === q.id);
      if (exists) return prev.filter((item) => item.id !== q.id);
      return [...prev, q];
    });
  };

  const addQuickManualExamQuestion = () => {
    const q: QuizQuestion = {
      id: `exam_manual_${Date.now()}`,
      questionType: 'short_answer',
      difficulty: 'Medium',
      topic: examSubject || 'General',
      prompt: 'Explain the primary trade-off discussed in this unit.',
      options: [],
      suggestedAnswer: 'Identify key concepts and explain one concrete trade-off.',
      markingGuidance: 'Award 2 marks for concept accuracy and 3 marks for trade-off analysis.',
      marks: 5,
    };
    setExamQuestions((prev) => [...prev, q]);
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setExamMsg(null);
    setError(null);
    setCreatingExam(true);
    try {
      await api.post('/api/teacher/exams', {
        title: examTitle,
        subject: examSubject,
        instructions: examInstructions,
        durationMinutes,
        passingMarks,
        deadlineAt: deadlineAt ? new Date(deadlineAt).toISOString() : null,
        publishNow,
        randomizeQuestions,
        randomizeOptions,
        trackTabSwitches,
        warnOnTabLeave,
        requireFullscreen,
        blockCopyPaste,
        maxTabSwitches,
        assignAll,
        assignedStudentIds: selectedStudentIds,
        questions: examQuestions,
      });
      setExamTitle('');
      setExamSubject('');
      setExamQuestions([]);
      setExamMsg('Official examination created successfully.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create exam.');
    } finally {
      setCreatingExam(false);
    }
  };

  const handleTogglePublish = async (exam: OfficialExamSummary) => {
    try {
      await api.post(`/api/teacher/exams/${exam.id}/publish`, {
        status: exam.status === 'published' ? 'draft' : 'published',
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update exam status.');
    }
  };

  const handleDeleteExam = async (examId: string) => {
    try {
      await api.delete(`/api/teacher/exams/${examId}`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete exam.');
    }
  };

  const openEvaluation = async (attemptId: string) => {
    setEvaluatingAttemptId(attemptId);
    setEvaluationDetail(null);
    try {
      const res = await api.get<{ result: ExamResultDetail }>(`/api/results/${attemptId}`);
      setEvaluationDetail(res.result);
      const initial: Record<string, { marks: number; feedback: string }> = {};
      for (const q of res.result.questions) {
        if (q.questionType === 'short_answer' || q.questionType === 'long_answer') {
          initial[q.questionId] = {
            marks: q.marksAwarded ?? 0,
            feedback: q.teacherFeedback ?? '',
          };
        }
      }
      setEvalInputs(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load submission.');
      setEvaluatingAttemptId(null);
    }
  };

  const handleSaveEvaluation = async () => {
    if (!evaluatingAttemptId) return;
    setSavingEval(true);
    try {
      const evaluations = Object.entries(evalInputs).map(([questionId, val]) => ({
        questionId,
        marksAwarded: val.marks,
        feedback: val.feedback,
      }));
      await api.post(`/api/teacher/attempts/${evaluatingAttemptId}/evaluate`, { evaluations });
      setEvaluatingAttemptId(null);
      setEvaluationDetail(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save evaluation.');
    } finally {
      setSavingEval(false);
    }
  };

  const navItems: Array<{ id: TeacherTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'upload', label: 'Upload & AI Studio', icon: Upload },
    { id: 'bank', label: 'Question Bank', icon: BookMarked },
    { id: 'exams', label: 'Create & Manage Exams', icon: FilePlus2 },
    { id: 'submissions', label: 'Submissions & Grading', icon: ClipboardCheck },
  ];

  const totalExamMarks = examQuestions.reduce((acc, q) => acc + (Number(q.marks) || 2), 0);

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
            <span className="text-[11px] font-medium text-[#DFC58E]">Teaching Mode</span>
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
          <h1 className="text-lg font-display font-bold text-[#252525] truncate">
            Instructor Studio · {user?.name}
          </h1>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setTab('exams')}
              className="px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold transition-colors whitespace-nowrap"
            >
              Create Official Exam
            </button>
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
          {error && (
            <div className="flex items-start gap-2.5 p-4 rounded-xl bg-[#C64B4B]/10 border border-[#C64B4B]/35 text-sm text-[#982E2E]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#C64B4B]" />
              <span>{error}</span>
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
                      <div className="text-xs font-medium text-[#77736C]">Total Students</div>
                      <div className="font-mono text-2xl font-bold text-[#252525] tabular-nums mt-1">
                        {data.stats.totalStudents}
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">Total Exams</div>
                      <div className="font-mono text-2xl font-bold text-[#4476A8] tabular-nums mt-1">
                        {data.stats.totalExams}
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">Pending Evaluations</div>
                      <div className="font-mono text-2xl font-bold text-[#B77B25] tabular-nums mt-1">
                        {data.stats.pendingEvaluations}
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">Completed Evaluations</div>
                      <div className="font-mono text-2xl font-bold text-[#25845D] tabular-nums mt-1">
                        {data.stats.completedExams}
                      </div>
                    </div>
                  </div>

                  {/* Performance Analytics + Pending Queue */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-5 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-[#66543A]" />
                        <h2 className="text-base font-display font-bold text-[#252525]">Class Performance Analytics</h2>
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-[#E3DED3] border-y border-[#E3DED3] py-4">
                        <div className="pr-4">
                          <div className="text-xs text-[#77736C]">Class Average</div>
                          <div className="font-mono text-2xl font-bold text-[#252525] tabular-nums mt-1">
                            {data.stats.classAverage !== null ? `${data.stats.classAverage}%` : '—'}
                          </div>
                        </div>
                        <div className="pl-4">
                          <div className="text-xs text-[#77736C]">Pass Rate</div>
                          <div className="font-mono text-2xl font-bold text-[#4476A8] tabular-nums mt-1">
                            {data.stats.passRate !== null ? `${data.stats.passRate}%` : '—'}
                          </div>
                        </div>
                      </div>
                      <div className="pt-2 space-y-2 text-xs text-[#77736C]">
                        <div className="font-semibold text-[#252525]">Registered Students ({data.students.length})</div>
                        {data.students.map((st) => (
                          <div key={st.id} className="flex items-center justify-between py-1 border-b border-[#E3DED3] last:border-0">
                            <span className="font-medium text-[#252525]">{st.name}</span>
                            <span className="text-[#77736C]">{st.email}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="lg:col-span-7 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-display font-bold text-[#252525]">Student Submissions Queue</h2>
                        <button
                          type="button"
                          onClick={() => setTab('submissions')}
                          className="text-xs font-semibold text-[#66543A] hover:underline"
                        >
                          Manage all
                        </button>
                      </div>

                      {data.submissions.length === 0 ? (
                        <p className="text-sm text-[#77736C]">No student submissions yet.</p>
                      ) : (
                        <div className="divide-y divide-[#E3DED3]">
                          {data.submissions.slice(0, 6).map((sub) => (
                            <div
                              key={sub.attemptId}
                              className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                            >
                              <div>
                                <div className="text-sm font-bold text-[#252525]">
                                  {sub.studentName} · {sub.examTitle}
                                </div>
                                <div className="text-xs text-[#77736C] tabular-nums">
                                  {sub.status === 'submitted'
                                    ? 'Needs descriptive grading'
                                    : `Evaluated: ${sub.totalScore}/${sub.totalMarks} (${sub.percentage}%)`}{' '}
                                  · Tab switches: {sub.tabSwitchCount}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => openEvaluation(sub.attemptId)}
                                className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                                  sub.status === 'submitted'
                                    ? 'bg-[#C9A45C] text-[#171717] hover:bg-[#DFC58E]'
                                    : 'border border-[#E3DED3] text-[#252525] hover:bg-[#EFEBE2]'
                                }`}
                              >
                                {sub.status === 'submitted' ? 'Evaluate Answers' : 'Review Evaluation'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'upload' && <DocumentStudio role="teacher" onSaved={loadAll} />}

              {tab === 'bank' && (
                <div className="space-y-6">
                  <form
                    onSubmit={handleAddManualBankQuestion}
                    className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4"
                  >
                    <h2 className="text-lg font-display font-bold text-[#252525]">Add Question to Bank</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-semibold mb-1">Type</label>
                        <select
                          value={manualType}
                          onChange={(e) => setManualType(e.target.value as QuestionType)}
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg"
                        >
                          <option value="mcq">MCQ</option>
                          <option value="true_false">True / False</option>
                          <option value="short_answer">Short Answer</option>
                          <option value="long_answer">Long Answer</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">Difficulty</label>
                        <select
                          value={manualDiff}
                          onChange={(e) => setManualDiff(e.target.value as Difficulty)}
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg"
                        >
                          <option value="Easy">Easy</option>
                          <option value="Medium">Medium</option>
                          <option value="Hard">Hard</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">Topic</label>
                        <input
                          type="text"
                          value={manualTopic}
                          onChange={(e) => setManualTopic(e.target.value)}
                          placeholder="e.g., SQL Joins"
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">Marks</label>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={manualMarks}
                          onChange={(e) => setManualMarks(Math.max(1, Number(e.target.value) || 1))}
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg tabular-nums"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold mb-1">Question Prompt</label>
                      <textarea
                        rows={2}
                        required
                        value={manualPrompt}
                        onChange={(e) => setManualPrompt(e.target.value)}
                        placeholder="Write your question prompt..."
                        className="w-full px-3.5 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg"
                      />
                    </div>

                    {manualType === 'mcq' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {manualOptions.map((opt, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="manual-correct"
                              checked={manualCorrect === opt}
                              onChange={() => setManualCorrect(opt)}
                              aria-label={`Set option ${idx + 1} as correct`}
                              className="accent-[#66543A]"
                            />
                            <input
                              type="text"
                              value={opt}
                              onChange={(e) => {
                                const val = e.target.value;
                                setManualOptions((prev) => prev.map((o, oi) => (oi === idx ? val : o)));
                                if (manualCorrect === opt) setManualCorrect(val);
                              }}
                              className="flex-1 px-3 py-1.5 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {manualType === 'true_false' && (
                      <div className="flex items-center gap-4 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="tf-correct"
                            checked={manualCorrect === 'True'}
                            onChange={() => setManualCorrect('True')}
                            className="accent-[#66543A]"
                          />
                          True
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="tf-correct"
                            checked={manualCorrect === 'False'}
                            onChange={() => setManualCorrect('False')}
                            className="accent-[#66543A]"
                          />
                          False
                        </label>
                      </div>
                    )}

                    {(manualType === 'short_answer' || manualType === 'long_answer') && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <textarea
                          rows={2}
                          value={manualSuggested}
                          onChange={(e) => setManualSuggested(e.target.value)}
                          placeholder="Suggested model answer..."
                          className="w-full px-3.5 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg"
                        />
                        <textarea
                          rows={2}
                          value={manualGuidance}
                          onChange={(e) => setManualGuidance(e.target.value)}
                          placeholder="Marking guidance / rubric..."
                          className="w-full px-3.5 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg"
                        />
                      </div>
                    )}

                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#171717] hover:bg-[#303030] text-white text-xs font-semibold"
                    >
                      <Plus className="w-4 h-4" />
                      Save to Question Bank
                    </button>
                  </form>

                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <h2 className="text-lg font-display font-bold text-[#252525]">
                      Saved Question Bank ({bankQuestions.length})
                    </h2>
                    <div className="divide-y divide-[#E3DED3]">
                      {bankQuestions.map((q) => (
                        <div key={q.id} className="py-4 flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="text-xs font-mono text-[#77736C]">
                              {q.questionType.replace('_', ' ').toUpperCase()} · {q.difficulty} · {q.topic} ·{' '}
                              {q.marks} marks
                            </div>
                            <p className="text-sm font-semibold text-[#252525]">{q.prompt}</p>
                            {q.correctAnswer && (
                              <p className="text-xs text-[#25845D]">Answer: {q.correctAnswer}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteBankQuestion(q.id)}
                            aria-label={`Delete question ${q.prompt.slice(0, 24)}`}
                            className="p-2 text-[#77736C] hover:text-[#C64B4B]"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'exams' && (
                <div className="space-y-8">
                  <form
                    onSubmit={handleCreateExam}
                    className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-6"
                  >
                    <div>
                      <h2 className="text-lg font-display font-bold text-[#252525]">Create Official Examination</h2>
                      <p className="text-sm text-[#77736C]">
                        Configure exam rules, anti-cheating toggles, student assignments, and select questions from your Question Bank.
                      </p>
                    </div>

                    {examMsg && (
                      <div className="flex items-center gap-2 p-3.5 rounded-lg bg-[#25845D]/10 border border-[#25845D]/30 text-sm text-[#19593E]">
                        <CheckCircle2 className="w-4 h-4 text-[#25845D]" />
                        <span>{examMsg}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="ex-title" className="block text-xs font-semibold text-[#252525] mb-1">
                          Exam Title
                        </label>
                        <input
                          id="ex-title"
                          type="text"
                          required
                          value={examTitle}
                          onChange={(e) => setExamTitle(e.target.value)}
                          placeholder="e.g., Final Assessment: SQL Transactions"
                          className="w-full px-3.5 py-2.5 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg text-[#252525] focus:bg-white focus:border-[#66543A] outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="ex-subject" className="block text-xs font-semibold text-[#252525] mb-1">
                          Course / Subject
                        </label>
                        <input
                          id="ex-subject"
                          type="text"
                          required
                          value={examSubject}
                          onChange={(e) => setExamSubject(e.target.value)}
                          placeholder="e.g., CS 301 · Database Systems"
                          className="w-full px-3.5 py-2.5 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg text-[#252525] focus:bg-white focus:border-[#66543A] outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="ex-inst" className="block text-xs font-semibold text-[#252525] mb-1">
                        Exam Instructions
                      </label>
                      <textarea
                        id="ex-inst"
                        rows={2}
                        value={examInstructions}
                        onChange={(e) => setExamInstructions(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg text-[#252525] focus:bg-white focus:border-[#66543A] outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label htmlFor="ex-dur" className="block text-xs font-semibold text-[#252525] mb-1">
                          Duration (minutes)
                        </label>
                        <input
                          id="ex-dur"
                          type="number"
                          min={1}
                          max={360}
                          value={durationMinutes}
                          onChange={(e) => setDurationMinutes(Math.max(1, Number(e.target.value) || 30))}
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg text-[#252525] tabular-nums focus:bg-white focus:border-[#66543A] outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="ex-pass" className="block text-xs font-semibold text-[#252525] mb-1">
                          Passing Marks (Total: {totalExamMarks})
                        </label>
                        <input
                          id="ex-pass"
                          type="number"
                          min={0}
                          max={Math.max(1, totalExamMarks)}
                          value={passingMarks}
                          onChange={(e) => setPassingMarks(Math.max(0, Number(e.target.value) || 0))}
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg text-[#252525] tabular-nums focus:bg-white focus:border-[#66543A] outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="ex-deadline" className="block text-xs font-semibold text-[#252525] mb-1">
                          Submission Deadline (optional)
                        </label>
                        <input
                          id="ex-deadline"
                          type="datetime-local"
                          value={deadlineAt}
                          onChange={(e) => setDeadlineAt(e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg text-[#252525] focus:bg-white focus:border-[#66543A] outline-none"
                        />
                      </div>
                    </div>

                    {/* Configurable Integrity & Assignment Options */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 rounded-xl bg-[#EFEBE2]/65 border border-[#E3DED3]">
                      <div className="space-y-2.5 text-xs text-[#252525]">
                        <div className="font-bold text-[#252525]">Integrity &amp; Delivery Settings</div>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={randomizeQuestions}
                            onChange={(e) => setRandomizeQuestions(e.target.checked)}
                            className="accent-[#66543A]"
                          />
                          Randomize question order per student attempt
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={randomizeOptions}
                            onChange={(e) => setRandomizeOptions(e.target.checked)}
                            className="accent-[#66543A]"
                          />
                          Randomize MCQ option order
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={trackTabSwitches}
                            onChange={(e) => setTrackTabSwitches(e.target.checked)}
                            className="accent-[#66543A]"
                          />
                          Record tab-visibility &amp; window-focus changes
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={warnOnTabLeave}
                            onChange={(e) => setWarnOnTabLeave(e.target.checked)}
                            className="accent-[#66543A]"
                          />
                          Show student warning banner on tab leave
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={requireFullscreen}
                            onChange={(e) => setRequireFullscreen(e.target.checked)}
                            className="accent-[#66543A]"
                          />
                          Require fullscreen mode &amp; conceal questions on exit
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={blockCopyPaste}
                            onChange={(e) => setBlockCopyPaste(e.target.checked)}
                            className="accent-[#66543A]"
                          />
                          Block copy, paste, right-click &amp; browser shortcuts
                        </label>
                        <div className="pt-1 flex items-center justify-between gap-3">
                          <label htmlFor="ex-max-switches" className="font-medium text-[#252525]">
                            Auto-submit violation limit (0 = warn only)
                          </label>
                          <input
                            id="ex-max-switches"
                            type="number"
                            min={0}
                            max={10}
                            value={maxTabSwitches}
                            onChange={(e) =>
                              setMaxTabSwitches(Math.min(10, Math.max(0, Number(e.target.value) || 0)))
                            }
                            className="w-20 px-2.5 py-1.5 text-xs bg-white border border-[#E3DED3] rounded-lg tabular-nums text-[#252525]"
                          />
                        </div>
                      </div>

                      <div className="space-y-2.5 text-xs text-[#252525]">
                        <div className="font-bold text-[#252525]">Student Assignment &amp; Publishing</div>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={publishNow}
                            onChange={(e) => setPublishNow(e.target.checked)}
                            className="accent-[#66543A]"
                          />
                          Publish immediately upon creation
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={assignAll}
                            onChange={(e) => setAssignAll(e.target.checked)}
                            className="accent-[#66543A]"
                          />
                          Assign to all registered students
                        </label>
                        {!assignAll && (
                          <div className="pl-5 space-y-1.5 max-h-28 overflow-y-auto">
                            {data.students.map((s) => (
                              <label key={s.id} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={selectedStudentIds.includes(s.id)}
                                  onChange={(e) =>
                                    setSelectedStudentIds((prev) =>
                                      e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                                    )
                                  }
                                  className="accent-[#66543A]"
                                />
                                <span>{s.name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Select from Question Bank */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#252525]">
                          Select Questions ({examQuestions.length} selected · {totalExamMarks} marks)
                        </span>
                        <button
                          type="button"
                          onClick={addQuickManualExamQuestion}
                          className="text-xs font-semibold text-[#4476A8] hover:underline"
                        >
                          + Append Quick Short-Answer Question
                        </button>
                      </div>
                      <div className="max-h-64 overflow-y-auto border border-[#E3DED3] rounded-xl divide-y divide-[#E3DED3]">
                        {bankQuestions.map((q) => {
                          const checked = examQuestions.some((eq) => eq.id === q.id);
                          return (
                            <label
                              key={q.id}
                              className="p-3.5 flex items-start gap-3 cursor-pointer hover:bg-[#F5F1E8]/60"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleBankQuestionInExam(q)}
                                className="mt-1 accent-[#66543A]"
                              />
                              <div className="text-xs space-y-0.5">
                                <div className="font-semibold text-[#252525]">{q.prompt}</div>
                                <div className="text-[#77736C]">
                                  {q.questionType.replace('_', ' ').toUpperCase()} · {q.difficulty} · {q.marks} marks
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={creatingExam || examQuestions.length === 0}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] disabled:opacity-50 text-[#171717] text-sm font-semibold transition-colors"
                    >
                      {creatingExam && <Loader2 className="w-4 h-4 animate-spin" />}
                      Create Official Exam
                    </button>
                  </form>

                  {/* Manage Existing Exams */}
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <h2 className="text-lg font-display font-bold text-[#252525]">
                      Manage Existing Exams ({data.exams.length})
                    </h2>
                    <div className="divide-y divide-[#E3DED3]">
                      {data.exams.map((ex) => (
                        <div
                          key={ex.id}
                          className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                        >
                          <div>
                            <div className="text-sm font-bold text-[#252525]">{ex.title}</div>
                            <div className="text-xs text-[#77736C] tabular-nums mt-0.5">
                              {ex.subject} · {ex.status.toUpperCase()} · {ex.questionCount} questions ·{' '}
                              {ex.submissionCount} submissions ({ex.pendingEvaluationCount} pending) ·{' '}
                              {ex.requireFullscreen ? 'Fullscreen' : 'Windowed'} ·{' '}
                              {ex.maxTabSwitches > 0 ? `Auto-submit at ${ex.maxTabSwitches} leaves` : 'Warn only'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleTogglePublish(ex)}
                              className="px-3.5 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold text-[#252525] hover:bg-[#EFEBE2]"
                            >
                              {ex.status === 'published' ? 'Unpublish' : 'Publish'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteExam(ex.id)}
                              aria-label={`Delete exam ${ex.title}`}
                              className="p-2 rounded-lg border border-[#E3DED3] text-[#77736C] hover:text-[#C64B4B]"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'submissions' && (
                <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-[#66543A]" />
                    <h2 className="text-lg font-display font-bold text-[#252525]">
                      Student Submissions &amp; Descriptive Grading
                    </h2>
                  </div>

                  {data.submissions.length === 0 ? (
                    <p className="text-sm text-[#77736C]">No submissions received yet.</p>
                  ) : (
                    <div className="divide-y divide-[#E3DED3]">
                      {data.submissions.map((sub) => (
                        <div
                          key={sub.attemptId}
                          className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                        >
                          <div>
                            <div className="text-sm font-bold text-[#252525]">
                              {sub.studentName} ({sub.studentEmail})
                            </div>
                            <div className="text-xs text-[#77736C] mt-0.5 tabular-nums">
                              {sub.examTitle} · Submitted{' '}
                              {sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : '—'} · Tab leaves:{' '}
                              {sub.tabSwitchCount}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-mono text-xs font-bold text-[#252525] tabular-nums">
                              {sub.totalScore}/{sub.totalMarks} ({sub.percentage}%)
                            </span>
                            <button
                              type="button"
                              onClick={() => openEvaluation(sub.attemptId)}
                              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                                sub.status === 'submitted'
                                  ? 'bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717]'
                                  : 'bg-[#171717] hover:bg-[#303030] text-white'
                              }`}
                            >
                              {sub.status === 'submitted' ? 'Evaluate' : 'Edit Evaluation'}
                            </button>
                            <button
                              type="button"
                              onClick={() => onNavigate(`/results/${sub.attemptId}`)}
                              className="px-3.5 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold text-[#252525] hover:bg-[#EFEBE2]"
                            >
                              Full Report
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>

      {/* Descriptive Answer Evaluation Modal */}
      {evaluatingAttemptId && (
        <div className="fixed inset-0 z-40 bg-[#171717]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED3] rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 lg:p-8 space-y-6">
            {!evaluationDetail ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-7 h-7 text-[#66543A] animate-spin" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4 border-b border-[#E3DED3] pb-4">
                  <div>
                    <h3 className="text-lg font-display font-bold text-[#252525]">
                      Evaluate Submission — {evaluationDetail.studentName}
                    </h3>
                    <p className="text-xs text-[#77736C] tabular-nums mt-0.5">
                      {evaluationDetail.examTitle} · Objective Score: {evaluationDetail.objectiveScore} · Tab Leaves:{' '}
                      {evaluationDetail.tabSwitchCount}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEvaluatingAttemptId(null)}
                    className="text-xs font-semibold text-[#77736C] hover:text-[#252525]"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-5">
                  {evaluationDetail.questions
                    .filter((q) => q.questionType === 'short_answer' || q.questionType === 'long_answer')
                    .map((q, idx) => {
                      const entry = evalInputs[q.questionId] || { marks: 0, feedback: '' };
                      return (
                        <div key={q.questionId} className="p-5 rounded-xl bg-[#EFEBE2]/65 border border-[#E3DED3] space-y-3">
                          <div className="text-xs font-mono font-semibold text-[#66543A]">
                            Descriptive Item {idx + 1} · Max {q.marks} marks
                          </div>
                          <p className="text-sm font-bold text-[#252525]">{q.prompt}</p>
                          <div className="p-3 rounded-lg bg-white border border-[#E3DED3] text-sm text-[#252525] whitespace-pre-wrap">
                            {q.studentAnswer || 'No response submitted.'}
                          </div>
                          {q.markingGuidance && (
                            <p className="text-xs text-[#77736C]">
                              <strong className="text-[#252525]">Rubric Guidance:</strong> {q.markingGuidance}
                            </p>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                            <div className="sm:col-span-3">
                              <label className="block text-xs font-semibold text-[#252525] mb-1">
                                Marks (0–{q.marks})
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={q.marks}
                                step={0.5}
                                value={entry.marks}
                                onChange={(e) =>
                                  setEvalInputs((prev) => ({
                                    ...prev,
                                    [q.questionId]: {
                                      ...entry,
                                      marks: Math.min(q.marks, Math.max(0, Number(e.target.value) || 0)),
                                    },
                                  }))
                                }
                                className="w-full px-3 py-2 text-sm bg-white border border-[#E3DED3] rounded-lg tabular-nums text-[#252525]"
                              />
                            </div>
                            <div className="sm:col-span-9">
                              <label className="block text-xs font-semibold text-[#252525] mb-1">Teacher Feedback</label>
                              <input
                                type="text"
                                value={entry.feedback}
                                onChange={(e) =>
                                  setEvalInputs((prev) => ({
                                    ...prev,
                                    [q.questionId]: { ...entry, feedback: e.target.value },
                                  }))
                                }
                                placeholder="Constructive feedback for the student..."
                                className="w-full px-3 py-2 text-sm bg-white border border-[#E3DED3] rounded-lg text-[#252525]"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}

                  {evaluationDetail.questions.every(
                    (q) => q.questionType === 'mcq' || q.questionType === 'true_false'
                  ) && (
                    <p className="text-sm text-[#77736C]">
                      This exam contains only objective questions that were automatically graded.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E3DED3]">
                  <button
                    type="button"
                    onClick={() => setEvaluatingAttemptId(null)}
                    className="px-4 py-2 rounded-lg border border-[#E3DED3] text-sm font-semibold text-[#77736C] hover:text-[#252525]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingEval}
                    onClick={handleSaveEvaluation}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors"
                  >
                    {savingEval && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save Final Evaluation
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
