import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import {
  computeFinalResult,
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
  ExamResultDetail,
  ExamTakeQuestion,
  QuestionType,
  QuizQuestion,
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
import { db, hashPassword, verifyPassword } from './db.ts';
import { processUploadedDocument } from './documentProcessor.ts';
import { generateQuestionsWithGroq } from './groqService.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

export function createApiRouter(): express.Router {
  const router = express.Router();

  function getActiveExamAttemptLock(studentId: string): {
    attemptId: string;
    examId: string;
    examTitle: string;
  } | null {
    const row = db
      .prepare(
        `SELECT ea.id as attempt_id, ea.exam_id, e.title as exam_title
         FROM exam_attempts ea
         JOIN exams e ON e.id = ea.exam_id
         WHERE ea.student_id = ? AND ea.status = 'in_progress'
         LIMIT 1`
      )
      .get(studentId) as { attempt_id: string; exam_id: string; exam_title: string } | undefined;

    if (!row) return null;
    return {
      attemptId: row.attempt_id,
      examId: row.exam_id,
      examTitle: row.exam_title,
    };
  }

  function finalizeAttemptSubmission(
    attempt: {
      id: string;
      exam_id: string;
      student_id: string;
      total_marks: number;
      passing_marks: number;
    },
    logEventType: string,
    logDetails: string
  ): { attemptStatus: 'submitted' | 'evaluated' } {
    const nowIso = new Date().toISOString();
    const examQuestions = db
      .prepare('SELECT id, question_type, correct_answer, marks FROM questions WHERE exam_id = ?')
      .all(attempt.exam_id) as Array<{
      id: string;
      question_type: QuestionType;
      correct_answer: string;
      marks: number;
    }>;

    const savedRows = db
      .prepare('SELECT question_id, answer_text, selected_option FROM student_answers WHERE attempt_id = ?')
      .all(attempt.id) as Array<{ question_id: string; answer_text: string; selected_option: string }>;

    const answersMap: Record<string, string> = {};
    for (const r of savedRows) {
      answersMap[r.question_id] = r.selected_option || r.answer_text || '';
    }

    const grading = gradeObjectiveQuestions(
      examQuestions.map((q) => ({
        id: q.id,
        questionType: q.question_type,
        correctAnswer: q.correct_answer,
        marks: q.marks,
      })),
      answersMap
    );

    const updateAnswerGrade = db.prepare(
      'UPDATE student_answers SET is_correct = ?, marks_awarded = ? WHERE attempt_id = ? AND question_id = ?'
    );
    const ensureAnswerRow = db.prepare(
      `INSERT OR IGNORE INTO student_answers (id, attempt_id, question_id, answer_text, selected_option, is_correct, marks_awarded, updated_at)
       VALUES (?, ?, ?, '', '', ?, ?, ?)`
    );

    for (const q of examQuestions) {
      const resQ = grading.perQuestion[q.id];
      const isCorrectVal = resQ.isCorrect === null ? null : resQ.isCorrect ? 1 : 0;
      ensureAnswerRow.run(`ans_${crypto.randomUUID()}`, attempt.id, q.id, isCorrectVal, resQ.marksAwarded, nowIso);
      updateAnswerGrade.run(isCorrectVal, resQ.marksAwarded, attempt.id, q.id);
    }

    const resultStatus = grading.hasDescriptiveQuestions ? 'pending_evaluation' : 'evaluated';
    const attemptStatus = grading.hasDescriptiveQuestions ? 'submitted' : 'evaluated';
    const totalMarks = Number(attempt.total_marks);
    const passingMarks = Number(attempt.passing_marks);
    const computed = computeFinalResult(grading.objectiveScore, 0, totalMarks, passingMarks);

    db.prepare('UPDATE exam_attempts SET status = ?, submitted_at = ? WHERE id = ?').run(
      attemptStatus,
      nowIso,
      attempt.id
    );

    db.prepare(
      `INSERT OR IGNORE INTO results (id, attempt_id, exam_id, student_id, objective_score, descriptive_score, total_score, total_marks, percentage, passed, status, published_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
    ).run(
      `res_${crypto.randomUUID()}`,
      attempt.id,
      attempt.exam_id,
      attempt.student_id,
      grading.objectiveScore,
      computed.totalScore,
      totalMarks,
      computed.percentage,
      computed.passed ? 1 : 0,
      resultStatus,
      nowIso
    );

    db.prepare(
      `INSERT INTO activity_logs (id, attempt_id, exam_id, student_id, event_type, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(`log_${crypto.randomUUID()}`, attempt.id, attempt.exam_id, attempt.student_id, logEventType, logDetails, nowIso);

    return { attemptStatus };
  }

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      groqConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
    });
  });

  // =========================================================================
  // AUTHENTICATION
  // =========================================================================
  router.post('/auth/register', (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : '';

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

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const passwordHash = hashPassword(password);
    const role: UserRole = roleRaw;

    db.prepare(
      'INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, name, email, passwordHash, role, createdAt);

    const { token } = createSession(userId);
    setSessionCookie(req, res, token);

    res.status(201).json({
      user: { id: userId, name, email, role, createdAt },
      token,
    });
  });

  router.post('/auth/login', (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const row = db
      .prepare('SELECT id, name, email, password_hash, role, created_at FROM users WHERE email = ?')
      .get(email) as
      | { id: string; name: string; email: string; password_hash: string; role: UserRole; created_at: string }
      | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const { token } = createSession(row.id);
    setSessionCookie(req, res, token);

    res.json({
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        createdAt: row.created_at,
      },
      token,
    });
  });

  router.post('/auth/logout', (req: Request, res: Response) => {
    const { token } = extractRawToken(req);
    if (token) {
      deleteSessionByToken(token);
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  router.get('/auth/me', (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.user || null });
  });

  // =========================================================================
  // DOCUMENTS (PDF & DOCX FOR BOTH ROLES)
  // =========================================================================
  router.post('/documents/upload', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    if (req.user!.role === 'student') {
      const lock = getActiveExamAttemptLock(req.user!.id);
      if (lock) {
        res.status(403).json({
          error: `Document uploads are locked while "${lock.examTitle}" is in progress.`,
          activeExamId: lock.examId,
        });
        return;
      }
    }
    upload.single('file')(req, res, async (multerErr: unknown) => {
      if (multerErr) {
        if (multerErr instanceof multer.MulterError && multerErr.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ error: 'File exceeds the 10 MB upload limit.' });
          return;
        }
        res.status(400).json({ error: 'Failed to process file upload.' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No document file was attached.' });
        return;
      }

      try {
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

        db.prepare(
          `INSERT INTO documents (id, user_id, owner_role, title, original_filename, file_type, file_size, extracted_text, word_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          docId,
          req.user!.id,
          req.user!.role,
          customTitle,
          req.file.originalname,
          processed.fileType,
          req.file.size,
          processed.extractedText,
          processed.wordCount,
          createdAt
        );

        res.status(201).json({
          document: {
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
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to extract text from document.';
        res.status(400).json({ error: message });
      }
    });
  });

  router.get('/documents', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    if (req.user!.role === 'student') {
      const lock = getActiveExamAttemptLock(req.user!.id);
      if (lock) {
        res.status(403).json({
          error: `Study documents are locked while "${lock.examTitle}" is in progress.`,
          activeExamId: lock.examId,
        });
        return;
      }
    }
    const rows = db
      .prepare(
        `SELECT id, user_id, owner_role, title, original_filename, file_type, file_size, extracted_text, word_count, created_at
         FROM documents WHERE user_id = ? ORDER BY created_at DESC`
      )
      .all(req.user!.id) as Array<Record<string, unknown>>;

    res.json({
      documents: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        ownerRole: r.owner_role,
        title: r.title,
        originalFilename: r.original_filename,
        fileType: r.file_type,
        fileSize: r.file_size,
        extractedText: r.extracted_text,
        wordCount: r.word_count,
        createdAt: r.created_at,
      })),
    });
  });

  router.delete('/documents/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    if (req.user!.role === 'student') {
      const lock = getActiveExamAttemptLock(req.user!.id);
      if (lock) {
        res.status(403).json({
          error: `Document management is locked while "${lock.examTitle}" is in progress.`,
          activeExamId: lock.examId,
        });
        return;
      }
    }
    const docId = String(req.params.id);
    const result = db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(docId, req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Document not found or unauthorized.' });
      return;
    }
    res.json({ ok: true });
  });

  // =========================================================================
  // GROQ AI QUESTION GENERATION (SERVER-SIDE ONLY)
  // =========================================================================
  router.post('/ai/generate-questions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (req.user!.role === 'student') {
      const lock = getActiveExamAttemptLock(req.user!.id);
      if (lock) {
        db.prepare(
          `INSERT INTO activity_logs (id, attempt_id, exam_id, student_id, event_type, details, created_at)
           VALUES (?, ?, ?, ?, 'ai_access_blocked', ?, ?)`
        ).run(
          `log_${crypto.randomUUID()}`,
          lock.attemptId,
          lock.examId,
          req.user!.id,
          'Blocked attempt to use ExamAI AI question generator during active exam',
          new Date().toISOString()
        );
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

    const doc = db
      .prepare('SELECT id, user_id, title, extracted_text FROM documents WHERE id = ?')
      .get(documentId) as { id: string; user_id: string; title: string; extracted_text: string } | undefined;

    if (!doc || doc.user_id !== req.user!.id) {
      res.status(404).json({ error: 'Document not found or access denied.' });
      return;
    }

    if (!doc.extracted_text || doc.extracted_text.trim().length < 40) {
      res.status(400).json({ error: 'Selected document does not contain enough extracted text.' });
      return;
    }

    try {
      const questions = await generateQuestionsWithGroq({
        sourceText: doc.extracted_text,
        questionType: questionTypeRaw as QuestionType | 'mixed',
        difficulty: difficultyRaw as Difficulty,
        count,
        topic: topic || doc.title,
      });
      res.json({ questions });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate questions.';
      const status = msg.includes('GROQ_API_KEY is not configured') ? 503 : 502;
      res.status(status).json({ error: msg });
    }
  });

  // =========================================================================
  // STUDENT DASHBOARD & STUDY MODE
  // =========================================================================
  router.get('/student/dashboard', requireAuth, requireRole('student'), (req: AuthenticatedRequest, res: Response) => {
    const studentId = req.user!.id;

    const docsCount = (
      db.prepare('SELECT COUNT(*) as c FROM documents WHERE user_id = ?').get(studentId) as { c: number }
    ).c;

    const quizzes = db
      .prepare(
        `SELECT pq.*, pa.id as attempt_id, pa.score, pa.total_marks, pa.percentage, pa.completed_at
         FROM practice_quizzes pq
         LEFT JOIN practice_attempts pa ON pa.id = (
           SELECT id FROM practice_attempts WHERE quiz_id = pq.id AND student_id = ? ORDER BY completed_at DESC LIMIT 1
         )
         WHERE pq.student_id = ?
         ORDER BY pq.created_at DESC`
      )
      .all(studentId, studentId) as Array<Record<string, unknown>>;

    const practiceQuizzes = quizzes.map((q) => ({
      id: String(q.id),
      studentId: String(q.student_id),
      documentId: q.document_id ? String(q.document_id) : null,
      title: String(q.title),
      topic: String(q.topic),
      difficulty: q.difficulty as Difficulty,
      questionType: String(q.question_type),
      questions: JSON.parse(String(q.questions_json)) as QuizQuestion[],
      createdAt: String(q.created_at),
      lastAttempt: q.attempt_id
        ? {
            id: String(q.attempt_id),
            score: Number(q.score),
            totalMarks: Number(q.total_marks),
            percentage: Number(q.percentage),
            completedAt: String(q.completed_at),
          }
        : null,
    }));

    const examRows = db
      .prepare(
        `SELECT e.*, u.name as teacher_name,
          (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as question_count
         FROM exams e
         JOIN users u ON u.id = e.teacher_id
         LEFT JOIN exam_assignments ea ON ea.exam_id = e.id AND ea.student_id = ?
         WHERE e.status = 'published' AND (e.assign_all = 1 OR ea.student_id IS NOT NULL)
         ORDER BY e.created_at DESC`
      )
      .all(studentId) as Array<Record<string, unknown>>;

    const availableExams = [];
    const completedExams = [];

    for (const e of examRows) {
      const attempt = db
        .prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND student_id = ?')
        .get(String(e.id), studentId) as Record<string, unknown> | undefined;

      let resultRow: Record<string, unknown> | undefined;
      if (attempt) {
        resultRow = db
          .prepare('SELECT * FROM results WHERE attempt_id = ?')
          .get(String(attempt.id)) as Record<string, unknown> | undefined;
      }

      const summary = {
        id: String(e.id),
        teacherId: String(e.teacher_id),
        teacherName: String(e.teacher_name),
        title: String(e.title),
        subject: String(e.subject),
        instructions: String(e.instructions),
        durationMinutes: Number(e.duration_minutes),
        totalMarks: Number(e.total_marks),
        passingMarks: Number(e.passing_marks),
        deadlineAt: e.deadline_at ? String(e.deadline_at) : null,
        status: e.status as 'published',
        randomizeQuestions: Boolean(e.randomize_questions),
        randomizeOptions: Boolean(e.randomize_options),
        trackTabSwitches: Boolean(e.track_tab_switches),
        warnOnTabLeave: Boolean(e.warn_on_tab_leave),
        requireFullscreen: e.require_fullscreen !== undefined ? Boolean(e.require_fullscreen) : true,
        blockCopyPaste: e.block_copy_paste !== undefined ? Boolean(e.block_copy_paste) : true,
        maxTabSwitches: e.max_tab_switches !== undefined ? Number(e.max_tab_switches) : 3,
        assignAll: Boolean(e.assign_all),
        questionCount: Number(e.question_count),
        createdAt: String(e.created_at),
        studentAttempt: attempt
          ? {
              id: String(attempt.id),
              status: attempt.status as 'in_progress' | 'submitted' | 'evaluated',
              startedAt: String(attempt.started_at),
              submittedAt: attempt.submitted_at ? String(attempt.submitted_at) : null,
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

    const practiceAttempts = db
      .prepare(
        `SELECT pa.*, pq.title as quiz_title
         FROM practice_attempts pa
         JOIN practice_quizzes pq ON pq.id = pa.quiz_id
         WHERE pa.student_id = ?
         ORDER BY pa.completed_at DESC
         LIMIT 10`
      )
      .all(studentId) as Array<Record<string, unknown>>;

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
            (practiceAttempts.reduce((acc, a) => acc + Number(a.percentage), 0) / practiceAttempts.length) * 10
          ) / 10
        : null;

    const recentActivity = [
      ...practiceAttempts.slice(0, 4).map((pa) => ({
        id: String(pa.id),
        type: 'practice',
        title: `Completed practice quiz: ${String(pa.quiz_title)}`,
        detail: `${Number(pa.score)}/${Number(pa.total_marks)} marks (${Number(pa.percentage)}%)`,
        timestamp: String(pa.completed_at),
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

    const activeExamAttempt = getActiveExamAttemptLock(studentId);

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
  });

  router.post('/practice-quizzes', requireAuth, requireRole('student'), (req: AuthenticatedRequest, res: Response) => {
    const lock = getActiveExamAttemptLock(req.user!.id);
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
    const documentId = typeof req.body?.documentId === 'string' && req.body.documentId ? req.body.documentId : null;
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
      const doc = db.prepare('SELECT user_id FROM documents WHERE id = ?').get(documentId) as { user_id: string } | undefined;
      if (!doc || doc.user_id !== req.user!.id) {
        res.status(403).json({ error: 'Referenced document not found or unauthorized.' });
        return;
      }
    }

    const id = `pq_${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const normalizedQuestions = questions.map((q, idx) => ({
      ...q,
      id: q.id || `pq_item_${idx + 1}`,
      marks: Number(q.marks) || (q.questionType === 'long_answer' ? 10 : q.questionType === 'short_answer' ? 5 : q.questionType === 'true_false' ? 1 : 2),
    }));

    db.prepare(
      `INSERT INTO practice_quizzes (id, student_id, document_id, title, topic, difficulty, question_type, questions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.user!.id,
      documentId,
      title,
      topic,
      difficulty,
      questionType,
      JSON.stringify(normalizedQuestions),
      createdAt
    );

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
  });

  router.get('/practice-quizzes/:id', requireAuth, requireRole('student'), (req: AuthenticatedRequest, res: Response) => {
    const lock = getActiveExamAttemptLock(req.user!.id);
    if (lock) {
      res.status(403).json({
        error: `Practice quizzes are locked while "${lock.examTitle}" is in progress.`,
        activeExamId: lock.examId,
      });
      return;
    }
    const row = db
      .prepare('SELECT * FROM practice_quizzes WHERE id = ? AND student_id = ?')
      .get(String(req.params.id), req.user!.id) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Practice quiz not found.' });
      return;
    }

    res.json({
      quiz: {
        id: String(row.id),
        studentId: String(row.student_id),
        documentId: row.document_id ? String(row.document_id) : null,
        title: String(row.title),
        topic: String(row.topic),
        difficulty: row.difficulty,
        questionType: String(row.question_type),
        questions: JSON.parse(String(row.questions_json)),
        createdAt: String(row.created_at),
      },
    });
  });

  router.delete('/practice-quizzes/:id', requireAuth, requireRole('student'), (req: AuthenticatedRequest, res: Response) => {
    const lock = getActiveExamAttemptLock(req.user!.id);
    if (lock) {
      res.status(403).json({
        error: `Practice quizzes are locked while "${lock.examTitle}" is in progress.`,
        activeExamId: lock.examId,
      });
      return;
    }
    const result = db
      .prepare('DELETE FROM practice_quizzes WHERE id = ? AND student_id = ?')
      .run(String(req.params.id), req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Practice quiz not found.' });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/practice-quizzes/:id/attempt', requireAuth, requireRole('student'), (req: AuthenticatedRequest, res: Response) => {
    const lock = getActiveExamAttemptLock(req.user!.id);
    if (lock) {
      res.status(403).json({
        error: `Practice quiz submissions are locked while "${lock.examTitle}" is in progress.`,
        activeExamId: lock.examId,
      });
      return;
    }
    const quizRow = db
      .prepare('SELECT * FROM practice_quizzes WHERE id = ? AND student_id = ?')
      .get(String(req.params.id), req.user!.id) as Record<string, unknown> | undefined;

    if (!quizRow) {
      res.status(404).json({ error: 'Practice quiz not found.' });
      return;
    }

    const questions = JSON.parse(String(quizRow.questions_json)) as QuizQuestion[];
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

    const objectiveTotal = grading.objectiveTotalMarks > 0 ? grading.objectiveTotalMarks : grading.totalPossibleMarks;
    const percentage =
      objectiveTotal > 0 ? Math.round((grading.objectiveScore / objectiveTotal) * 1000) / 10 : 0;

    const attemptId = `pa_${crypto.randomUUID()}`;
    const completedAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO practice_attempts (id, quiz_id, student_id, answers_json, score, total_marks, percentage, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      attemptId,
      String(quizRow.id),
      req.user!.id,
      JSON.stringify(answers),
      grading.objectiveScore,
      objectiveTotal,
      percentage,
      completedAt
    );

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
  });

  // =========================================================================
  // OFFICIAL EXAM TAKING & ANTI-CHEAT (STUDENT)
  // =========================================================================
  router.get('/exams/:examId/take', requireAuth, requireRole('student'), (req: AuthenticatedRequest, res: Response) => {
    const examId = String(req.params.examId);
    const studentId = req.user!.id;

    const exam = db
      .prepare('SELECT * FROM exams WHERE id = ? AND status = ?')
      .get(examId, 'published') as Record<string, unknown> | undefined;

    if (!exam) {
      res.status(404).json({ error: 'Exam not found or not published yet.' });
      return;
    }

    if (!exam.assign_all) {
      const assigned = db
        .prepare('SELECT id FROM exam_assignments WHERE exam_id = ? AND student_id = ?')
        .get(examId, studentId);
      if (!assigned) {
        res.status(403).json({ error: 'You are not assigned to this examination.' });
        return;
      }
    }

    let attempt = db
      .prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND student_id = ?')
      .get(examId, studentId) as Record<string, unknown> | undefined;

    if (attempt && (attempt.status === 'submitted' || attempt.status === 'evaluated')) {
      res.json({
        alreadySubmitted: true,
        attemptId: String(attempt.id),
      });
      return;
    }

    if (!attempt) {
      if (exam.deadline_at && Date.now() > Date.parse(String(exam.deadline_at))) {
        res.status(403).json({ error: 'The deadline for starting this examination has passed.' });
        return;
      }
      const attemptId = `att_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const seed = crypto.randomBytes(8).toString('hex');
      db.prepare(
        `INSERT INTO exam_attempts (id, exam_id, student_id, status, started_at, question_seed, tab_switch_count, focus_loss_count, created_at)
         VALUES (?, ?, ?, 'in_progress', ?, ?, 0, 0, ?)`
      ).run(attemptId, examId, studentId, now, seed, now);

      db.prepare(
        `INSERT INTO activity_logs (id, attempt_id, exam_id, student_id, event_type, details, created_at)
         VALUES (?, ?, ?, ?, 'exam_started', ?, ?)`
      ).run(`log_${crypto.randomUUID()}`, attemptId, examId, studentId, 'Exam attempt started', now);

      attempt = db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(attemptId) as Record<string, unknown>;
    }

    const attemptId = String(attempt.id);
    const remainingSeconds = getRemainingSeconds(
      String(attempt.started_at),
      Number(exam.duration_minutes),
      exam.deadline_at ? String(exam.deadline_at) : null
    );

    const rawQuestions = db
      .prepare('SELECT * FROM questions WHERE exam_id = ? ORDER BY question_order ASC')
      .all(examId) as Array<Record<string, unknown>>;

    const orderedQuestions = exam.randomize_questions
      ? seededShuffle(rawQuestions, `${String(attempt.question_seed)}-questions`)
      : rawQuestions;

    const questionsForStudent: ExamTakeQuestion[] = orderedQuestions.map((q, idx) => {
      const qId = String(q.id);
      const qType = q.question_type as QuestionType;
      let options: string[] = [];

      if (qType === 'mcq' || qType === 'true_false') {
        const optRows = db
          .prepare('SELECT option_text FROM question_options WHERE question_id = ? ORDER BY option_order ASC')
          .all(qId) as Array<{ option_text: string }>;
        options = optRows.map((o) => o.option_text);
        if (options.length === 0 && qType === 'true_false') {
          options = ['True', 'False'];
        }
        if (exam.randomize_options && qType === 'mcq') {
          options = seededShuffle(options, `${String(attempt!.question_seed)}-${qId}`);
        }
      }

      // CRITICAL: Never send correct_answer, explanation, suggested_answer, or marking_guidance while taking exam
      return {
        id: qId,
        questionType: qType,
        difficulty: q.difficulty as Difficulty,
        prompt: String(q.prompt),
        options,
        marks: Number(q.marks),
        questionOrder: idx + 1,
      };
    });

    const answerRows = db
      .prepare('SELECT question_id, answer_text, selected_option FROM student_answers WHERE attempt_id = ?')
      .all(attemptId) as Array<{ question_id: string; answer_text: string; selected_option: string }>;

    const savedAnswers: Record<string, string> = {};
    for (const a of answerRows) {
      savedAnswers[a.question_id] = a.selected_option || a.answer_text || '';
    }

    const payload: ExamAttemptSession = {
      attemptId,
      exam: {
        id: examId,
        title: String(exam.title),
        subject: String(exam.subject),
        instructions: String(exam.instructions),
        durationMinutes: Number(exam.duration_minutes),
        totalMarks: Number(exam.total_marks),
        passingMarks: Number(exam.passing_marks),
        deadlineAt: exam.deadline_at ? String(exam.deadline_at) : null,
        trackTabSwitches: Boolean(exam.track_tab_switches),
        warnOnTabLeave: Boolean(exam.warn_on_tab_leave),
        requireFullscreen: exam.require_fullscreen !== undefined ? Boolean(exam.require_fullscreen) : true,
        blockCopyPaste: exam.block_copy_paste !== undefined ? Boolean(exam.block_copy_paste) : true,
        maxTabSwitches: exam.max_tab_switches !== undefined ? Number(exam.max_tab_switches) : 3,
      },
      startedAt: String(attempt.started_at),
      remainingSeconds,
      tabSwitchCount: Number(attempt.tab_switch_count),
      focusLossCount: Number(attempt.focus_loss_count),
      questions: questionsForStudent,
      savedAnswers,
    };

    res.json({ session: payload });
  });

  router.patch(
    '/exams/attempts/:attemptId/answer',
    requireAuth,
    requireRole('student'),
    (req: AuthenticatedRequest, res: Response) => {
      const attemptId = String(req.params.attemptId);
      const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId.trim() : '';
      const answerValue = typeof req.body?.answer === 'string' ? req.body.answer : '';

      if (!questionId) {
        res.status(400).json({ error: 'Question ID is required.' });
        return;
      }

      const attempt = db
        .prepare(
          `SELECT ea.*, e.duration_minutes, e.deadline_at
           FROM exam_attempts ea
           JOIN exams e ON e.id = ea.exam_id
           WHERE ea.id = ? AND ea.student_id = ?`
        )
        .get(attemptId, req.user!.id) as Record<string, unknown> | undefined;

      if (!attempt) {
        res.status(404).json({ error: 'Exam attempt not found.' });
        return;
      }

      if (attempt.status !== 'in_progress') {
        res.status(409).json({ error: 'This exam attempt has already been submitted.' });
        return;
      }

      const withinWindow = isAttemptWithinSubmissionWindow(
        String(attempt.started_at),
        Number(attempt.duration_minutes),
        attempt.deadline_at ? String(attempt.deadline_at) : null,
        Date.now(),
        15
      );

      if (!withinWindow) {
        res.status(403).json({ error: 'Exam duration has expired. Answer editing is locked.', expired: true });
        return;
      }

      const question = db
        .prepare('SELECT id, question_type FROM questions WHERE id = ? AND exam_id = ?')
        .get(questionId, String(attempt.exam_id)) as { id: string; question_type: QuestionType } | undefined;

      if (!question) {
        res.status(400).json({ error: 'Question does not belong to this exam.' });
        return;
      }

      const isObjective = question.question_type === 'mcq' || question.question_type === 'true_false';
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO student_answers (id, attempt_id, question_id, answer_text, selected_option, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id, question_id)
         DO UPDATE SET answer_text = excluded.answer_text, selected_option = excluded.selected_option, updated_at = excluded.updated_at`
      ).run(
        `ans_${crypto.randomUUID()}`,
        attemptId,
        questionId,
        isObjective ? '' : answerValue,
        isObjective ? answerValue : '',
        now
      );

      res.json({ ok: true, updatedAt: now });
    }
  );

  router.post(
    '/exams/attempts/:attemptId/activity',
    requireAuth,
    requireRole('student'),
    (req: AuthenticatedRequest, res: Response) => {
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

      const attempt = db
        .prepare(
          `SELECT ea.*, e.track_tab_switches, e.warn_on_tab_leave, e.max_tab_switches, e.total_marks, e.passing_marks
           FROM exam_attempts ea
           JOIN exams e ON e.id = ea.exam_id
           WHERE ea.id = ? AND ea.student_id = ?`
        )
        .get(attemptId, req.user!.id) as Record<string, unknown> | undefined;

      if (!attempt || attempt.status !== 'in_progress') {
        res.json({ ok: true });
        return;
      }

      if (!attempt.track_tab_switches && !attempt.warn_on_tab_leave) {
        res.json({ ok: true });
        return;
      }

      const now = new Date().toISOString();
      if (eventType === 'tab_hidden' || eventType === 'fullscreen_exited') {
        db.prepare('UPDATE exam_attempts SET tab_switch_count = tab_switch_count + 1 WHERE id = ?').run(attemptId);
      } else if (eventType === 'window_blur') {
        db.prepare('UPDATE exam_attempts SET focus_loss_count = focus_loss_count + 1 WHERE id = ?').run(attemptId);
      }

      db.prepare(
        `INSERT INTO activity_logs (id, attempt_id, exam_id, student_id, event_type, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `log_${crypto.randomUUID()}`,
        attemptId,
        String(attempt.exam_id),
        req.user!.id,
        eventType,
        details || eventType,
        now
      );

      const updated = db
        .prepare('SELECT tab_switch_count, focus_loss_count FROM exam_attempts WHERE id = ?')
        .get(attemptId) as { tab_switch_count: number; focus_loss_count: number };

      const maxTabSwitches = attempt.max_tab_switches !== undefined ? Number(attempt.max_tab_switches) : 3;
      const autoSubmitted = shouldAutoSubmitForViolations(updated.tab_switch_count, maxTabSwitches);

      if (autoSubmitted) {
        finalizeAttemptSubmission(
          {
            id: attemptId,
            exam_id: String(attempt.exam_id),
            student_id: req.user!.id,
            total_marks: Number(attempt.total_marks),
            passing_marks: Number(attempt.passing_marks),
          },
          'auto_submitted_violation_limit',
          `Automatically submitted after reaching tab/lockdown limit (${updated.tab_switch_count}/${maxTabSwitches})`
        );
      }

      res.json({
        ok: true,
        tabSwitchCount: updated.tab_switch_count,
        focusLossCount: updated.focus_loss_count,
        autoSubmitted,
        attemptId,
      });
    }
  );

  router.post(
    '/exams/attempts/:attemptId/submit',
    requireAuth,
    requireRole('student'),
    (req: AuthenticatedRequest, res: Response) => {
      const attemptId = String(req.params.attemptId);
      const attempt = db
        .prepare(
          `SELECT ea.*, e.duration_minutes, e.deadline_at, e.total_marks, e.passing_marks
           FROM exam_attempts ea
           JOIN exams e ON e.id = ea.exam_id
           WHERE ea.id = ? AND ea.student_id = ?`
        )
        .get(attemptId, req.user!.id) as Record<string, unknown> | undefined;

      if (!attempt) {
        res.status(404).json({ error: 'Exam attempt not found.' });
        return;
      }

      if (attempt.status !== 'in_progress') {
        res.json({ ok: true, attemptId, alreadySubmitted: true });
        return;
      }

      const nowIso = new Date().toISOString();
      const withinWindow = isAttemptWithinSubmissionWindow(
        String(attempt.started_at),
        Number(attempt.duration_minutes),
        attempt.deadline_at ? String(attempt.deadline_at) : null,
        Date.now(),
        45
      );

      // Only accept final answers payload if still within server-validated time window
      const finalPayloadAnswers =
        withinWindow && req.body?.answers && typeof req.body.answers === 'object'
          ? (req.body.answers as Record<string, string>)
          : null;

      const examQuestions = db
        .prepare('SELECT id, question_type, correct_answer, marks FROM questions WHERE exam_id = ?')
        .all(String(attempt.exam_id)) as Array<{
        id: string;
        question_type: QuestionType;
        correct_answer: string;
        marks: number;
      }>;

      if (finalPayloadAnswers) {
        const upsert = db.prepare(
          `INSERT INTO student_answers (id, attempt_id, question_id, answer_text, selected_option, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(attempt_id, question_id)
           DO UPDATE SET answer_text = excluded.answer_text, selected_option = excluded.selected_option, updated_at = excluded.updated_at`
        );
        for (const q of examQuestions) {
          if (typeof finalPayloadAnswers[q.id] === 'string') {
            const val = finalPayloadAnswers[q.id];
            const isObj = q.question_type === 'mcq' || q.question_type === 'true_false';
            upsert.run(`ans_${crypto.randomUUID()}`, attemptId, q.id, isObj ? '' : val, isObj ? val : '', nowIso);
          }
        }
      } else if (!withinWindow) {
        db.prepare(
          `INSERT INTO activity_logs (id, attempt_id, exam_id, student_id, event_type, details, created_at)
           VALUES (?, ?, ?, ?, 'late_submission_blocked', ?, ?)`
        ).run(
          `log_${crypto.randomUUID()}`,
          attemptId,
          String(attempt.exam_id),
          req.user!.id,
          'Late submission payload ignored after timer expiration; graded saved answers.',
          nowIso
        );
      }

      const { attemptStatus } = finalizeAttemptSubmission(
        {
          id: attemptId,
          exam_id: String(attempt.exam_id),
          student_id: req.user!.id,
          total_marks: Number(attempt.total_marks),
          passing_marks: Number(attempt.passing_marks),
        },
        'exam_submitted',
        withinWindow ? 'Submitted within allotted duration' : 'Finalized after timer expiration'
      );

      res.json({
        ok: true,
        attemptId,
        status: attemptStatus,
        withinWindow,
      });
    }
  );

  // =========================================================================
  // RESULTS & SUBMISSION DETAIL (STUDENT OWNER OR TEACHER OWNER ONLY)
  // =========================================================================
  router.get('/results/:attemptId', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const attemptId = String(req.params.attemptId);

    const row = db
      .prepare(
        `SELECT ea.*, e.title as exam_title, e.subject, e.teacher_id, e.passing_marks,
                u.name as student_name, u.email as student_email,
                r.objective_score, r.descriptive_score, r.total_score, r.total_marks, r.percentage, r.passed, r.status as result_status
         FROM exam_attempts ea
         JOIN exams e ON e.id = ea.exam_id
         JOIN users u ON u.id = ea.student_id
         LEFT JOIN results r ON r.attempt_id = ea.id
         WHERE ea.id = ?`
      )
      .get(attemptId) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Exam result not found.' });
      return;
    }

    const isStudentOwner = req.user!.role === 'student' && row.student_id === req.user!.id;
    const isTeacherOwner = req.user!.role === 'teacher' && row.teacher_id === req.user!.id;

    if (!isStudentOwner && !isTeacherOwner) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    if (row.status === 'in_progress') {
      res.status(403).json({ error: 'Results and answers cannot be viewed before submitting the exam.' });
      return;
    }

    const questions = db
      .prepare('SELECT * FROM questions WHERE exam_id = ? ORDER BY question_order ASC')
      .all(String(row.exam_id)) as Array<Record<string, unknown>>;

    const questionDetails = questions.map((q) => {
      const qId = String(q.id);
      const ans = db
        .prepare('SELECT * FROM student_answers WHERE attempt_id = ? AND question_id = ?')
        .get(attemptId, qId) as Record<string, unknown> | undefined;
      const evalRow = db
        .prepare('SELECT * FROM evaluations WHERE attempt_id = ? AND question_id = ?')
        .get(attemptId, qId) as Record<string, unknown> | undefined;
      const optRows = db
        .prepare('SELECT option_text FROM question_options WHERE question_id = ? ORDER BY option_order ASC')
        .all(qId) as Array<{ option_text: string }>;

      return {
        questionId: qId,
        questionType: q.question_type as QuestionType,
        difficulty: q.difficulty as Difficulty,
        prompt: String(q.prompt),
        options: optRows.map((o) => o.option_text),
        marks: Number(q.marks),
        studentAnswer: ans ? String(ans.selected_option || ans.answer_text || '') : '',
        correctAnswer: String(q.correct_answer || ''),
        explanation: String(q.explanation || ''),
        suggestedAnswer: String(q.suggested_answer || ''),
        markingGuidance: String(q.marking_guidance || ''),
        isCorrect: ans && ans.is_correct !== null ? Boolean(ans.is_correct) : null,
        marksAwarded:
          evalRow !== undefined
            ? Number(evalRow.marks_awarded)
            : ans && ans.marks_awarded !== null
              ? Number(ans.marks_awarded)
              : null,
        teacherFeedback: evalRow ? String(evalRow.feedback) : null,
      };
    });

    const logs = db
      .prepare('SELECT id, event_type, details, created_at FROM activity_logs WHERE attempt_id = ? ORDER BY created_at ASC')
      .all(attemptId) as Array<Record<string, unknown>>;

    const detail: ExamResultDetail = {
      attemptId,
      examId: String(row.exam_id),
      examTitle: String(row.exam_title),
      subject: String(row.subject),
      studentId: String(row.student_id),
      studentName: String(row.student_name),
      studentEmail: String(row.student_email),
      startedAt: String(row.started_at),
      submittedAt: row.submitted_at ? String(row.submitted_at) : null,
      status: (row.result_status as 'pending_evaluation' | 'evaluated') || 'pending_evaluation',
      objectiveScore: Number(row.objective_score || 0),
      descriptiveScore: Number(row.descriptive_score || 0),
      totalScore: Number(row.total_score || 0),
      totalMarks: Number(row.total_marks || 0),
      passingMarks: Number(row.passing_marks || 0),
      percentage: Number(row.percentage || 0),
      passed: Boolean(row.passed),
      tabSwitchCount: Number(row.tab_switch_count || 0),
      focusLossCount: Number(row.focus_loss_count || 0),
      questions: questionDetails,
      activityLogs: logs.map((l) => ({
        id: String(l.id),
        eventType: String(l.event_type),
        details: String(l.details),
        createdAt: String(l.created_at),
      })),
    };

    res.json({ result: detail });
  });

  // =========================================================================
  // TEACHER TEACHING MODE
  // =========================================================================
  router.get('/teacher/dashboard', requireAuth, requireRole('teacher'), (req: AuthenticatedRequest, res: Response) => {
    const teacherId = req.user!.id;

    const students = db
      .prepare("SELECT id, name, email, created_at FROM users WHERE role = 'student' ORDER BY name ASC")
      .all() as Array<{ id: string; name: string; email: string; created_at: string }>;

    const examsRows = db
      .prepare(
        `SELECT e.*,
          (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as question_count,
          (SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id = e.id AND ea.status IN ('submitted', 'evaluated')) as submission_count,
          (SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id = e.id AND ea.status = 'submitted') as pending_count
         FROM exams e
         WHERE e.teacher_id = ?
         ORDER BY e.created_at DESC`
      )
      .all(teacherId) as Array<Record<string, unknown>>;

    const submissions = db
      .prepare(
        `SELECT ea.id as attempt_id, ea.exam_id, ea.student_id, ea.status as attempt_status, ea.submitted_at, ea.tab_switch_count, ea.focus_loss_count,
                e.title as exam_title, e.subject, e.passing_marks,
                u.name as student_name, u.email as student_email,
                r.objective_score, r.descriptive_score, r.total_score, r.total_marks, r.percentage, r.passed, r.status as result_status
         FROM exam_attempts ea
         JOIN exams e ON e.id = ea.exam_id
         JOIN users u ON u.id = ea.student_id
         LEFT JOIN results r ON r.attempt_id = ea.id
         WHERE e.teacher_id = ? AND ea.status IN ('submitted', 'evaluated')
         ORDER BY ea.submitted_at DESC`
      )
      .all(teacherId) as Array<Record<string, unknown>>;

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
        id: String(e.id),
        teacherId: String(e.teacher_id),
        title: String(e.title),
        subject: String(e.subject),
        instructions: String(e.instructions),
        durationMinutes: Number(e.duration_minutes),
        totalMarks: Number(e.total_marks),
        passingMarks: Number(e.passing_marks),
        deadlineAt: e.deadline_at ? String(e.deadline_at) : null,
        status: e.status as 'draft' | 'published',
        randomizeQuestions: Boolean(e.randomize_questions),
        randomizeOptions: Boolean(e.randomize_options),
        trackTabSwitches: Boolean(e.track_tab_switches),
        warnOnTabLeave: Boolean(e.warn_on_tab_leave),
        requireFullscreen: e.require_fullscreen !== undefined ? Boolean(e.require_fullscreen) : true,
        blockCopyPaste: e.block_copy_paste !== undefined ? Boolean(e.block_copy_paste) : true,
        maxTabSwitches: e.max_tab_switches !== undefined ? Number(e.max_tab_switches) : 3,
        assignAll: Boolean(e.assign_all),
        questionCount: Number(e.question_count),
        submissionCount: Number(e.submission_count),
        pendingEvaluationCount: Number(e.pending_count),
        createdAt: String(e.created_at),
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
  });

  // Question Bank CRUD
  router.get('/teacher/question-bank', requireAuth, requireRole('teacher'), (req: AuthenticatedRequest, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM question_bank WHERE teacher_id = ? ORDER BY created_at DESC')
      .all(req.user!.id) as Array<Record<string, unknown>>;

    const items = rows.map((r) => {
      const opts = db
        .prepare('SELECT option_text FROM question_options WHERE bank_question_id = ? ORDER BY option_order ASC')
        .all(String(r.id)) as Array<{ option_text: string }>;
      return {
        id: String(r.id),
        questionType: r.question_type as QuestionType,
        difficulty: r.difficulty as Difficulty,
        topic: String(r.topic),
        prompt: String(r.prompt),
        options: opts.map((o) => o.option_text),
        correctAnswer: String(r.correct_answer || ''),
        explanation: String(r.explanation || ''),
        suggestedAnswer: String(r.suggested_answer || ''),
        markingGuidance: String(r.marking_guidance || ''),
        marks: Number(r.marks),
        createdAt: String(r.created_at),
      };
    });

    res.json({ questions: items });
  });

  router.post('/teacher/question-bank', requireAuth, requireRole('teacher'), (req: AuthenticatedRequest, res: Response) => {
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
      const doc = db.prepare('SELECT user_id FROM documents WHERE id = ?').get(documentId) as { user_id: string } | undefined;
      if (!doc || doc.user_id !== req.user!.id) {
        res.status(403).json({ error: 'Referenced document not found or unauthorized.' });
        return;
      }
    }

    const now = new Date().toISOString();
    const insertBank = db.prepare(
      `INSERT INTO question_bank (id, teacher_id, document_id, question_type, difficulty, topic, prompt, correct_answer, explanation, suggested_answer, marking_guidance, marks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertOpt = db.prepare(
      `INSERT INTO question_options (id, question_id, bank_question_id, option_text, option_order, is_correct)
       VALUES (?, NULL, ?, ?, ?, ?)`
    );

    const savedIds: string[] = [];
    for (const q of questionsInput) {
      const prompt = String(q.prompt || '').trim();
      if (prompt.length < 5) continue;

      const id = `qb_${crypto.randomUUID()}`;
      const qType = q.questionType || 'mcq';
      const difficulty = q.difficulty || 'Medium';
      const marks =
        Number(q.marks) || (qType === 'long_answer' ? 10 : qType === 'short_answer' ? 5 : qType === 'true_false' ? 1 : 2);

      insertBank.run(
        id,
        req.user!.id,
        documentId,
        qType,
        difficulty,
        String(q.topic || 'General').trim(),
        prompt,
        String(q.correctAnswer || '').trim(),
        String(q.explanation || '').trim(),
        String(q.suggestedAnswer || '').trim(),
        String(q.markingGuidance || '').trim(),
        marks,
        now
      );

      const opts =
        qType === 'true_false'
          ? ['True', 'False']
          : Array.isArray(q.options)
            ? q.options.map((o) => String(o).trim()).filter(Boolean)
            : [];

      opts.forEach((optText, idx) => {
        insertOpt.run(
          `opt_${crypto.randomUUID()}`,
          id,
          optText,
          idx,
          optText.toLowerCase() === String(q.correctAnswer || '').trim().toLowerCase() ? 1 : 0
        );
      });

      savedIds.push(id);
    }

    if (savedIds.length === 0) {
      res.status(400).json({ error: 'No valid questions found to save.' });
      return;
    }

    res.status(201).json({ savedCount: savedIds.length, ids: savedIds });
  });

  router.delete('/teacher/question-bank/:id', requireAuth, requireRole('teacher'), (req: AuthenticatedRequest, res: Response) => {
    const result = db
      .prepare('DELETE FROM question_bank WHERE id = ? AND teacher_id = ?')
      .run(String(req.params.id), req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Question bank item not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // Create Official Exam
  router.post('/teacher/exams', requireAuth, requireRole('teacher'), (req: AuthenticatedRequest, res: Response) => {
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
    const status = req.body?.publishNow ? 'published' : 'draft';
    const randomizeQuestions = req.body?.randomizeQuestions !== false ? 1 : 0;
    const randomizeOptions = req.body?.randomizeOptions !== false ? 1 : 0;
    const trackTabSwitches = req.body?.trackTabSwitches !== false ? 1 : 0;
    const warnOnTabLeave = req.body?.warnOnTabLeave !== false ? 1 : 0;
    const requireFullscreen = req.body?.requireFullscreen !== false ? 1 : 0;
    const blockCopyPaste = req.body?.blockCopyPaste !== false ? 1 : 0;
    const maxTabSwitchesRaw = Number(req.body?.maxTabSwitches);
    const maxTabSwitches = Number.isFinite(maxTabSwitchesRaw)
      ? Math.min(Math.max(0, Math.floor(maxTabSwitchesRaw)), 10)
      : 3;
    const assignAll = req.body?.assignAll !== false ? 1 : 0;
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

    db.prepare(
      `INSERT INTO exams (id, teacher_id, title, subject, instructions, duration_minutes, total_marks, passing_marks, deadline_at, status, randomize_questions, randomize_options, track_tab_switches, warn_on_tab_leave, require_fullscreen, block_copy_paste, max_tab_switches, assign_all, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      examId,
      req.user!.id,
      title,
      subject,
      instructions,
      durationMinutes,
      totalMarks,
      safePassingMarks,
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
      now
    );

    const insertQ = db.prepare(
      `INSERT INTO questions (id, exam_id, bank_question_id, question_type, difficulty, prompt, correct_answer, explanation, suggested_answer, marking_guidance, marks, question_order)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertOpt = db.prepare(
      `INSERT INTO question_options (id, question_id, bank_question_id, option_text, option_order, is_correct)
       VALUES (?, ?, NULL, ?, ?, ?)`
    );

    questions.forEach((q, idx) => {
      const qId = `eq_${crypto.randomUUID()}`;
      const qType = q.questionType || 'mcq';
      const marks = Number(q.marks) || 2;
      insertQ.run(
        qId,
        examId,
        qType,
        q.difficulty || 'Medium',
        String(q.prompt).trim(),
        String(q.correctAnswer || '').trim(),
        String(q.explanation || '').trim(),
        String(q.suggestedAnswer || '').trim(),
        String(q.markingGuidance || '').trim(),
        marks,
        idx + 1
      );

      const opts =
        qType === 'true_false'
          ? ['True', 'False']
          : Array.isArray(q.options)
            ? q.options.map((o) => String(o).trim()).filter(Boolean)
            : [];

      opts.forEach((optText, oIdx) => {
        insertOpt.run(
          `opt_${crypto.randomUUID()}`,
          qId,
          optText,
          oIdx,
          optText.toLowerCase() === String(q.correctAnswer || '').trim().toLowerCase() ? 1 : 0
        );
      });
    });

    if (!assignAll && assignedStudentIds.length > 0) {
      const insertAssign = db.prepare(
        'INSERT OR IGNORE INTO exam_assignments (id, exam_id, student_id, assigned_at) VALUES (?, ?, ?, ?)'
      );
      for (const sid of assignedStudentIds) {
        insertAssign.run(`asg_${crypto.randomUUID()}`, examId, sid, now);
      }
    }

    res.status(201).json({ id: examId, totalMarks, status });
  });

  router.post('/teacher/exams/:id/publish', requireAuth, requireRole('teacher'), (req: AuthenticatedRequest, res: Response) => {
    const examId = String(req.params.id);
    const nextStatus = req.body?.status === 'draft' ? 'draft' : 'published';
    const result = db
      .prepare('UPDATE exams SET status = ? WHERE id = ? AND teacher_id = ?')
      .run(nextStatus, examId, req.user!.id);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Exam not found.' });
      return;
    }
    res.json({ ok: true, status: nextStatus });
  });

  router.post('/teacher/exams/:id/assign', requireAuth, requireRole('teacher'), (req: AuthenticatedRequest, res: Response) => {
    const examId = String(req.params.id);
    const exam = db
      .prepare('SELECT id FROM exams WHERE id = ? AND teacher_id = ?')
      .get(examId, req.user!.id);
    if (!exam) {
      res.status(404).json({ error: 'Exam not found.' });
      return;
    }

    const assignAll = Boolean(req.body?.assignAll);
    const studentIds = Array.isArray(req.body?.studentIds) ? (req.body.studentIds as string[]) : [];

    db.prepare('UPDATE exams SET assign_all = ? WHERE id = ?').run(assignAll ? 1 : 0, examId);
    db.prepare('DELETE FROM exam_assignments WHERE exam_id = ?').run(examId);

    if (!assignAll && studentIds.length > 0) {
      const now = new Date().toISOString();
      const insertAssign = db.prepare(
        'INSERT OR IGNORE INTO exam_assignments (id, exam_id, student_id, assigned_at) VALUES (?, ?, ?, ?)'
      );
      for (const sid of studentIds) {
        insertAssign.run(`asg_${crypto.randomUUID()}`, examId, sid, now);
      }
    }

    res.json({ ok: true });
  });

  router.delete('/teacher/exams/:id', requireAuth, requireRole('teacher'), (req: AuthenticatedRequest, res: Response) => {
    const result = db
      .prepare('DELETE FROM exams WHERE id = ? AND teacher_id = ?')
      .run(String(req.params.id), req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Exam not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // Teacher Evaluation of Descriptive Answers
  router.post(
    '/teacher/attempts/:attemptId/evaluate',
    requireAuth,
    requireRole('teacher'),
    (req: AuthenticatedRequest, res: Response) => {
      const attemptId = String(req.params.attemptId);
      const evaluations = Array.isArray(req.body?.evaluations)
        ? (req.body.evaluations as Array<{ questionId: string; marksAwarded: number; feedback: string }>)
        : [];

      const row = db
        .prepare(
          `SELECT ea.id, ea.exam_id, ea.status, e.teacher_id, e.total_marks, e.passing_marks
           FROM exam_attempts ea
           JOIN exams e ON e.id = ea.exam_id
           WHERE ea.id = ?`
        )
        .get(attemptId) as
        | { id: string; exam_id: string; status: string; teacher_id: string; total_marks: number; passing_marks: number }
        | undefined;

      if (!row || row.teacher_id !== req.user!.id) {
        res.status(404).json({ error: 'Submission not found or unauthorized.' });
        return;
      }

      if (row.status === 'in_progress') {
        res.status(400).json({ error: 'Cannot evaluate an attempt that has not been submitted yet.' });
        return;
      }

      const now = new Date().toISOString();
      const upsertEval = db.prepare(
        `INSERT INTO evaluations (id, attempt_id, question_id, teacher_id, marks_awarded, feedback, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id, question_id)
         DO UPDATE SET marks_awarded = excluded.marks_awarded, feedback = excluded.feedback, evaluated_at = excluded.evaluated_at`
      );
      const updateAnsMarks = db.prepare(
        'UPDATE student_answers SET marks_awarded = ? WHERE attempt_id = ? AND question_id = ?'
      );

      for (const ev of evaluations) {
        const q = db
          .prepare('SELECT id, marks FROM questions WHERE id = ? AND exam_id = ?')
          .get(ev.questionId, row.exam_id) as { id: string; marks: number } | undefined;
        if (!q) continue;

        const clampedMarks = Math.min(Math.max(0, Number(ev.marksAwarded) || 0), q.marks);
        upsertEval.run(
          `eval_${crypto.randomUUID()}`,
          attemptId,
          q.id,
          req.user!.id,
          clampedMarks,
          String(ev.feedback || '').trim(),
          now
        );
        updateAnsMarks.run(clampedMarks, attemptId, q.id);
      }

      const objectiveRow = db
        .prepare(
          `SELECT COALESCE(SUM(sa.marks_awarded), 0) as score
           FROM student_answers sa
           JOIN questions q ON q.id = sa.question_id
           WHERE sa.attempt_id = ? AND q.question_type IN ('mcq', 'true_false')`
        )
        .get(attemptId) as { score: number };

      const descriptiveRow = db
        .prepare(
          `SELECT COALESCE(SUM(ev.marks_awarded), 0) as score
           FROM evaluations ev
           JOIN questions q ON q.id = ev.question_id
           WHERE ev.attempt_id = ? AND q.question_type IN ('short_answer', 'long_answer')`
        )
        .get(attemptId) as { score: number };

      const computed = computeFinalResult(
        Number(objectiveRow.score),
        Number(descriptiveRow.score),
        row.total_marks,
        row.passing_marks
      );

      db.prepare("UPDATE exam_attempts SET status = 'evaluated' WHERE id = ?").run(attemptId);
      db.prepare(
        `UPDATE results
         SET objective_score = ?, descriptive_score = ?, total_score = ?, percentage = ?, passed = ?, status = 'evaluated', published_at = ?
         WHERE attempt_id = ?`
      ).run(
        Number(objectiveRow.score),
        Number(descriptiveRow.score),
        computed.totalScore,
        computed.percentage,
        computed.passed ? 1 : 0,
        now,
        attemptId
      );

      res.json({
        ok: true,
        totalScore: computed.totalScore,
        percentage: computed.percentage,
        passed: computed.passed,
      });
    }
  );

  return router;
}
