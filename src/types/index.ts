export type UserRole = 'student' | 'teacher' | 'admin';

export type AccountStatus = 'active' | 'deactivated' | 'suspended';

export type TeacherApprovalStatus = 'pending' | 'approved' | 'rejected';

export type QuestionType = 'mcq' | 'short_answer' | 'long_answer' | 'true_false';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface TeacherProfileInfo {
  userId: string;
  subject: string;
  institution: string;
  bio: string;
  approvalStatus: TeacherApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  institution?: string;
  accountStatus?: AccountStatus;
  lastLoginAt?: string | null;
  createdAt: string;
  teacherProfile?: TeacherProfileInfo | null;
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

export type AssignmentLifecycleStatus =
  | 'Assigned'
  | 'Started'
  | 'Completed'
  | 'Not attempted'
  | 'Expired';

export interface ExamAssignmentRecord {
  id: string;
  examId: string;
  teacherId: string;
  classId: string | null;
  className?: string | null;
  studentId: string | null;
  studentName?: string | null;
  studentEmail?: string | null;
  startTime: string | null;
  endTime: string | null;
  attemptLimit: number;
  status: string;
  assignedAt: string;
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
  assignmentInfo?: {
    assignmentId: string;
    classId: string | null;
    className: string | null;
    startTime: string | null;
    endTime: string | null;
    attemptLimit: number;
    lifecycleStatus: AssignmentLifecycleStatus;
  } | null;
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
    topic?: string;
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

export interface ClassRecord {
  id: string;
  teacherId: string;
  teacherName?: string;
  name: string;
  description: string;
  subject: string;
  enrollmentCode: string;
  status: 'active' | 'archived';
  memberCount: number;
  assignedExamCount?: number;
  createdAt: string;
  updatedAt?: string | null;
}

export interface ClassMemberRecord {
  id: string;
  classId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  institution: string;
  joinedAt: string;
  status: 'active' | 'removed';
  completedExamsCount: number;
  avgPercentage: number | null;
}

export interface StudentProgressSummary {
  hasSufficientData: boolean;
  totalAttempted: number;
  totalCompleted: number;
  evaluatedCount: number;
  averageScore: number | null;
  highestScore: number | null;
  passRate: number | null;
  totalCorrect: number;
  totalIncorrect: number;
  totalUnanswered: number;
  practiceAttemptsCount: number;
  practiceAverage: number | null;
  subjectBreakdown: Array<{
    subject: string;
    attempts: number;
    averagePercentage: number;
    highestPercentage: number;
  }>;
  topicBreakdown: Array<{
    topic: string;
    subject: string;
    attemptedQuestions: number;
    correctQuestions: number;
    marksEarned: number;
    marksPossible: number;
    accuracyPercent: number;
  }>;
  strongTopics: Array<{ topic: string; accuracyPercent: number; attemptedQuestions: number }>;
  weakTopics: Array<{ topic: string; accuracyPercent: number; attemptedQuestions: number }>;
  scoreTrend: Array<{
    id: string;
    label: string;
    subject: string;
    percentage: number;
    kind: 'official' | 'practice';
    date: string;
  }>;
  suggestions: string[];
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

export interface PlatformSettings {
  allowTeacherRegistration: boolean;
  requireTeacherApproval: boolean;
  defaultMaxTabSwitches: number;
  allowPublicPractice: boolean;
}

export interface AdminAuditLogRecord {
  id: string;
  adminId: string | null;
  adminName?: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
}
