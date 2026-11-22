import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import {
  getRemainingSeconds,
  gradeObjectiveQuestions,
  isAttemptWithinSubmissionWindow,
  MAX_UPLOAD_BYTES,
  seededShuffle,
  shouldAutoSubmitForViolations,
} from '../src/lib/examRules.ts';
import type {
  Difficulty,
  ExamAttemptSession,
  ExamTakeQuestion,
  QuestionType,
  QuizQuestion,
  UserProfile,
  UserRole,
} from '../src/types/index.ts';
import {
  clearSessionCookie,
  createSession,
  deleteSessionByToken,
  extractRawToken,
  requireAuth,
  requireRole,
  setSessionCookie,
  type AuthenticatedRequest,
} from './auth.ts';
import { processUploadedDocument } from './documentProcessor.ts';
import { generateQuestionsWithGroq, getAiAvailability } from './groqService.ts';
import { hashPassword, store, verifyPassword } from './store.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

function asyncHandler(
  fn: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void> | void
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthenticatedRequest, res, next)).catch(next);
  };
}

function describeApiAction(method: string, reqPath: string): string {
  const clean = reqPath.replace(/^\/+/, '');
  if (clean === 'auth/register') return 'User Registration';
  if (clean === 'auth/login') return 'User Login';
  if (clean === 'auth/logout') return 'User Logout';
  if (clean === 'documents/upload') return 'Upload PDF/DOCX Document';
  if (clean.startsWith('documents/')) return method === 'DELETE' ? 'Delete Document' : 'Document Request';
  if (clean === 'documents') return 'List Documents';
  if (clean === 'ai/generate-questions') return 'AI Question Generation';
  if (clean === 'practice-quizzes' && method === 'POST') return 'Save Practice Quiz';
  if (clean.includes('/attempt')) return 'Submit Practice Quiz Attempt';
  if (clean.startsWith('exams/') && clean.endsWith('/take')) return 'Start/Resume Official Exam';
  if (clean.startsWith('exams/attempts/') && clean.endsWith('/answer')) return 'Auto-Save Exam Answer';
  if (clean.startsWith('exams/attempts/') && clean.endsWith('/activity')) return 'Exam Integrity Event';
  if (clean.startsWith('exams/attempts/') && clean.endsWith('/submit')) return 'Submit Official Exam';
  if (clean.startsWith('results/')) return 'View Exam Result';
  if (clean === 'teacher/exams' && method === 'POST') return 'Create Official Exam';
  if (clean.startsWith('teacher/exams/') && clean.endsWith('/publish')) return 'Update Exam Publish Status';
  if (clean.startsWith('teacher/exams/') && clean.endsWith('/assign')) return 'Update Exam Assignments';
  if (clean.startsWith('teacher/question-bank')) return `${method === 'POST' ? 'Save' : method === 'DELETE' ? 'Delete' : 'View'} Question Bank`;
  if (clean.includes('/evaluate')) return 'Evaluate Student Submission';
  if (clean === 'student/dashboard') return 'Student Dashboard Load';
  if (clean === 'teacher/dashboard') return 'Teacher Dashboard Load';
  return `${method} /api/${clean}`;
}

