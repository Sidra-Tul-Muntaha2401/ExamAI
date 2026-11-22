export type UserRole = 'student' | 'teacher';

export type QuestionType = 'mcq' | 'short_answer' | 'long_answer' | 'true_false';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface DocumentRecord {
  id: string;
  userId: string;
  ownerRole: UserRole;
  title: string;
  originalFilename: string;
  fileType: 'pdf' | 'docx';
  fileSize: number;
  extractedText: string;
  wordCount: number;
  createdAt: string;
}

export interface QuizQuestion {
  id: string;
  questionType: QuestionType;
  difficulty: Difficulty;
  topic?: string;
  prompt: string;
  options: string[];
  correctAnswer?: string;
  explanation?: string;
  suggestedAnswer?: string;
  markingGuidance?: string;
  marks: number;
}

export interface PracticeQuizRecord {
  id: string;
  studentId: string;
  documentId: string | null;
  title: string;
  topic: string;
  difficulty: Difficulty;
  questionType: QuestionType | 'mixed';
  questions: QuizQuestion[];
  createdAt: string;
  lastAttempt?: {
    id: string;
    score: number;
    totalMarks: number;
    percentage: number;
    completedAt: string;
  } | null;
}

export interface OfficialExamSummary {
  id: string;
  teacherId: string;
  teacherName?: string;
  title: string;
  subject: string;
  instructions: string;
  durationMinutes: number;
  totalMarks: number;
  passingMarks: number;
  deadlineAt: string | null;
  status: 'draft' | 'published';
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  trackTabSwitches: boolean;
  warnOnTabLeave: boolean;
  requireFullscreen: boolean;
  blockCopyPaste: boolean;
  maxTabSwitches: number;
  assignAll: boolean;
  questionCount?: number;
  submissionCount?: number;
  pendingEvaluationCount?: number;
  createdAt: string;
  studentAttempt?: {
    id: string;
    status: 'in_progress' | 'submitted' | 'evaluated';
    startedAt: string;
    submittedAt: string | null;
    result?: {
      totalScore: number;
      totalMarks: number;
      percentage: number;
      passed: boolean;
      status: 'pending_evaluation' | 'evaluated';
    } | null;
  } | null;
}

export interface ExamTakeQuestion {
  id: string;
  questionType: QuestionType;
  difficulty: Difficulty;
  prompt: string;
  options: string[];
  marks: number;
  questionOrder: number;
}

export interface ExamAttemptSession {
  attemptId: string;
  exam: {
    id: string;
    title: string;
    subject: string;
    instructions: string;
    durationMinutes: number;
    totalMarks: number;
    passingMarks: number;
    deadlineAt: string | null;
    trackTabSwitches: boolean;
    warnOnTabLeave: boolean;
    requireFullscreen: boolean;
    blockCopyPaste: boolean;
    maxTabSwitches: number;
  };
  startedAt: string;
  remainingSeconds: number;
  tabSwitchCount: number;
  focusLossCount: number;
  questions: ExamTakeQuestion[];
  savedAnswers: Record<string, string>;
}

export interface ExamResultDetail {
  attemptId: string;
  examId: string;
  examTitle: string;
  subject: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  startedAt: string;
  submittedAt: string | null;
  status: 'pending_evaluation' | 'evaluated';
  objectiveScore: number;
  descriptiveScore: number;
  totalScore: number;
  totalMarks: number;
  passingMarks: number;
  percentage: number;
  passed: boolean;
  tabSwitchCount: number;
  focusLossCount: number;
  questions: Array<{
    questionId: string;
    questionType: QuestionType;
    difficulty: Difficulty;
    prompt: string;
    options: string[];
    marks: number;
    studentAnswer: string;
    correctAnswer: string;
    explanation: string;
    suggestedAnswer: string;
    markingGuidance: string;
    isCorrect: boolean | null;
    marksAwarded: number | null;
    teacherFeedback: string | null;
  }>;
  activityLogs: Array<{
    id: string;
    eventType: string;
    details: string;
    createdAt: string;
  }>;
}

export interface RequestLogRecord {
  id: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  userRole: string;
  method: string;
  endpoint: string;
  action: string;
  statusCode: number;
  details: string;
  ipAddress: string;
  createdAt: string;
}

export interface UsageOverviewData {
  dbProvider: 'supabase' | 'sqlite';
  summary: {
    totalRequests: number;
    uniqueActiveUsers: number;
    totalUsers: number;
    totalStudents: number;
    totalTeachers: number;
    totalDocuments: number;
    totalAiGenerations: number;
  };
  users: UserProfile[];
  logs: RequestLogRecord[];
}
