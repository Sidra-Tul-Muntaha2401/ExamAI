import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  BookMarked,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  FilePlus2,
  GraduationCap,
  Home,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type {
  ClassMemberRecord,
  ClassRecord,
  Difficulty,
  ExamResultDetail,
  OfficialExamSummary,
  QuestionType,
  QuizQuestion,
} from '../types/index';
import { DocumentStudio } from './DocumentStudio';
import { BrandMark } from './BrandMark';

interface TeacherStudentRow {
  id: string;
  name: string;
  email: string;
  institution?: string;
  created_at: string;
  classNames?: string[];
  completedExamsCount?: number;
  avgPercentage?: number | null;
}

interface TeacherDashboardData {
  stats: {
    totalStudents: number;
    totalClasses?: number;
    totalExams: number;
    pendingEvaluations: number;
    completedExams: number;
    classAverage: number | null;
    passRate: number | null;
  };
  students: TeacherStudentRow[];
  classes: ClassRecord[];
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

interface TeacherAnalyticsPayload {
  selectedClass: ClassRecord | null;
  classes: ClassRecord[];
  analytics: {
    classAverage: number | null;
    highestScore: number | null;
    lowestScore: number | null;
    completionRate: number | null;
    evaluatedCount: number;
    distribution: Array<{ label: string; count: number }>;
    ranking: Array<{
      studentId: string;
      studentName: string;
      studentEmail: string;
      attemptsCount: number;
      averagePercentage: number | null;
    }>;
    studentsNeedingSupport: Array<{
      studentId: string;
      studentName: string;
      studentEmail: string;
      attemptsCount: number;
      averagePercentage: number | null;
    }>;
  };
}

type TeacherTab = 'overview' | 'classes' | 'students' | 'upload' | 'bank' | 'exams' | 'submissions' | 'analytics';

export function TeacherDashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, logout, refreshUser } = useAuth();
  const approvalStatus = user?.teacherProfile?.approvalStatus || 'approved';
  const isApproved = approvalStatus === 'approved';

  const [tab, setTab] = useState<TeacherTab>('overview');
  const [data, setData] = useState<TeacherDashboardData | null>(null);
  const [bankQuestions, setBankQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Classes state
  const [className, setClassName] = useState('');
  const [classSubject, setClassSubject] = useState('');
  const [classDescription, setClassDescription] = useState('');
  const [creatingClass, setCreatingClass] = useState(false);
  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [classRoster, setClassRoster] = useState<ClassMemberRecord[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [addStudentEmail, setAddStudentEmail] = useState('');

  // Analytics state
  const [analyticsClassId, setAnalyticsClassId] = useState('');
  const [analyticsData, setAnalyticsData] = useState<TeacherAnalyticsPayload | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Exam Composer State
  const [examTitle, setExamTitle] = useState('');
  const [examSubject, setExamSubject] = useState('');
  const [examInstructions, setExamInstructions] = useState(
    'Answer all questions carefully. Progress is saved automatically.'
  );
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [passingMarks, setPassingMarks] = useState(10);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [deadlineAt, setDeadlineAt] = useState('');
  const [attemptLimit, setAttemptLimit] = useState(1);
  const [publishNow, setPublishNow] = useState(true);
  const [randomizeQuestions, setRandomizeQuestions] = useState(true);
  const [randomizeOptions, setRandomizeOptions] = useState(true);
  const [trackTabSwitches, setTrackTabSwitches] = useState(true);
  const [warnOnTabLeave, setWarnOnTabLeave] = useState(true);
  const [requireFullscreen, setRequireFullscreen] = useState(true);
  const [blockCopyPaste, setBlockCopyPaste] = useState(true);
  const [maxTabSwitches, setMaxTabSwitches] = useState(3);
  const [assignAll, setAssignAll] = useState(true);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [examQuestions, setExamQuestions] = useState<QuizQuestion[]>([]);
  const [creatingExam, setCreatingExam] = useState(false);
  const [examMsg, setExamMsg] = useState<string | null>(null);

  // Assign modal for existing exams
  const [assigningExam, setAssigningExam] = useState<OfficialExamSummary | null>(null);
  const [modalAssignAll, setModalAssignAll] = useState(false);
  const [modalClassIds, setModalClassIds] = useState<string[]>([]);
  const [modalStudentIds, setModalStudentIds] = useState<string[]>([]);
  const [modalStartTime, setModalStartTime] = useState('');
  const [modalEndTime, setModalEndTime] = useState('');
  const [savingAssign, setSavingAssign] = useState(false);

  // Manual Question Bank Form
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
    if (!isApproved) {
      setLoading(false);
      return;
    }
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
  }, [isApproved]);

  const loadAnalytics = useCallback(
    async (clsId: string) => {
      if (!isApproved) return;
      setAnalyticsLoading(true);
      try {
        const query = clsId ? `?classId=${encodeURIComponent(clsId)}` : '';
        const res = await api.get<TeacherAnalyticsPayload>(`/api/teacher/analytics${query}`);
        setAnalyticsData(res);
      } catch {
        // Ignore transient analytics error
      } finally {
        setAnalyticsLoading(false);
      }
    },
    [isApproved]
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (tab === 'analytics') {
      void loadAnalytics(analyticsClassId);
    }
  }, [tab, analyticsClassId, loadAnalytics]);

  const loadClassRoster = async (clsId: string) => {
    setActiveClassId(clsId);
    setRosterLoading(true);
    try {
      const res = await api.get<{ classRecord: ClassRecord; members: ClassMemberRecord[] }>(
        `/api/teacher/classes/${clsId}/members`
      );
      setClassRoster(res.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load class roster.');
    } finally {
      setRosterLoading(false);
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingClass(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ classRecord: ClassRecord }>('/api/teacher/classes', {
        name: className.trim(),
        subject: classSubject.trim(),
        description: classDescription.trim(),
      });
      setClassName('');
      setClassSubject('');
      setClassDescription('');
      setNotice(`Created class "${res.classRecord.name}" with enrollment code ${res.classRecord.enrollmentCode}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create class.');
    } finally {
      setCreatingClass(false);
    }
  };

  const handleToggleClassArchive = async (cls: ClassRecord) => {
    try {
      await api.patch(`/api/teacher/classes/${cls.id}`, {
        status: cls.status === 'active' ? 'archived' : 'active',
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update class status.');
    }
  };

  const handleRegenerateCode = async (cls: ClassRecord) => {
    try {
      await api.patch(`/api/teacher/classes/${cls.id}`, { regenerateCode: true });
      setNotice(`Enrollment code regenerated for ${cls.name}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to regenerate code.');
    }
  };

  const handleAddStudentToClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClassId || !addStudentEmail.trim()) return;
    setError(null);
    setNotice(null);
    try {
      await api.post(`/api/teacher/classes/${activeClassId}/members`, {
        identifier: addStudentEmail.trim(),
      });
      setAddStudentEmail('');
      setNotice('Student added to class roster.');
      await loadClassRoster(activeClassId);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add student.');
    }
  };

  const handleRemoveStudentFromClass = async (studentId: string) => {
    if (!activeClassId) return;
    try {
      await api.delete(`/api/teacher/classes/${activeClassId}/members/${studentId}`);
      await loadClassRoster(activeClassId);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove student.');
    }
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
        startTime: startTime ? new Date(startTime).toISOString() : null,
        endTime: endTime ? new Date(endTime).toISOString() : null,
        attemptLimit,
        publishNow,
        randomizeQuestions,
        randomizeOptions,
        trackTabSwitches,
        warnOnTabLeave,
        requireFullscreen,
        blockCopyPaste,
        maxTabSwitches,
        assignAll,
        assignedClassIds: assignAll ? [] : selectedClassIds,
        assignedStudentIds: assignAll ? [] : selectedStudentIds,
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

  const openAssignModal = (ex: OfficialExamSummary) => {
    setAssigningExam(ex);
    setModalAssignAll(ex.assignAll);
    setModalClassIds([]);
    setModalStudentIds([]);
    setModalStartTime('');
    setModalEndTime('');
  };

  const handleSaveAssignments = async () => {
    if (!assigningExam) return;
    setSavingAssign(true);
    setError(null);
    try {
      await api.post(`/api/teacher/exams/${assigningExam.id}/assign`, {
        assignAll: modalAssignAll,
        classIds: modalAssignAll ? [] : modalClassIds,
        studentIds: modalAssignAll ? [] : modalStudentIds,
        startTime: modalStartTime ? new Date(modalStartTime).toISOString() : null,
        endTime: modalEndTime ? new Date(modalEndTime).toISOString() : null,
      });
      setNotice(`Updated assignments for "${assigningExam.title}".`);
      setAssigningExam(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update exam assignments.');
    } finally {
      setSavingAssign(false);
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

  const handleSignOut = async () => {
    await logout();
    onNavigate('/login');
  };

  // Pending / Rejected Verification Gate
  if (!isApproved) {
    const rejected = approvalStatus === 'rejected';
    return (
      <div className="min-h-screen bg-[#F5F1E8] text-[#252525] flex flex-col">
        <header className="bg-white border-b border-[#E3DED3] px-6 h-16 flex items-center justify-between">
          <button type="button" onClick={() => onNavigate('/')}>
            <BrandMark variant="light" />
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/profile')}
              className="px-3.5 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold"
            >
              Edit Profile
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="px-3.5 py-2 rounded-lg bg-[#171717] text-white text-xs font-semibold"
            >
              Logout
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#E3DED3] rounded-2xl p-8 text-center space-y-5">
            <div className="w-12 h-12 rounded-xl bg-[#EFEBE2] text-[#66543A] flex items-center justify-center mx-auto">
              <Clock className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-display font-bold text-[#252525]">
              {rejected ? 'Teacher Verification Declined' : 'Teacher Verification Pending'}
            </h1>
            <p className="text-sm text-[#77736C] leading-relaxed">
              {rejected
                ? `Your instructor application was declined by an administrator.${
                    user?.teacherProfile?.rejectionReason
                      ? ` Reason: ${user.teacherProfile.rejectionReason}`
                      : ''
                  }`
                : 'Your teacher account has been created and is waiting for Administrator approval before class creation, exam authoring, and AI question studio tools are unlocked.'}
            </p>
            <div className="p-4 rounded-xl bg-[#F5F1E8] border border-[#E3DED3] text-left text-xs space-y-1">
              <div>
                <span className="text-[#77736C]">Account:</span>{' '}
                <span className="font-semibold text-[#252525]">{user?.name}</span> ({user?.email})
              </div>
              <div>
                <span className="text-[#77736C]">Subject:</span>{' '}
                <span className="font-semibold text-[#252525]">
                  {user?.teacherProfile?.subject || 'Not specified'}
                </span>
              </div>
              <div>
                <span className="text-[#77736C]">Status:</span>{' '}
                <span className="font-semibold uppercase text-[#B77B25]">{approvalStatus}</span>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => void refreshUser()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Check Approval Status
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/profile')}
                className="px-4 py-2.5 rounded-xl border border-[#E3DED3] bg-white text-xs font-semibold"
              >
                Update Profile
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const navItems: Array<{ id: TeacherTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'classes', label: 'My Classes', icon: Users },
    { id: 'students', label: 'Students', icon: GraduationCap },
    { id: 'upload', label: 'Upload & AI Studio', icon: Upload },
    { id: 'bank', label: 'Question Bank', icon: BookMarked },
    { id: 'exams', label: 'Create & Manage Exams', icon: FilePlus2 },
    { id: 'submissions', label: 'Submissions & Grading', icon: ClipboardCheck },
    { id: 'analytics', label: 'Class Analytics', icon: BarChart3 },
  ];

  const totalExamMarks = examQuestions.reduce((acc, q) => acc + (Number(q.marks) || 2), 0);

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
            <span className="text-[11px] font-medium text-[#DFC58E]">Teacher</span>
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
            <div className="text-sm font-semibold text-white truncate">{user?.name || 'Instructor'}</div>
            <div className="text-xs text-[#B5B0A6] truncate">
              {user?.teacherProfile?.subject || 'Approved Instructor'}
            </div>
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
          <h1 className="text-lg font-display font-bold text-[#252525] truncate">
            Instructor Studio · {user?.name}
          </h1>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setTab('exams')}
              className="px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold transition-colors whitespace-nowrap"
            >
              Create Official Exam
            </button>
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
          {error && (
            <div className="flex items-start gap-2.5 p-4 rounded-xl bg-[#C64B4B]/10 border border-[#C64B4B]/35 text-sm text-[#982E2E]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#C64B4B]" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="flex items-center gap-2 p-3.5 rounded-xl bg-[#25845D]/10 border border-[#25845D]/30 text-xs font-medium text-[#19593E]">
              <CheckCircle2 className="w-4 h-4 text-[#25845D]" />
              <span>{notice}</span>
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
                      <div className="text-xs font-medium text-[#77736C]">My Classes</div>
                      <div className="font-mono text-2xl font-bold text-[#252525] tabular-nums mt-1">
                        {data.classes.length}
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">Enrolled Students</div>
                      <div className="font-mono text-2xl font-bold text-[#4476A8] tabular-nums mt-1">
                        {data.stats.totalStudents}
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">Pending Evaluations</div>
                      <div className="font-mono text-2xl font-bold text-[#B77B25] tabular-nums mt-1">
                        {data.stats.pendingEvaluations}
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs font-medium text-[#77736C]">Official Exams</div>
                      <div className="font-mono text-2xl font-bold text-[#25845D] tabular-nums mt-1">
                        {data.stats.totalExams}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-5 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-[#66543A]" />
                          <h2 className="text-base font-display font-bold text-[#252525]">Class Performance</h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTab('analytics')}
                          className="text-xs font-semibold text-[#66543A] hover:underline"
                        >
                          Full analytics
                        </button>
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
                        <div className="font-semibold text-[#252525]">
                          Enrolled / Active Students ({data.students.length})
                        </div>
                        {data.students.length === 0 ? (
                          <p>No students enrolled in your classes yet.</p>
                        ) : (
                          data.students.slice(0, 6).map((st) => (
                            <div
                              key={st.id}
                              className="flex items-center justify-between py-1 border-b border-[#E3DED3] last:border-0"
                            >
                              <span className="font-medium text-[#252525]">{st.name}</span>
                              <span className="text-[#77736C]">{st.email}</span>
                            </div>
                          ))
                        )}
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
                                onClick={() => void openEvaluation(sub.attemptId)}
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

              {tab === 'classes' && (
                <div className="space-y-6">
                  <form
                    onSubmit={handleCreateClass}
                    className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4"
                  >
                    <h2 className="text-lg font-display font-bold text-[#252525]">Create New Class</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <input
                        type="text"
                        required
                        value={className}
                        onChange={(e) => setClassName(e.target.value)}
                        placeholder="Class Name (e.g., CS 301 Section A)"
                        className="px-3.5 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg"
                      />
                      <input
                        type="text"
                        required
                        value={classSubject}
                        onChange={(e) => setClassSubject(e.target.value)}
                        placeholder="Subject (e.g., Database Systems)"
                        className="px-3.5 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg"
                      />
                      <input
                        type="text"
                        value={classDescription}
                        onChange={(e) => setClassDescription(e.target.value)}
                        placeholder="Short description (optional)"
                        className="px-3.5 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={creatingClass}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#171717] hover:bg-[#303030] text-white text-xs font-semibold"
                    >
                      <Plus className="w-4 h-4" />
                      {creatingClass ? 'Creating...' : 'Create Class & Generate Code'}
                    </button>
                  </form>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-7 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                      <h2 className="text-base font-display font-bold text-[#252525]">
                        My Classes ({data.classes.length})
                      </h2>
                      {data.classes.length === 0 ? (
                        <p className="text-sm text-[#77736C]">No classes created yet.</p>
                      ) : (
                        <div className="divide-y divide-[#E3DED3]">
                          {data.classes.map((cls) => (
                            <div key={cls.id} className="py-4 space-y-2">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-bold text-[#252525]">
                                    {cls.name} · <span className="text-[#66543A]">{cls.subject}</span>
                                  </div>
                                  <div className="text-xs text-[#77736C] tabular-nums mt-0.5">
                                    Code:{' '}
                                    <span className="font-mono font-bold text-[#252525]">{cls.enrollmentCode}</span> ·{' '}
                                    {cls.memberCount} students · {cls.status.toUpperCase()}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void navigator.clipboard?.writeText(cls.enrollmentCode);
                                      setNotice(`Copied ${cls.enrollmentCode} to clipboard.`);
                                    }}
                                    aria-label={`Copy code ${cls.enrollmentCode}`}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E3DED3] text-xs font-semibold hover:bg-[#EFEBE2]"
                                  >
                                    <Copy className="w-3 h-3" />
                                    Copy Code
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void loadClassRoster(cls.id)}
                                    className="px-3 py-1.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold"
                                  >
                                    Manage Roster
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRegenerateCode(cls)}
                                    className="px-2.5 py-1.5 rounded-lg border border-[#E3DED3] text-xs font-semibold hover:bg-[#EFEBE2]"
                                  >
                                    New Code
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleClassArchive(cls)}
                                    className="px-2.5 py-1.5 rounded-lg border border-[#E3DED3] text-xs font-semibold hover:bg-[#EFEBE2]"
                                  >
                                    {cls.status === 'active' ? 'Archive' : 'Unarchive'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="lg:col-span-5 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                      <h2 className="text-base font-display font-bold text-[#252525]">Class Roster</h2>
                      {!activeClassId ? (
                        <p className="text-sm text-[#77736C]">
                          Select "Manage Roster" on a class to view enrolled students or add a student by email.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          <form onSubmit={handleAddStudentToClass} className="flex gap-2">
                            <input
                              type="text"
                              value={addStudentEmail}
                              onChange={(e) => setAddStudentEmail(e.target.value)}
                              placeholder="Student email address"
                              className="flex-1 px-3 py-2 text-xs bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg"
                            />
                            <button
                              type="submit"
                              className="px-3.5 py-2 rounded-lg bg-[#171717] text-white text-xs font-semibold"
                            >
                              Add
                            </button>
                          </form>
                          {rosterLoading ? (
                            <div className="py-6 flex justify-center">
                              <Loader2 className="w-5 h-5 animate-spin text-[#66543A]" />
                            </div>
                          ) : classRoster.length === 0 ? (
                            <p className="text-xs text-[#77736C]">No students enrolled in this class yet.</p>
                          ) : (
                            <div className="divide-y divide-[#E3DED3]">
                              {classRoster.map((m) => (
                                <div key={m.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                                  <div>
                                    <div className="font-semibold text-[#252525]">{m.studentName}</div>
                                    <div className="text-[#77736C] tabular-nums">
                                      {m.studentEmail} · {m.completedExamsCount} exams
                                      {m.avgPercentage !== null ? ` · Avg ${m.avgPercentage}%` : ''}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveStudentFromClass(m.studentId)}
                                    aria-label={`Remove ${m.studentName}`}
                                    className="p-1.5 text-[#77736C] hover:text-[#C64B4B]"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'students' && (
                <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-display font-bold text-[#252525]">
                      My Enrolled &amp; Participating Students ({data.students.length})
                    </h2>
                  </div>
                  {data.students.length === 0 ? (
                    <p className="text-sm text-[#77736C] py-4">
                      Students appear here once they join one of your classes or attempt one of your exams.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[#E3DED3] text-[#77736C]">
                            <th className="py-2.5 pr-4 font-semibold">Student</th>
                            <th className="py-2.5 pr-4 font-semibold">Classes</th>
                            <th className="py-2.5 pr-4 font-semibold">Exams Taken</th>
                            <th className="py-2.5 font-semibold">Average Score</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E3DED3]">
                          {data.students.map((st) => (
                            <tr key={st.id}>
                              <td className="py-3 pr-4">
                                <div className="font-semibold text-[#252525]">{st.name}</div>
                                <div className="text-[11px] text-[#77736C]">{st.email}</div>
                              </td>
                              <td className="py-3 pr-4 text-[#252525]">
                                {st.classNames && st.classNames.length > 0 ? st.classNames.join(', ') : 'Direct / Open'}
                              </td>
                              <td className="py-3 pr-4 font-mono tabular-nums">{st.completedExamsCount || 0}</td>
                              <td className="py-3 font-mono tabular-nums font-semibold">
                                {st.avgPercentage !== null && st.avgPercentage !== undefined ? `${st.avgPercentage}%` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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
                            onClick={() => void handleDeleteBankQuestion(q.id)}
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
                        Configure exam rules, lockdown settings, class/student assignments, and select questions from your Question Bank.
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
                          className="w-full px-3.5 py-2.5 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg"
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
                          className="w-full px-3.5 py-2.5 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg"
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
                        className="w-full px-3.5 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
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
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg tabular-nums"
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
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg tabular-nums"
                        />
                      </div>
                      <div>
                        <label htmlFor="ex-deadline" className="block text-xs font-semibold text-[#252525] mb-1">
                          Deadline (optional)
                        </label>
                        <input
                          id="ex-deadline"
                          type="datetime-local"
                          value={deadlineAt}
                          onChange={(e) => setDeadlineAt(e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg"
                        />
                      </div>
                      <div>
                        <label htmlFor="ex-limit" className="block text-xs font-semibold text-[#252525] mb-1">
                          Attempt Limit
                        </label>
                        <input
                          id="ex-limit"
                          type="number"
                          min={1}
                          max={10}
                          value={attemptLimit}
                          onChange={(e) => setAttemptLimit(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg tabular-nums"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="ex-start" className="block text-xs font-semibold text-[#252525] mb-1">
                          Availability Opens (optional)
                        </label>
                        <input
                          id="ex-start"
                          type="datetime-local"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg"
                        />
                      </div>
                      <div>
                        <label htmlFor="ex-end" className="block text-xs font-semibold text-[#252525] mb-1">
                          Availability Closes (optional)
                        </label>
                        <input
                          id="ex-end"
                          type="datetime-local"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg"
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
                            className="w-20 px-2.5 py-1.5 text-xs bg-white border border-[#E3DED3] rounded-lg tabular-nums"
                          />
                        </div>
                      </div>

                      <div className="space-y-2.5 text-xs text-[#252525]">
                        <div className="font-bold text-[#252525]">Class &amp; Student Assignment</div>
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
                          Assign to all students platform-wide
                        </label>
                        {!assignAll && (
                          <div className="space-y-3 pl-4 pt-1">
                            {data.classes.length > 0 && (
                              <div className="space-y-1">
                                <div className="font-semibold text-[#66543A]">Assign to Classes:</div>
                                <div className="max-h-24 overflow-y-auto space-y-1">
                                  {data.classes.map((c) => (
                                    <label key={c.id} className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={selectedClassIds.includes(c.id)}
                                        onChange={(e) =>
                                          setSelectedClassIds((prev) =>
                                            e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                                          )
                                        }
                                        className="accent-[#66543A]"
                                      />
                                      <span>
                                        {c.name} ({c.memberCount} students)
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                            {data.students.length > 0 && (
                              <div className="space-y-1">
                                <div className="font-semibold text-[#66543A]">Assign to Specific Students:</div>
                                <div className="max-h-24 overflow-y-auto space-y-1">
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
                              </div>
                            )}
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
                              {ex.assignAll ? 'All students' : 'Assigned classes/students'}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => openAssignModal(ex)}
                              className="px-3.5 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold text-[#252525] hover:bg-[#EFEBE2]"
                            >
                              Assign Classes
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleTogglePublish(ex)}
                              className="px-3.5 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold text-[#252525] hover:bg-[#EFEBE2]"
                            >
                              {ex.status === 'published' ? 'Unpublish' : 'Publish'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteExam(ex.id)}
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
                              onClick={() => void openEvaluation(sub.attemptId)}
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

              {tab === 'analytics' && (
                <div className="space-y-6">
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-display font-bold text-[#252525]">Class Performance Analytics</h2>
                      <p className="text-xs text-[#77736C]">
                        Compare score distributions, completion rates, and students needing extra review.
                      </p>
                    </div>
                    <select
                      value={analyticsClassId}
                      onChange={(e) => setAnalyticsClassId(e.target.value)}
                      aria-label="Filter analytics by class"
                      className="px-3.5 py-2 text-xs bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg"
                    >
                      <option value="">All Enrolled Students</option>
                      {data.classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.subject})
                        </option>
                      ))}
                    </select>
                  </div>

                  {analyticsLoading && !analyticsData ? (
                    <div className="py-12 flex justify-center">
                      <Loader2 className="w-6 h-6 text-[#66543A] animate-spin" />
                    </div>
                  ) : analyticsData ? (
                    <>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                          <div className="text-xs text-[#77736C]">Class Average</div>
                          <div className="font-mono text-2xl font-bold text-[#252525] tabular-nums mt-1">
                            {analyticsData.analytics.classAverage !== null
                              ? `${analyticsData.analytics.classAverage}%`
                              : '—'}
                          </div>
                        </div>
                        <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                          <div className="text-xs text-[#77736C]">Highest Score</div>
                          <div className="font-mono text-2xl font-bold text-[#25845D] tabular-nums mt-1">
                            {analyticsData.analytics.highestScore !== null
                              ? `${analyticsData.analytics.highestScore}%`
                              : '—'}
                          </div>
                        </div>
                        <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                          <div className="text-xs text-[#77736C]">Lowest Score</div>
                          <div className="font-mono text-2xl font-bold text-[#C64B4B] tabular-nums mt-1">
                            {analyticsData.analytics.lowestScore !== null
                              ? `${analyticsData.analytics.lowestScore}%`
                              : '—'}
                          </div>
                        </div>
                        <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                          <div className="text-xs text-[#77736C]">Completion Rate</div>
                          <div className="font-mono text-2xl font-bold text-[#4476A8] tabular-nums mt-1">
                            {analyticsData.analytics.completionRate !== null
                              ? `${analyticsData.analytics.completionRate}%`
                              : '—'}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div className="lg:col-span-5 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                          <h3 className="text-base font-display font-bold text-[#252525]">Score Distribution</h3>
                          <div className="space-y-3">
                            {analyticsData.analytics.distribution.map((band) => {
                              const total = Math.max(1, analyticsData.analytics.evaluatedCount);
                              const widthPct = Math.round((band.count / total) * 100);
                              return (
                                <div key={band.label} className="space-y-1">
                                  <div className="flex justify-between text-xs">
                                    <span className="font-semibold text-[#252525]">{band.label}</span>
                                    <span className="font-mono tabular-nums text-[#77736C]">{band.count}</span>
                                  </div>
                                  <div className="h-2.5 bg-[#EFEBE2] rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-[#C9A45C] rounded-full"
                                      style={{ width: `${band.count > 0 ? Math.max(6, widthPct) : 0}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="pt-3 border-t border-[#E3DED3] space-y-2">
                            <div className="text-xs font-bold text-[#C64B4B]">
                              Students Needing Support ({analyticsData.analytics.studentsNeedingSupport.length})
                            </div>
                            {analyticsData.analytics.studentsNeedingSupport.length === 0 ? (
                              <p className="text-xs text-[#77736C]">No low-score or non-submission alerts.</p>
                            ) : (
                              analyticsData.analytics.studentsNeedingSupport.map((s) => (
                                <div key={s.studentId} className="flex justify-between text-xs">
                                  <span className="font-medium text-[#252525]">{s.studentName}</span>
                                  <span className="font-mono text-[#C64B4B] tabular-nums">
                                    {s.averagePercentage !== null ? `${s.averagePercentage}%` : 'No attempts'}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="lg:col-span-7 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                          <h3 className="text-base font-display font-bold text-[#252525]">Student Ranking</h3>
                          {analyticsData.analytics.ranking.length === 0 ? (
                            <p className="text-sm text-[#77736C]">No student attempts recorded yet.</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="border-b border-[#E3DED3] text-[#77736C]">
                                    <th className="py-2 pr-4 font-semibold">Student</th>
                                    <th className="py-2 pr-4 font-semibold">Submissions</th>
                                    <th className="py-2 font-semibold">Avg Score</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#E3DED3]">
                                  {analyticsData.analytics.ranking.map((r) => (
                                    <tr key={r.studentId}>
                                      <td className="py-2.5 pr-4">
                                        <div className="font-semibold text-[#252525]">{r.studentName}</div>
                                        <div className="text-[11px] text-[#77736C]">{r.studentEmail}</div>
                                      </td>
                                      <td className="py-2.5 pr-4 font-mono tabular-nums">{r.attemptsCount}</td>
                                      <td className="py-2.5 font-mono font-bold tabular-nums">
                                        {r.averagePercentage !== null ? `${r.averagePercentage}%` : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>

      {/* Assign Exam to Classes Modal */}
      {assigningExam && data && (
        <div className="fixed inset-0 z-40 bg-[#171717]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED3] rounded-2xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-[#E3DED3] pb-3">
              <div>
                <h3 className="text-base font-display font-bold text-[#252525]">
                  Assign Exam — {assigningExam.title}
                </h3>
                <p className="text-xs text-[#77736C]">Target specific classes, students, or all students.</p>
              </div>
              <button
                type="button"
                onClick={() => setAssigningExam(null)}
                className="text-xs font-semibold text-[#77736C]"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="flex items-center gap-2 font-semibold text-[#252525]">
                <input
                  type="checkbox"
                  checked={modalAssignAll}
                  onChange={(e) => setModalAssignAll(e.target.checked)}
                  className="accent-[#66543A]"
                />
                Assign to all students platform-wide
              </label>

              {!modalAssignAll && (
                <>
                  <div className="space-y-1">
                    <div className="font-semibold text-[#66543A]">Classes:</div>
                    <div className="max-h-28 overflow-y-auto space-y-1 border border-[#E3DED3] rounded-lg p-2.5">
                      {data.classes.length === 0 ? (
                        <span className="text-[#77736C]">No classes created yet.</span>
                      ) : (
                        data.classes.map((c) => (
                          <label key={c.id} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={modalClassIds.includes(c.id)}
                              onChange={(e) =>
                                setModalClassIds((prev) =>
                                  e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                                )
                              }
                            />
                            <span>
                              {c.name} ({c.memberCount} students)
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="font-semibold text-[#66543A]">Individual Students:</div>
                    <div className="max-h-28 overflow-y-auto space-y-1 border border-[#E3DED3] rounded-lg p-2.5">
                      {data.students.map((s) => (
                        <label key={s.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={modalStudentIds.includes(s.id)}
                            onChange={(e) =>
                              setModalStudentIds((prev) =>
                                e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                              )
                            }
                          />
                          <span>{s.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block font-semibold text-[#66543A] mb-1">Opens (optional)</label>
                  <input
                    type="datetime-local"
                    value={modalStartTime}
                    onChange={(e) => setModalStartTime(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-[#E3DED3] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#66543A] mb-1">Closes (optional)</label>
                  <input
                    type="datetime-local"
                    value={modalEndTime}
                    onChange={(e) => setModalEndTime(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-[#E3DED3] rounded-lg"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAssigningExam(null)}
                className="px-4 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingAssign}
                onClick={() => void handleSaveAssignments()}
                className="px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold"
              >
                {savingAssign ? 'Saving...' : 'Save Assignments'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                        <div
                          key={q.questionId}
                          className="p-5 rounded-xl bg-[#EFEBE2]/65 border border-[#E3DED3] space-y-3"
                        >
                          <div className="text-xs font-mono font-semibold text-[#66543A]">
                            Descriptive Item {idx + 1} · Max {q.marks} marks
                          </div>
                          <p className="text-sm font-bold text-[#252525]">{q.prompt}</p>
                          <div className="p-3 rounded-lg bg-white border border-[#E3DED3] text-sm text-[#252525] whitespace-pre-wrap">
                            <span className="text-xs font-semibold text-[#77736C] block mb-1">Student Response:</span>
                            {q.studentAnswer || '(No response entered)'}
                          </div>
                          {q.suggestedAnswer && (
                            <p className="text-xs text-[#4476A8]">Model Answer: {q.suggestedAnswer}</p>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                            <div>
                              <label className="block text-xs font-semibold mb-1">Marks Awarded</label>
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
                                className="w-full px-3 py-2 text-sm bg-white border border-[#E3DED3] rounded-lg tabular-nums"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-semibold mb-1">Teacher Feedback</label>
                              <input
                                type="text"
                                value={entry.feedback}
                                onChange={(e) =>
                                  setEvalInputs((prev) => ({
                                    ...prev,
                                    [q.questionId]: { ...entry, feedback: e.target.value },
                                  }))
                                }
                                placeholder="Provide constructive rubric feedback..."
                                className="w-full px-3 py-2 text-sm bg-white border border-[#E3DED3] rounded-lg"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}

                  {evaluationDetail.questions.filter(
                    (q) => q.questionType === 'short_answer' || q.questionType === 'long_answer'
                  ).length === 0 && (
                    <p className="text-sm text-[#77736C]">
                      This exam contains objective questions only and was auto-graded upon submission.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-[#E3DED3] pt-4">
                  <button
                    type="button"
                    onClick={() => setEvaluatingAttemptId(null)}
                    className="px-4 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingEval}
                    onClick={() => void handleSaveEvaluation()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold"
                  >
                    {savingEval && <Loader2 className="w-4 h-4 animate-spin" />}
                    Publish Final Grade
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