function shouldLogRequest(method: string, reqPath: string): boolean {
  if (reqPath === '/health' || reqPath === '/auth/me' || reqPath === '/teacher/usage-logs') {
    return false;
  }
  // Avoid noisy auto-save answer keystrokes in audit log unless they fail
  if (method === 'PATCH' && reqPath.endsWith('/answer')) {
    return false;
  }
  return true;
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  // Request & usage audit logger
  router.use((req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const reqPath = req.path || '/';
    if (!shouldLogRequest(req.method, reqPath)) {
      next();
      return;
    }

    res.on('finish', () => {
      const actor = (res.locals.loggedUser as UserProfile | undefined) || req.user;
      const forwarded = req.headers['x-forwarded-for'];
      const ipAddress = (
        typeof forwarded === 'string'
          ? forwarded.split(',')[0].trim()
          : Array.isArray(forwarded)
            ? forwarded[0] || ''
            : req.ip || ''
      ).slice(0, 64);

      const safeDetails =
        typeof res.locals.logDetails === 'string' ? res.locals.logDetails.slice(0, 240) : '';

      void store.createRequestLog({
        id: `req_${crypto.randomUUID()}`,
        userId: actor?.id ?? null,
        userName: actor?.name || (typeof res.locals.guestName === 'string' ? res.locals.guestName : 'Guest'),
        userEmail: actor?.email || (typeof res.locals.guestEmail === 'string' ? res.locals.guestEmail : ''),
        userRole: actor?.role || 'anonymous',
        method: req.method,
        endpoint: `/api${reqPath}`,
        action: describeApiAction(req.method, reqPath),
        statusCode: res.statusCode,
        details: safeDetails,
        ipAddress,
        createdAt: new Date().toISOString(),
      });
    });

    next();
  });

  router.get('/health', (_req: Request, res: Response) => {
    const ai = getAiAvailability();
    res.json({
      status: store.ready ? 'ok' : 'degraded',
      dbProvider: store.provider,
      dbReady: store.ready,
      dbError: store.initError,
      dbNotice: store.fallbackNotice,
      ...ai,
    });
  });

  // =========================================================================
  // AUTHENTICATION
  // =========================================================================
  router.post(
    '/auth/register',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : '';

      res.locals.guestName = name || 'Guest';
      res.locals.guestEmail = email;

      if (name.length < 2 || name.length > 80) {
        res.status(400).json({ error: 'Full name must be between 2 and 80 characters.' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }
      if (roleRaw !== 'student' && roleRaw !== 'teacher') {
        res.status(400).json({ error: 'Role must be either student or teacher.' });
        return;
      }

      const existing = await store.findUserByEmail(email);
      if (existing) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      const userId = `usr_${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const passwordHash = hashPassword(password);
      const role: UserRole = roleRaw;

      await store.createUser({
        id: userId,
        name,
        email,
        password_hash: passwordHash,
        role,
        created_at: createdAt,
      });

      const { token } = await createSession(userId);
      setSessionCookie(req, res, token);

      const user: UserProfile = { id: userId, name, email, role, createdAt };
      res.locals.loggedUser = user;
      res.locals.logDetails = `Registered new ${role} account`;

      res.status(201).json({ user, token });
    })
  );

  router.post(
    '/auth/login',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      res.locals.guestEmail = email;

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const row = await store.findUserByEmail(email);
      if (!row || !verifyPassword(password, row.password_hash)) {
        res.locals.logDetails = 'Failed login attempt';
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const { token } = await createSession(row.id);
      setSessionCookie(req, res, token);

      const user: UserProfile = {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        createdAt: row.created_at,
      };
      res.locals.loggedUser = user;
      res.locals.logDetails = `Signed in as ${row.role}`;

      res.json({ user, token });
    })
  );

  router.post(
    '/auth/logout',
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (req.user) {
        res.locals.loggedUser = req.user;
      }
      const { token } = extractRawToken(req);
      if (token) {
        await deleteSessionByToken(token);
      }
      clearSessionCookie(req, res);
      res.json({ ok: true });
    })
  );

  router.get('/auth/me', (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.user || null });
  });

  // =========================================================================
  // DOCUMENTS (PDF & DOCX FOR BOTH ROLES)
  // =========================================================================
  router.post(
    '/documents/upload',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (req.user!.role === 'student') {
        const lock = await store.getActiveExamAttemptLock(req.user!.id);
        if (lock) {
          res.status(403).json({
            error: `Document uploads are locked while "${lock.examTitle}" is in progress.`,
            activeExamId: lock.examId,
          });
          return;
        }
      }

      await new Promise<void>((resolve) => {
        upload.single('file')(req, res, async (multerErr: unknown) => {
          try {
            if (multerErr) {
              if (multerErr instanceof multer.MulterError && multerErr.code === 'LIMIT_FILE_SIZE') {
                res.status(400).json({ error: 'File exceeds the 10 MB upload limit.' });
              } else {
                res.status(400).json({ error: 'Failed to process file upload.' });
              }
              resolve();
              return;
            }

            if (!req.file) {
              res.status(400).json({ error: 'No document file was attached.' });
              resolve();
              return;
            }

            const processed = await processUploadedDocument(
              req.file.buffer,
              req.file.originalname,
              req.file.mimetype,
              req.file.size
            );

            const customTitle =
              typeof req.body?.title === 'string' && req.body.title.trim().length > 0
                ? req.body.title.trim().slice(0, 120)
                : req.file.originalname.replace(/\.(pdf|docx)$/i, '');

            const docId = `doc_${crypto.randomUUID()}`;
            const createdAt = new Date().toISOString();

            const docRecord = {
              id: docId,
              userId: req.user!.id,
              ownerRole: req.user!.role,
              title: customTitle,
              originalFilename: req.file.originalname,
              fileType: processed.fileType,
              fileSize: req.file.size,
              extractedText: processed.extractedText,
              wordCount: processed.wordCount,
              createdAt,
            };

            await store.createDocument(docRecord);
            res.locals.logDetails = `${req.file.originalname} (${processed.wordCount} words)`;
            res.status(201).json({ document: docRecord });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unable to extract text from document.';
            res.status(400).json({ error: message });
          } finally {
            resolve();
          }
        });
      });
    })
  );

  router.get(
    '/documents',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (req.user!.role === 'student') {
        const lock = await store.getActiveExamAttemptLock(req.user!.id);
        if (lock) {
          res.status(403).json({
            error: `Study documents are locked while "${lock.examTitle}" is in progress.`,
            activeExamId: lock.examId,
          });
          return;
        }
      }
      const documents = await store.listDocumentsByUser(req.user!.id);
      res.json({ documents });
    })
  );

  router.delete(
    '/documents/:id',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (req.user!.role === 'student') {
        const lock = await store.getActiveExamAttemptLock(req.user!.id);
        if (lock) {
          res.status(403).json({
            error: `Document management is locked while "${lock.examTitle}" is in progress.`,
            activeExamId: lock.examId,
          });
          return;
        }
      }
      const docId = String(req.params.id);
      const deleted = await store.deleteDocument(docId, req.user!.id);
      if (!deleted) {
        res.status(404).json({ error: 'Document not found or unauthorized.' });
        return;
      }
      res.json({ ok: true });
    })
  );

  // =========================================================================
  // AI QUESTION GENERATION (SERVER-SIDE GROQ + GEMINI FALLBACK)
  // =========================================================================
  router.post(
    '/ai/generate-questions',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (req.user!.role === 'student') {
        const lock = await store.getActiveExamAttemptLock(req.user!.id);
        if (lock) {
          await store.logSimpleActivityEvent({
            attemptId: lock.attemptId,
            examId: lock.examId,
            studentId: req.user!.id,
            eventType: 'ai_access_blocked',
            details: 'Blocked attempt to use ExamAI AI question generator during active exam',
            createdAt: new Date().toISOString(),
          });
          res.status(403).json({
            error: `AI question generation is disabled while "${lock.examTitle}" is in progress.`,
            activeExamId: lock.examId,
          });
          return;
        }
      }

      const documentId = typeof req.body?.documentId === 'string' ? req.body.documentId.trim() : '';
      const questionTypeRaw = typeof req.body?.questionType === 'string' ? req.body.questionType.trim() : 'mcq';
      const difficultyRaw = typeof req.body?.difficulty === 'string' ? req.body.difficulty.trim() : 'Medium';
      const count = Number(req.body?.count) || 5;
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';

      if (!documentId) {
        res.status(400).json({ error: 'Please select an uploaded document first.' });
        return;
      }

      const validTypes = ['mcq', 'short_answer', 'long_answer', 'true_false', 'mixed'];
      if (!validTypes.includes(questionTypeRaw)) {
        res.status(400).json({ error: 'Invalid question type selected.' });
        return;
      }

      const validDifficulties: Difficulty[] = ['Easy', 'Medium', 'Hard'];
      if (!validDifficulties.includes(difficultyRaw as Difficulty)) {
        res.status(400).json({ error: 'Difficulty must be Easy, Medium, or Hard.' });
        return;
      }

      const doc = await store.findDocumentById(documentId);
      if (!doc || doc.userId !== req.user!.id) {
        res.status(404).json({ error: 'Document not found or access denied.' });
        return;
      }

      if (!doc.extractedText || doc.extractedText.trim().length < 40) {
        res.status(400).json({ error: 'Selected document does not contain enough extracted text.' });
        return;
      }

      try {
        const questions = await generateQuestionsWithGroq({
          sourceText: doc.extractedText,
          questionType: questionTypeRaw as QuestionType | 'mixed',
          difficulty: difficultyRaw as Difficulty,
          count,
          topic: topic || doc.title,
        });
        res.locals.logDetails = `Generated ${questions.length} ${questionTypeRaw} (${difficultyRaw}) from "${doc.title}"`;
        res.json({ questions });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to generate questions.';
        const status = msg.includes('No AI API key is configured') ? 503 : 502;
        res.locals.logDetails = msg.slice(0, 180);
        res.status(status).json({ error: msg });
      }
    })
  );

  // =========================================================================
  // STUDENT DASHBOARD & STUDY MODE
  // =========================================================================
  router.get(
    '/student/dashboard',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const studentId = req.user!.id;
      const [docsCount, practiceQuizzes, examEntries, practiceAttempts, activeExamAttempt] = await Promise.all([
        store.countDocumentsByUser(studentId),
        store.listPracticeQuizzesForStudent(studentId),
        store.listPublishedExamsForStudent(studentId),
        store.listRecentPracticeAttempts(studentId, 10),
        store.getActiveExamAttemptLock(studentId),
      ]);

      const availableExams = [];
      const completedExams = [];

      for (const entry of examEntries) {
        const e = entry.exam;
        const attempt = entry.attempt;
        const resultRow = entry.result;

        const summary = {
          id: e.id,
          teacherId: e.teacher_id,
          teacherName: e.teacher_name || 'Instructor',
          title: e.title,
          subject: e.subject,
          instructions: e.instructions,
          durationMinutes: e.duration_minutes,
          totalMarks: e.total_marks,
          passingMarks: e.passing_marks,
          deadlineAt: e.deadline_at,
          status: 'published' as const,
          randomizeQuestions: e.randomize_questions,
          randomizeOptions: e.randomize_options,
          trackTabSwitches: e.track_tab_switches,
          warnOnTabLeave: e.warn_on_tab_leave,
          requireFullscreen: e.require_fullscreen,
          blockCopyPaste: e.block_copy_paste,
          maxTabSwitches: e.max_tab_switches,
          assignAll: e.assign_all,
          questionCount: e.question_count || 0,
          createdAt: e.created_at,
          studentAttempt: attempt
            ? {
                id: attempt.id,
                status: attempt.status,
                startedAt: attempt.started_at,
                submittedAt: attempt.submitted_at,
                result: resultRow
                  ? {
                      totalScore: Number(resultRow.total_score),
                      totalMarks: Number(resultRow.total_marks),
                      percentage: Number(resultRow.percentage),
                      passed: Boolean(resultRow.passed),
                      status: resultRow.status as 'pending_evaluation' | 'evaluated',
                    }
                  : null,
              }
            : null,
        };

        if (attempt && (attempt.status === 'submitted' || attempt.status === 'evaluated')) {
          completedExams.push(summary);
        } else {
          availableExams.push(summary);
        }
      }

      const evaluatedResults = completedExams
        .filter((ex) => ex.studentAttempt?.result?.status === 'evaluated')
        .map((ex) => ex.studentAttempt!.result!);

      const avgExamPercentage =
        evaluatedResults.length > 0
          ? Math.round(
              (evaluatedResults.reduce((acc, r) => acc + r.percentage, 0) / evaluatedResults.length) * 10
            ) / 10
          : null;

      const avgPracticePercentage =
        practiceAttempts.length > 0
          ? Math.round(
              (practiceAttempts.reduce((acc, a) => acc + a.percentage, 0) / practiceAttempts.length) * 10
            ) / 10
          : null;

      const recentActivity = [
        ...practiceAttempts.slice(0, 4).map((pa) => ({
          id: pa.id,
          type: 'practice',
          title: `Completed practice quiz: ${pa.quizTitle}`,
          detail: `${pa.score}/${pa.totalMarks} marks (${pa.percentage}%)`,
          timestamp: pa.completedAt,
        })),
        ...completedExams.slice(0, 4).map((ex) => ({
          id: ex.studentAttempt!.id,
          type: 'official_exam',
          title: `Submitted official exam: ${ex.title}`,
          detail:
            ex.studentAttempt!.result?.status === 'evaluated'
              ? `${ex.studentAttempt!.result.totalScore}/${ex.studentAttempt!.result.totalMarks} (${ex.studentAttempt!.result.percentage}%)`
              : 'Objective graded · descriptive pending review',
          timestamp: ex.studentAttempt!.submittedAt || ex.createdAt,
        })),
      ].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

      res.json({
        activeExamAttempt,
        stats: {
          documentsCount: docsCount,
          practiceQuizzesCount: practiceQuizzes.length,
          availableExamsCount: availableExams.length,
          completedExamsCount: completedExams.length,
          avgExamPercentage,
          avgPracticePercentage,
        },
        practiceQuizzes,
        availableExams,
        completedExams,
        recentActivity: recentActivity.slice(0, 8),
      });
    })
  );

  router.post(
    '/practice-quizzes',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const lock = await store.getActiveExamAttemptLock(req.user!.id);
      if (lock) {
        res.status(403).json({
          error: `Practice quiz creation is locked while "${lock.examTitle}" is in progress.`,
          activeExamId: lock.examId,
        });
        return;
      }

      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : 'General Study';
      const difficulty = (req.body?.difficulty || 'Medium') as Difficulty;
      const questionType = String(req.body?.questionType || 'mixed');
      const documentId =
        typeof req.body?.documentId === 'string' && req.body.documentId ? req.body.documentId : null;
      const questions = Array.isArray(req.body?.questions) ? (req.body.questions as QuizQuestion[]) : [];

      if (title.length < 2) {
        res.status(400).json({ error: 'Quiz title must be at least 2 characters.' });
        return;
      }
      if (questions.length === 0) {
        res.status(400).json({ error: 'Include at least one question before saving the practice quiz.' });
        return;
      }

      if (documentId) {
        const doc = await store.findDocumentById(documentId);
        if (!doc || doc.userId !== req.user!.id) {
          res.status(403).json({ error: 'Referenced document not found or unauthorized.' });
          return;
        }
      }

      const id = `pq_${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const normalizedQuestions = questions.map((q, idx) => ({
        ...q,
        id: q.id || `pq_item_${idx + 1}`,
        marks:
          Number(q.marks) ||
          (q.questionType === 'long_answer'
            ? 10
            : q.questionType === 'short_answer'
              ? 5
              : q.questionType === 'true_false'
                ? 1
                : 2),
      }));

      await store.createPracticeQuiz({
        id,
        studentId: req.user!.id,
        documentId,
        title,
        topic,
        difficulty,
        questionType,
        questions: normalizedQuestions,
        createdAt,
      });

      res.locals.logDetails = `${title} (${normalizedQuestions.length} questions)`;
      res.status(201).json({
        quiz: {
          id,
          studentId: req.user!.id,
          documentId,
          title,
          topic,
          difficulty,
          questionType,
          questions: normalizedQuestions,
          createdAt,
        },
      });
    })
  );

  router.get(
    '/practice-quizzes/:id',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const lock = await store.getActiveExamAttemptLock(req.user!.id);
      if (lock) {
        res.status(403).json({
          error: `Practice quizzes are locked while "${lock.examTitle}" is in progress.`,
          activeExamId: lock.examId,
        });
        return;
      }
      const quiz = await store.findPracticeQuiz(String(req.params.id), req.user!.id);
      if (!quiz) {
        res.status(404).json({ error: 'Practice quiz not found.' });
        return;
      }
      res.json({ quiz });
    })
  );

  router.delete(
    '/practice-quizzes/:id',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const lock = await store.getActiveExamAttemptLock(req.user!.id);
      if (lock) {
        res.status(403).json({
          error: `Practice quizzes are locked while "${lock.examTitle}" is in progress.`,
          activeExamId: lock.examId,
        });
        return;
      }
      const deleted = await store.deletePracticeQuiz(String(req.params.id), req.user!.id);
      if (!deleted) {
        res.status(404).json({ error: 'Practice quiz not found.' });
        return;
      }
      res.json({ ok: true });
    })
  );

  router.post(
    '/practice-quizzes/:id/attempt',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const lock = await store.getActiveExamAttemptLock(req.user!.id);
      if (lock) {
        res.status(403).json({
          error: `Practice quiz submissions are locked while "${lock.examTitle}" is in progress.`,
          activeExamId: lock.examId,
        });
        return;
      }

      const quizRow = await store.findPracticeQuiz(String(req.params.id), req.user!.id);
      if (!quizRow) {
        res.status(404).json({ error: 'Practice quiz not found.' });
        return;
      }

      const questions = quizRow.questions;
      const answers = (req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {}) as Record<
        string,
        string
      >;

      const grading = gradeObjectiveQuestions(
        questions.map((q) => ({
          id: q.id,
          questionType: q.questionType,
          correctAnswer: q.correctAnswer || '',
          marks: q.marks || 2,
        })),
        answers
      );

      const objectiveTotal =
        grading.objectiveTotalMarks > 0 ? grading.objectiveTotalMarks : grading.totalPossibleMarks;
      const percentage =
        objectiveTotal > 0 ? Math.round((grading.objectiveScore / objectiveTotal) * 1000) / 10 : 0;

      const attemptId = `pa_${crypto.randomUUID()}`;
      const completedAt = new Date().toISOString();

      await store.createPracticeAttempt({
        id: attemptId,
        quizId: quizRow.id,
        studentId: req.user!.id,
        answers,
        score: grading.objectiveScore,
        totalMarks: objectiveTotal,
        percentage,
        completedAt,
      });

      res.locals.logDetails = `${quizRow.title}: ${grading.objectiveScore}/${objectiveTotal} (${percentage}%)`;
      res.json({
        attempt: {
          id: attemptId,
          score: grading.objectiveScore,
          totalMarks: objectiveTotal,
          percentage,
          hasDescriptiveQuestions: grading.hasDescriptiveQuestions,
          completedAt,
          breakdown: questions.map((q) => ({
            ...q,
            studentAnswer: answers[q.id] || '',
            isCorrect: grading.perQuestion[q.id]?.isCorrect ?? null,
            marksAwarded: grading.perQuestion[q.id]?.marksAwarded ?? null,
          })),
        },
      });
    })
  );

  // =========================================================================
  // OFFICIAL EXAM TAKING & ANTI-CHEAT (STUDENT)
  // =========================================================================
  router.get(
    '/exams/:examId/take',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const examId = String(req.params.examId);
      const studentId = req.user!.id;

      const exam = await store.findPublishedExamById(examId);
      if (!exam) {
        res.status(404).json({ error: 'Exam not found or not published yet.' });
        return;
      }

      if (!exam.assign_all) {
        const assigned = await store.isStudentAssigned(examId, studentId);
        if (!assigned) {
          res.status(403).json({ error: 'You are not assigned to this examination.' });
          return;
        }
      }

      let attempt = await store.findAttemptForExamStudent(examId, studentId);
      if (attempt && (attempt.status === 'submitted' || attempt.status === 'evaluated')) {
        res.json({ alreadySubmitted: true, attemptId: attempt.id });
        return;
      }

      if (!attempt) {
        if (exam.deadline_at && Date.now() > Date.parse(exam.deadline_at)) {
          res.status(403).json({ error: 'The deadline for starting this examination has passed.' });
          return;
        }
        const attemptId = `att_${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        const seed = crypto.randomBytes(8).toString('hex');
        attempt = {
          id: attemptId,
          exam_id: examId,
          student_id: studentId,
          status: 'in_progress',
          started_at: now,
          submitted_at: null,
          question_seed: seed,
          tab_switch_count: 0,
          focus_loss_count: 0,
          created_at: now,
        };
        await store.createExamAttempt(attempt);
      }

      const remainingSeconds = getRemainingSeconds(
        attempt.started_at,
        exam.duration_minutes,
        exam.deadline_at
      );

      const rawQuestions = await store.listExamQuestions(examId, true);
      const orderedQuestions = exam.randomize_questions
        ? seededShuffle(rawQuestions, `${attempt.question_seed}-questions`)
        : rawQuestions;

      const questionsForStudent: ExamTakeQuestion[] = orderedQuestions.map((q, idx) => {
        let options = Array.isArray(q.options) ? [...q.options] : [];
        if (options.length === 0 && q.question_type === 'true_false') {
          options = ['True', 'False'];
        }
        if (exam.randomize_options && q.question_type === 'mcq') {
          options = seededShuffle(options, `${attempt!.question_seed}-${q.id}`);
        }
        return {
          id: q.id,
          questionType: q.question_type,
          difficulty: q.difficulty,
          prompt: q.prompt,
          options,
          marks: q.marks,
          questionOrder: idx + 1,
        };
      });

      const savedAnswers = await store.listStudentAnswers(attempt.id);

      const payload: ExamAttemptSession = {
        attemptId: attempt.id,
        exam: {
          id: examId,
          title: exam.title,
          subject: exam.subject,
          instructions: exam.instructions,
          durationMinutes: exam.duration_minutes,
          totalMarks: exam.total_marks,
          passingMarks: exam.passing_marks,
          deadlineAt: exam.deadline_at,
          trackTabSwitches: exam.track_tab_switches,
          warnOnTabLeave: exam.warn_on_tab_leave,
          requireFullscreen: exam.require_fullscreen,
          blockCopyPaste: exam.block_copy_paste,
          maxTabSwitches: exam.max_tab_switches,
        },
        startedAt: attempt.started_at,
        remainingSeconds,
        tabSwitchCount: attempt.tab_switch_count,
        focusLossCount: attempt.focus_loss_count,
        questions: questionsForStudent,
        savedAnswers,
      };

      res.locals.logDetails = exam.title;
      res.json({ session: payload });
    })
  );

  router.patch(
    '/exams/attempts/:attemptId/answer',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const attemptId = String(req.params.attemptId);
      const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId.trim() : '';
      const answerValue = typeof req.body?.answer === 'string' ? req.body.answer : '';

      if (!questionId) {
        res.status(400).json({ error: 'Question ID is required.' });
        return;
      }

      const found = await store.findAttemptWithExamForStudent(attemptId, req.user!.id);
      if (!found) {
        res.status(404).json({ error: 'Exam attempt not found.' });
        return;
      }

      const { attempt, exam } = found;
      if (attempt.status !== 'in_progress') {
        res.status(409).json({ error: 'This exam attempt has already been submitted.' });
        return;
      }

      const withinWindow = isAttemptWithinSubmissionWindow(
        attempt.started_at,
        exam.duration_minutes,
        exam.deadline_at,
        Date.now(),
        15
      );

      if (!withinWindow) {
        res.status(403).json({ error: 'Exam duration has expired. Answer editing is locked.', expired: true });
        return;
      }

      const question = await store.findExamQuestion(questionId, attempt.exam_id);
      if (!question) {
        res.status(400).json({ error: 'Question does not belong to this exam.' });
        return;
      }

      const isObjective = question.question_type === 'mcq' || question.question_type === 'true_false';
      const now = new Date().toISOString();

      await store.upsertStudentAnswer({
        attemptId,
        questionId,
        answerText: isObjective ? '' : answerValue,
        selectedOption: isObjective ? answerValue : '',
        updatedAt: now,
      });

      res.json({ ok: true, updatedAt: now });
    })
  );

  router.post(
    '/exams/attempts/:attemptId/activity',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const attemptId = String(req.params.attemptId);
      const eventType = typeof req.body?.eventType === 'string' ? req.body.eventType.trim() : '';
      const details = typeof req.body?.details === 'string' ? req.body.details.trim().slice(0, 200) : '';

      const allowedEvents = new Set([
        'tab_hidden',
        'tab_visible',
        'window_blur',
        'fullscreen_exited',
        'copy_attempt_blocked',
        'paste_attempt_blocked',
        'context_menu_blocked',
        'shortcut_blocked',
        'warning_acknowledged',
      ]);
      if (!allowedEvents.has(eventType)) {
        res.status(400).json({ error: 'Unsupported activity event type.' });
        return;
      }

      const found = await store.findAttemptWithExamForStudent(attemptId, req.user!.id);
      if (!found || found.attempt.status !== 'in_progress') {
        res.json({ ok: true });
        return;
      }

      const { attempt, exam } = found;
      if (!exam.track_tab_switches && !exam.warn_on_tab_leave) {
        res.json({ ok: true });
        return;
      }

      const updated = await store.recordExamSecurityEvent({
        attemptId,
        examId: attempt.exam_id,
        studentId: req.user!.id,
        eventType,
        details: details || eventType,
        currentTabSwitchCount: attempt.tab_switch_count,
        currentFocusLossCount: attempt.focus_loss_count,
      });

      const autoSubmitted = shouldAutoSubmitForViolations(updated.tabSwitchCount, exam.max_tab_switches);
      if (autoSubmitted) {
        await store.finalizeAttemptSubmission(
          {
            id: attemptId,
            exam_id: attempt.exam_id,
            student_id: req.user!.id,
            total_marks: exam.total_marks,
            passing_marks: exam.passing_marks,
          },
          'auto_submitted_violation_limit',
          `Automatically submitted after reaching tab/lockdown limit (${updated.tabSwitchCount}/${exam.max_tab_switches})`
        );
      }

      res.locals.logDetails = `${exam.title}: ${eventType}`;
      res.json({
        ok: true,
        tabSwitchCount: updated.tabSwitchCount,
        focusLossCount: updated.focusLossCount,
        autoSubmitted,
        attemptId,
      });
    })
  );

  router.post(
    '/exams/attempts/:attemptId/submit',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const attemptId = String(req.params.attemptId);
      const found = await store.findAttemptWithExamForStudent(attemptId, req.user!.id);
      if (!found) {
        res.status(404).json({ error: 'Exam attempt not found.' });
        return;
      }

      const { attempt, exam } = found;
      if (attempt.status !== 'in_progress') {
        res.json({ ok: true, attemptId, alreadySubmitted: true });
        return;
      }

      const nowIso = new Date().toISOString();
      const withinWindow = isAttemptWithinSubmissionWindow(
        attempt.started_at,
        exam.duration_minutes,
        exam.deadline_at,
        Date.now(),
        45
      );

      const finalPayloadAnswers =
        withinWindow && req.body?.answers && typeof req.body.answers === 'object'
          ? (req.body.answers as Record<string, string>)
          : null;

      const examQuestions = await store.listExamQuestions(attempt.exam_id, false);
      if (finalPayloadAnswers) {
        for (const q of examQuestions) {
          if (typeof finalPayloadAnswers[q.id] === 'string') {
            const val = finalPayloadAnswers[q.id];
            const isObj = q.question_type === 'mcq' || q.question_type === 'true_false';
            await store.upsertStudentAnswer({
              attemptId,
              questionId: q.id,
              answerText: isObj ? '' : val,
              selectedOption: isObj ? val : '',
              updatedAt: nowIso,
            });
          }
        }
      } else if (!withinWindow) {
        await store.logSimpleActivityEvent({
          attemptId,
          examId: attempt.exam_id,
          studentId: req.user!.id,
          eventType: 'late_submission_blocked',
          details: 'Late submission payload ignored after timer expiration; graded saved answers.',
          createdAt: nowIso,
        });
      }

      const { attemptStatus } = await store.finalizeAttemptSubmission(
        {
          id: attemptId,
          exam_id: attempt.exam_id,
          student_id: req.user!.id,
          total_marks: exam.total_marks,
          passing_marks: exam.passing_marks,
        },
        'exam_submitted',
        withinWindow ? 'Submitted within allotted duration' : 'Finalized after timer expiration'
      );

      res.locals.logDetails = `${exam.title} (${attemptStatus})`;
      res.json({
        ok: true,
        attemptId,
        status: attemptStatus,
        withinWindow,
      });
    })
  );

  // =========================================================================
  // RESULTS & SUBMISSION DETAIL (STUDENT OWNER OR TEACHER OWNER ONLY)
  // =========================================================================
  router.get(
    '/results/:attemptId',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const attemptId = String(req.params.attemptId);
      const resultWrap = await store.getResultDetail(attemptId);
      if (!resultWrap) {
        res.status(404).json({ error: 'Exam result not found.' });
        return;
      }

      const isStudentOwner =
        req.user!.role === 'student' && resultWrap.detail.studentId === req.user!.id;
      const isTeacherOwner =
        req.user!.role === 'teacher' && resultWrap.teacherId === req.user!.id;

      if (!isStudentOwner && !isTeacherOwner) {
        res.status(403).json({ error: 'Access denied.' });
        return;
      }

      if (resultWrap.status === 'in_progress') {
        res.status(403).json({ error: 'Results and answers cannot be viewed before submitting the exam.' });
        return;
      }

      res.json({ result: resultWrap.detail });
    })
  );

  // =========================================================================
  // TEACHER TEACHING MODE
  // =========================================================================
  router.get(
    '/teacher/dashboard',
    requireAuth,
    requireRole('teacher'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const teacherId = req.user!.id;
      const [students, examsRows, submissions] = await Promise.all([
        store.listStudents(),
        store.listTeacherExams(teacherId),
        store.listTeacherSubmissions(teacherId),
      ]);

      const pendingEvaluations = submissions.filter((s) => s.attempt_status === 'submitted').length;
      const completedSubmissions = submissions.filter((s) => s.attempt_status === 'evaluated').length;

      const evaluatedPercentages = submissions
        .filter((s) => s.result_status === 'evaluated')
        .map((s) => Number(s.percentage));

      const classAverage =
        evaluatedPercentages.length > 0
          ? Math.round((evaluatedPercentages.reduce((a, b) => a + b, 0) / evaluatedPercentages.length) * 10) / 10
          : null;

      const passCount = submissions.filter((s) => s.result_status === 'evaluated' && Boolean(s.passed)).length;
      const passRate =
        evaluatedPercentages.length > 0 ? Math.round((passCount / evaluatedPercentages.length) * 1000) / 10 : null;

      res.json({
        stats: {
          totalStudents: students.length,
          totalExams: examsRows.length,
          pendingEvaluations,
          completedExams: completedSubmissions,
          classAverage,
          passRate,
        },
        students,
        exams: examsRows.map((e) => ({
          id: e.id,
          teacherId: e.teacher_id,
          title: e.title,
          subject: e.subject,
          instructions: e.instructions,
          durationMinutes: e.duration_minutes,
          totalMarks: e.total_marks,
          passingMarks: e.passing_marks,
          deadlineAt: e.deadline_at,
          status: e.status,
          randomizeQuestions: e.randomize_questions,
          randomizeOptions: e.randomize_options,
          trackTabSwitches: e.track_tab_switches,
          warnOnTabLeave: e.warn_on_tab_leave,
          requireFullscreen: e.require_fullscreen,
          blockCopyPaste: e.block_copy_paste,
          maxTabSwitches: e.max_tab_switches,
          assignAll: e.assign_all,
          questionCount: Number(e.question_count || 0),
          submissionCount: Number(e.submission_count || 0),
          pendingEvaluationCount: Number(e.pending_count || 0),
          createdAt: e.created_at,
        })),
        submissions: submissions.map((s) => ({
          attemptId: String(s.attempt_id),
          examId: String(s.exam_id),
          examTitle: String(s.exam_title),
          subject: String(s.subject),
          studentId: String(s.student_id),
          studentName: String(s.student_name),
          studentEmail: String(s.student_email),
          status: s.attempt_status as 'submitted' | 'evaluated',
          submittedAt: s.submitted_at ? String(s.submitted_at) : null,
          tabSwitchCount: Number(s.tab_switch_count || 0),
          focusLossCount: Number(s.focus_loss_count || 0),
          totalScore: Number(s.total_score || 0),
          totalMarks: Number(s.total_marks || 0),
          percentage: Number(s.percentage || 0),
          passed: Boolean(s.passed),
        })),
      });
    })
  );

  // Usage, Users & Request Audit Visibility (Teacher only)
  router.get(
    '/teacher/usage-logs',
    requireAuth,
    requireRole('teacher'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const overview = await store.getUsageOverview();
      res.json(overview);
    })
  );

  // Question Bank CRUD
  router.get(
    '/teacher/question-bank',
    requireAuth,
    requireRole('teacher'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const items = await store.listBankQuestions(req.user!.id);
      res.json({ questions: items });
    })
  );

  router.post(
    '/teacher/question-bank',
    requireAuth,
    requireRole('teacher'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const questionsInput = Array.isArray(req.body?.questions)
        ? (req.body.questions as QuizQuestion[])
        : req.body?.prompt
          ? [req.body as QuizQuestion]
          : [];

      if (questionsInput.length === 0) {
        res.status(400).json({ error: 'Provide at least one question to save to the Question Bank.' });
        return;
      }

      const documentId =
        typeof req.body?.documentId === 'string' && req.body.documentId ? req.body.documentId : null;

      if (documentId) {
        const doc = await store.findDocumentById(documentId);
        if (!doc || doc.userId !== req.user!.id) {
          res.status(403).json({ error: 'Referenced document not found or unauthorized.' });
          return;
        }
      }

      const savedIds = await store.createBankQuestions(req.user!.id, documentId, questionsInput);
      if (savedIds.length === 0) {
        res.status(400).json({ error: 'No valid questions found to save.' });
        return;
      }

      res.locals.logDetails = `Saved ${savedIds.length} question(s) to bank`;
      res.status(201).json({ savedCount: savedIds.length, ids: savedIds });
    })
  );

  router.delete(
    '/teacher/question-bank/:id',
    requireAuth,
    requireRole('teacher'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const deleted = await store.deleteBankQuestion(String(req.params.id), req.user!.id);
      if (!deleted) {
        res.status(404).json({ error: 'Question bank item not found.' });
        return;
      }
      res.json({ ok: true });
    })
  );

  // Create Official Exam
  router.post(
    '/teacher/exams',
    requireAuth,
    requireRole('teacher'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
      const instructions =
        typeof req.body?.instructions === 'string' && req.body.instructions.trim()
          ? req.body.instructions.trim()
          : 'Answer all questions carefully. Progress is saved automatically.';
      const durationMinutes = Number(req.body?.durationMinutes) || 30;
      const passingMarks = Number(req.body?.passingMarks);
      const deadlineAt =
        typeof req.body?.deadlineAt === 'string' && req.body.deadlineAt.trim() ? req.body.deadlineAt.trim() : null;
      const status = req.body?.publishNow ? ('published' as const) : ('draft' as const);
      const randomizeQuestions = req.body?.randomizeQuestions !== false;
      const randomizeOptions = req.body?.randomizeOptions !== false;
      const trackTabSwitches = req.body?.trackTabSwitches !== false;
      const warnOnTabLeave = req.body?.warnOnTabLeave !== false;
      const requireFullscreen = req.body?.requireFullscreen !== false;
      const blockCopyPaste = req.body?.blockCopyPaste !== false;
      const maxTabSwitchesRaw = Number(req.body?.maxTabSwitches);
      const maxTabSwitches = Number.isFinite(maxTabSwitchesRaw)
        ? Math.min(Math.max(0, Math.floor(maxTabSwitchesRaw)), 10)
        : 3;
      const assignAll = req.body?.assignAll !== false;
      const assignedStudentIds = Array.isArray(req.body?.assignedStudentIds)
        ? (req.body.assignedStudentIds as string[])
        : [];
      const questions = Array.isArray(req.body?.questions) ? (req.body.questions as QuizQuestion[]) : [];

      if (title.length < 3 || subject.length < 2) {
        res.status(400).json({ error: 'Exam title and subject are required.' });
        return;
      }
      if (durationMinutes < 1 || durationMinutes > 360) {
        res.status(400).json({ error: 'Duration must be between 1 and 360 minutes.' });
        return;
      }
      if (questions.length === 0) {
        res.status(400).json({ error: 'Add at least one question to the exam.' });
        return;
      }

      const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 2), 0);
      const safePassingMarks =
        Number.isFinite(passingMarks) && passingMarks >= 0 && passingMarks <= totalMarks
          ? passingMarks
          : Math.ceil(totalMarks * 0.5);

      const examId = `exam_${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      await store.createExam({
        id: examId,
        teacherId: req.user!.id,
        title,
        subject,
        instructions,
        durationMinutes,
        totalMarks,
        passingMarks: safePassingMarks,
        deadlineAt,
        status,
        randomizeQuestions,
        randomizeOptions,
        trackTabSwitches,
        warnOnTabLeave,
        requireFullscreen,
        blockCopyPaste,
        maxTabSwitches,
        assignAll,
        assignedStudentIds,
        questions,
        createdAt: now,
      });

      res.locals.logDetails = `${title} (${questions.length} questions, ${totalMarks} marks)`;
      res.status(201).json({ id: examId, totalMarks, status });
    })
  );

  router.post(
    '/teacher/exams/:id/publish',
    requireAuth,
    requireRole('teacher'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const examId = String(req.params.id);
      const nextStatus = req.body?.status === 'draft' ? 'draft' : 'published';
      const updated = await store.updateExamStatus(examId, req.user!.id, nextStatus);
      if (!updated) {
        res.status(404).json({ error: 'Exam not found.' });
        return;
      }
      res.json({ ok: true, status: nextStatus });
    })
  );

  router.post(
    '/teacher/exams/:id/assign',
    requireAuth,
    requireRole('teacher'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const examId = String(req.params.id);
      const assignAll = Boolean(req.body?.assignAll);
      const studentIds = Array.isArray(req.body?.studentIds) ? (req.body.studentIds as string[]) : [];
      const updated = await store.updateExamAssignments(examId, req.user!.id, assignAll, studentIds);
      if (!updated) {
        res.status(404).json({ error: 'Exam not found.' });
        return;
      }
      res.json({ ok: true });
    })
  );

  router.delete(
    '/teacher/exams/:id',
    requireAuth,
    requireRole('teacher'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const deleted = await store.deleteExam(String(req.params.id), req.user!.id);
      if (!deleted) {
        res.status(404).json({ error: 'Exam not found.' });
        return;
      }
      res.json({ ok: true });
    })
  );

  // Teacher Evaluation of Descriptive Answers
  router.post(
    '/teacher/attempts/:attemptId/evaluate',
    requireAuth,
    requireRole('teacher'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const attemptId = String(req.params.attemptId);
      const evaluations = Array.isArray(req.body?.evaluations)
        ? (req.body.evaluations as Array<{ questionId: string; marksAwarded: number; feedback: string }>)
        : [];

      const outcome = await store.saveTeacherEvaluations({
        attemptId,
        teacherId: req.user!.id,
        evaluations,
      });

      if ('error' in outcome) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }

      res.locals.logDetails = `Evaluated attempt (${outcome.totalScore} marks, ${outcome.percentage}%)`;
      res.json({
        ok: true,
        totalScore: outcome.totalScore,
        percentage: outcome.percentage,
        passed: outcome.passed,
      });
    })
  );

  router.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  return router;
}
