import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
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
  AccountStatus,
  Difficulty,
  ExamAttemptSession,
  ExamTakeQuestion,
  QuestionType,
  QuizQuestion,
  TeacherApprovalStatus,
  UserProfile,
  UserRole,
} from '../src/types/index.ts';
import {
  clearSessionCookie,
  createSession,
  deleteSessionByToken,
  extractRawToken,
  requireApprovedTeacher,
  requireAuth,
  requireRole,
  setSessionCookie,
  type AuthenticatedRequest,
} from './auth.ts';
import { processUploadedDocument } from './documentProcessor.ts';
import { domainStore } from './domainStore.ts';
import { explainQuestionConceptWithGroq, generateQuestionsWithGroq, getAiAvailability } from './groqService.ts';
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

function createRateLimiter(maxRequests: number, windowMs: number, message: string): RequestHandler {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : Array.isArray(forwarded)
          ? forwarded[0] || 'unknown'
          : req.ip || 'unknown';
    const key = `${clientIp}:${req.path}`;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      res.status(429).json({ error: message });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 500) {
      for (const [k, list] of hits.entries()) {
        if (list.every((ts) => now - ts >= windowMs)) {
          hits.delete(k);
        }
      }
    }
    next();
  };
}

const authRateLimiter = createRateLimiter(
  30,
  10 * 60 * 1000,
  'Too many authentication attempts. Please wait a few minutes.'
);
const aiRateLimiter = createRateLimiter(
  30,
  5 * 60 * 1000,
  'AI request rate limit reached. Please wait a moment before generating again.'
);

function hashResetToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function describeApiAction(method: string, reqPath: string): string {
  const clean = reqPath.replace(/^\/+/, '');
  if (clean === 'auth/register') return 'User Registration';
  if (clean === 'auth/claim-admin') return 'Claim First Admin';
  if (clean === 'auth/demo-login') return 'Demo Workspace Login';
  if (clean === 'auth/login') return 'User Login';
  if (clean === 'auth/logout') return 'User Logout';
  if (clean === 'auth/forgot-password') return 'Request Password Reset';
  if (clean === 'auth/reset-password') return 'Complete Password Reset';
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
  if (clean.startsWith('results/') && clean.endsWith('/explain')) return 'AI Post-Exam Concept Explanation';
  if (clean.startsWith('results/')) return 'View Exam Result';
  if (clean.startsWith('student/classes')) return `${method} Student Class Membership`;
  if (clean === 'student/progress') return 'View Student Progress';
  if (clean.startsWith('teacher/classes')) return `${method} Teacher Class`;
  if (clean === 'teacher/exams' && method === 'POST') return 'Create Official Exam';
  if (clean.startsWith('teacher/exams/') && clean.endsWith('/publish')) return 'Update Exam Publish Status';
  if (clean.startsWith('teacher/exams/') && clean.endsWith('/assign')) return 'Update Exam Assignments';
  if (clean.startsWith('teacher/question-bank')) return `${method} Question Bank`;
  if (clean.includes('/evaluate')) return 'Evaluate Student Submission';
  if (clean.startsWith('admin/')) return `Admin: ${method} /api/${clean}`;
  if (clean === 'student/dashboard') return 'Student Dashboard Load';
  if (clean === 'teacher/dashboard') return 'Teacher Dashboard Load';
  return `${method} /api/${clean}`;
}

function shouldLogRequest(method: string, reqPath: string): boolean {
  if (
    reqPath === '/health' ||
    reqPath === '/auth/me' ||
    reqPath === '/auth/public-config' ||
    reqPath === '/auth/admin-bootstrap-status' ||
    reqPath === '/admin/audit-logs' ||
    reqPath === '/admin/overview'
  ) {
    return false;
  }
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
  // PUBLIC AUTH CONFIG & ADMIN BOOTSTRAP STATUS
  // =========================================================================
  router.get(
    '/auth/public-config',
    asyncHandler(async (_req: Request, res: Response) => {
      const [supa, settings] = await Promise.all([
        Promise.resolve(store.getSupabasePublicConfig()),
        domainStore.getPlatformSettings(),
      ]);
      res.json({
        supabaseUrl: supa.url,
        supabaseAnonKey: supa.anonKey,
        allowTeacherRegistration: settings.allowTeacherRegistration,
        requireTeacherApproval: settings.requireTeacherApproval,
        allowPublicPractice: settings.allowPublicPractice,
        allowDemoLogin: process.env.DISABLE_DEMO_LOGIN !== 'true',
      });
    })
  );

  router.get(
    '/auth/admin-bootstrap-status',
    asyncHandler(async (_req: Request, res: Response) => {
      const adminCount = await domainStore.countAdminUsers();
      const secretConfigured = Boolean((process.env.ADMIN_BOOTSTRAP_SECRET || '').trim());
      res.json({
        adminCount,
        canClaimFirstAdmin: adminCount === 0,
        secretConfigured,
      });
    })
  );

  // =========================================================================
  // AUTHENTICATION (STUDENT, TEACHER & CONTROLLED ADMIN)
  // =========================================================================
  router.post(
    '/auth/register',
    authRateLimiter,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : '';
      const institution = typeof req.body?.institution === 'string' ? req.body.institution.trim().slice(0, 120) : '';
      const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim().slice(0, 120) : '';
      const bio = typeof req.body?.bio === 'string' ? req.body.bio.trim().slice(0, 800) : '';
      const setupSecret = typeof req.body?.setupSecret === 'string' ? req.body.setupSecret.trim() : '';

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
      if (roleRaw !== 'student' && roleRaw !== 'teacher' && roleRaw !== 'admin') {
        res.status(400).json({ error: 'Role must be student, teacher, or admin.' });
        return;
      }

      const settings = await domainStore.getPlatformSettings();

      if (roleRaw === 'admin') {
        const adminCount = await domainStore.countAdminUsers();
        const userId = `usr_${crypto.randomUUID()}`;
        const createdAt = new Date().toISOString();
        const passwordHash = hashPassword(password);

        if (adminCount === 0) {
          const claimed = await domainStore.claimInitialAdmin({
            id: userId,
            name,
            email,
            passwordHash,
            institution,
            createdAt,
          });
          if (!claimed.ok) {
            res.status(claimed.status).json({ error: claimed.error });
            return;
          }
          await store.touchUserLastLogin(claimed.user.id);
          const { token } = await createSession(claimed.user.id);
          setSessionCookie(req, res, token);
          res.locals.loggedUser = claimed.user;
          res.locals.logDetails = 'Claimed first Admin account';
          res.status(201).json({ user: claimed.user, token });
          return;
        }

        const expectedSecret = (process.env.ADMIN_BOOTSTRAP_SECRET || '').trim();
        if (!expectedSecret) {
          res.status(403).json({
            error:
              'An Admin account already exists and ADMIN_BOOTSTRAP_SECRET is not configured on the server. Ask an existing Admin to create your Admin account.',
          });
          return;
        }

        const aBuf = Buffer.from(setupSecret);
        const bBuf = Buffer.from(expectedSecret);
        const secretValid = aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
        if (!secretValid) {
          res.status(403).json({ error: 'Invalid Admin Setup Secret.' });
          return;
        }

        const existing = await store.findUserByEmail(email);
        if (existing) {
          res.status(409).json({ error: 'An account with this email already exists.' });
          return;
        }

        await store.createUser({
          id: userId,
          name,
          email,
          password_hash: passwordHash,
          role: 'admin',
          institution: institution || 'ExamAI Administration',
          account_status: 'active',
          created_at: createdAt,
        });
        await store.touchUserLastLogin(userId);
        await domainStore.recordAdminAuditLog({
          adminId: userId,
          action: 'register_admin_with_secret',
          targetType: 'user',
          targetId: userId,
          details: `Registered admin (${email}) using server setup secret`,
        });

        const user = (await store.findUserById(userId))!;
        const { token } = await createSession(userId);
        setSessionCookie(req, res, token);
        res.locals.loggedUser = user;
        res.locals.logDetails = 'Registered new Admin account';
        res.status(201).json({ user, token });
        return;
      }

      if (roleRaw === 'teacher' && !settings.allowTeacherRegistration) {
        res.status(403).json({ error: 'Self-service teacher registration is currently disabled by administrator.' });
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
      const approvalStatus: TeacherApprovalStatus =
        role === 'teacher' ? (settings.requireTeacherApproval ? 'pending' : 'approved') : 'approved';

      await store.createUser(
        {
          id: userId,
          name,
          email,
          password_hash: passwordHash,
          role,
          institution,
          account_status: 'active',
          created_at: createdAt,
        },
        role === 'teacher'
          ? {
              subject,
              bio,
              approvalStatus,
            }
          : undefined
      );
      await store.touchUserLastLogin(userId);

      const user = (await store.findUserById(userId))!;
      const { token } = await createSession(userId);
      setSessionCookie(req, res, token);

      res.locals.loggedUser = user;
      res.locals.logDetails =
        role === 'teacher'
          ? `Registered teacher account (approval: ${approvalStatus})`
          : 'Registered new student account';

      res.status(201).json({ user, token });
    })
  );

  router.post(
    '/auth/claim-admin',
    authRateLimiter,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const institution = typeof req.body?.institution === 'string' ? req.body.institution.trim().slice(0, 120) : '';

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

      const userId = `usr_${crypto.randomUUID()}`;
      const claimed = await domainStore.claimInitialAdmin({
        id: userId,
        name,
        email,
        passwordHash: hashPassword(password),
        institution,
        createdAt: new Date().toISOString(),
      });

      if (!claimed.ok) {
        res.status(claimed.status).json({ error: claimed.error });
        return;
      }

      await store.touchUserLastLogin(claimed.user.id);
      const { token } = await createSession(claimed.user.id);
      setSessionCookie(req, res, token);
      res.locals.loggedUser = claimed.user;
      res.locals.logDetails = `Claimed initial admin (${email})`;
      res.status(201).json({ user: claimed.user, token });
    })
  );

  router.post(
    '/auth/demo-login',
    authRateLimiter,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (process.env.DISABLE_DEMO_LOGIN === 'true') {
        res.status(403).json({ error: 'Demo quick login is disabled in this environment.' });
        return;
      }

      const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : '';
      if (roleRaw !== 'student' && roleRaw !== 'teacher' && roleRaw !== 'admin') {
        res.status(400).json({ error: 'Specify role: student, teacher, or admin.' });
        return;
      }

      let user: UserProfile | null = null;
      if (roleRaw === 'student') {
        user = await store.findUserById('usr_student_demo');
      } else if (roleRaw === 'teacher') {
        user = await store.findUserById('usr_teacher_demo');
      } else {
        user = await domainStore.findOrCreateDemoAdmin();
      }

      if (!user) {
        res.status(404).json({ error: `Demo ${roleRaw} account not found.` });
        return;
      }
      if (user.accountStatus && user.accountStatus !== 'active') {
        res.status(403).json({ error: `Demo account is ${user.accountStatus}.` });
        return;
      }

      await store.touchUserLastLogin(user.id);
      const { token } = await createSession(user.id);
      setSessionCookie(req, res, token);
      res.locals.loggedUser = user;
      res.locals.logDetails = `Demo quick login as ${user.role}`;
      res.json({ user, token });
    })
  );

  router.post(
    '/auth/login',
    authRateLimiter,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      res.locals.guestEmail = email;

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const row = await store.findUserByEmail(email);
      if (!row || !row.password_hash || !verifyPassword(password, row.password_hash)) {
        res.locals.logDetails = 'Failed login attempt';
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      if (row.account_status && row.account_status !== 'active') {
        res.locals.logDetails = `Blocked ${row.account_status} account login`;
        res.status(403).json({
          error: `Your account is ${row.account_status}. Please contact an administrator.`,
        });
        return;
      }

      await store.touchUserLastLogin(row.id);
      const { token } = await createSession(row.id);
      setSessionCookie(req, res, token);

      const user = (await store.findUserById(row.id))!;
      res.locals.loggedUser = user;
      res.locals.logDetails = `Signed in as ${user.role}`;

      res.json({ user, token });
    })
  );

  router.post(
    '/auth/sync-supabase',
    authRateLimiter,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
      const pub = store.getSupabasePublicConfig();
      if (!accessToken || !pub.url || !pub.anonKey) {
        res.status(400).json({ error: 'Supabase Auth is not active in this environment.' });
        return;
      }

      const sbAuth = createClient(pub.url, pub.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await sbAuth.auth.getUser(accessToken);
      if (error || !data?.user?.email) {
        res.status(401).json({ error: 'Invalid or expired Supabase session token.' });
        return;
      }

      const meta = (data.user.user_metadata || {}) as Record<string, unknown>;
      const reqRoleRaw = typeof req.body?.role === 'string' ? req.body.role.toLowerCase() : String(meta.role || 'student');
      const requestedRole: UserRole =
        reqRoleRaw === 'admin' ? 'admin' : reqRoleRaw === 'teacher' ? 'teacher' : 'student';

      const synced = await domainStore.syncSupabaseUser({
        authUserId: data.user.id,
        email: data.user.email,
        fullName:
          typeof req.body?.name === 'string' && req.body.name.trim()
            ? req.body.name.trim()
            : String(meta.full_name || meta.name || data.user.email.split('@')[0]),
        requestedRole,
        institution: typeof req.body?.institution === 'string' ? req.body.institution : String(meta.institution || ''),
        subject: typeof req.body?.subject === 'string' ? req.body.subject : String(meta.subject || ''),
        bio: typeof req.body?.bio === 'string' ? req.body.bio : String(meta.bio || ''),
        setupSecret: typeof req.body?.setupSecret === 'string' ? req.body.setupSecret : '',
      });

      if ('error' in synced) {
        res.status(synced.status).json({ error: synced.error });
        return;
      }

      if (synced.user.accountStatus && synced.user.accountStatus !== 'active') {
        res.status(403).json({
          error: `Your account is currently ${synced.user.accountStatus}. Contact an administrator.`,
        });
        return;
      }

      await store.touchUserLastLogin(synced.user.id);
      const { token } = await createSession(synced.user.id);
      setSessionCookie(req, res, token);
      res.locals.loggedUser = synced.user;
      res.json({ user: synced.user, token });
    })
  );

  router.post(
    '/auth/forgot-password',
    authRateLimiter,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      res.locals.guestEmail = email;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Enter a valid email address.' });
        return;
      }

      const row = await store.findUserByEmail(email);
      let resetPreviewToken: string | undefined;

      if (row) {
        const rawToken = crypto.randomBytes(24).toString('base64url');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await domainStore.createPasswordResetToken(row.id, hashResetToken(rawToken), expiresAt);
        if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
          resetPreviewToken = rawToken;
        }
      }

      res.json({
        ok: true,
        message: 'If an account matches that email, password reset instructions have been issued.',
        ...(resetPreviewToken ? { resetPreviewToken } : {}),
      });
    })
  );

  router.post(
    '/auth/reset-password',
    authRateLimiter,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

      if (!token) {
        res.status(400).json({ error: 'Reset token is required.' });
        return;
      }
      if (newPassword.length < 8) {
        res.status(400).json({ error: 'New password must be at least 8 characters long.' });
        return;
      }

      const outcome = await domainStore.consumePasswordResetToken(
        hashResetToken(token),
        hashPassword(newPassword)
      );
      if (!outcome.ok) {
        res.status(400).json({ error: outcome.error });
        return;
      }

      res.locals.logDetails = 'Completed password reset';
      res.json({ ok: true, message: 'Password updated. You may now sign in with your new password.' });
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
  // USER PROFILE (ANY AUTHENTICATED ACTIVE USER)
  // =========================================================================
  router.get(
    '/profile',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      res.json({ user: req.user });
    }
  );

  router.patch(
    '/profile',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const updated = await domainStore.updateOwnProfile(req.user!.id, req.user!.role, {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        institution: typeof req.body?.institution === 'string' ? req.body.institution : undefined,
        avatarUrl: typeof req.body?.avatarUrl === 'string' ? req.body.avatarUrl : undefined,
        subject: typeof req.body?.subject === 'string' ? req.body.subject : undefined,
        bio: typeof req.body?.bio === 'string' ? req.body.bio : undefined,
      });
      if (!updated) {
        res.status(404).json({ error: 'Profile not found.' });
        return;
      }
      res.locals.loggedUser = updated;
      res.locals.logDetails = 'Updated profile details';
      res.json({ user: updated });
    })
  );

  // =========================================================================
  // DOCUMENTS (PDF & DOCX FOR AUTHENTICATED STUDENTS & APPROVED TEACHERS)
  // =========================================================================
  router.post(
    '/documents/upload',
    requireAuth,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (req.user!.role === 'teacher' && req.user!.teacherProfile?.approvalStatus !== 'approved') {
        res.status(403).json({ error: 'Your teacher account must be approved before uploading teaching materials.' });
        return;
      }
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
    aiRateLimiter,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (req.user!.role === 'teacher' && req.user!.teacherProfile?.approvalStatus !== 'approved') {
        res.status(403).json({ error: 'Your teacher account must be approved before using AI generation.' });
        return;
      }
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
  // STUDENT DASHBOARD, CLASSES, PROGRESS & STUDY MODE
  // =========================================================================
  router.get(
    '/student/dashboard',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const studentId = req.user!.id;
      const [docsCount, practiceQuizzes, examEntries, practiceAttempts, activeExamAttempt, classes] =
        await Promise.all([
          store.countDocumentsByUser(studentId),
          store.listPracticeQuizzesForStudent(studentId),
          store.listPublishedExamsForStudent(studentId),
          store.listRecentPracticeAttempts(studentId, 10),
          store.getActiveExamAttemptLock(studentId),
          domainStore.listStudentClasses(studentId),
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
          assignmentInfo: entry.assignmentInfo,
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
          classesCount: classes.length,
          avgExamPercentage,
          avgPracticePercentage,
        },
        classes,
        practiceQuizzes,
        availableExams,
        completedExams,
        recentActivity: recentActivity.slice(0, 8),
      });
    })
  );

  router.get(
    '/student/progress',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const progress = await domainStore.getStudentProgress(req.user!.id);
      res.json({ progress });
    })
  );

  router.get(
    '/student/classes',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const classes = await domainStore.listStudentClasses(req.user!.id);
      res.json({ classes });
    })
  );

  router.post(
    '/student/classes/join',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const enrollmentCode = typeof req.body?.enrollmentCode === 'string' ? req.body.enrollmentCode : '';
      const result = await domainStore.joinClassByCode(req.user!.id, enrollmentCode);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.locals.logDetails = `Joined class ${result.classRecord.name} (${result.classRecord.enrollmentCode})`;
      res.status(201).json({ classRecord: result.classRecord });
    })
  );

  router.delete(
    '/student/classes/:classId/leave',
    requireAuth,
    requireRole('student'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const left = await domainStore.leaveClass(req.user!.id, String(req.params.classId));
      if (!left) {
        res.status(404).json({ error: 'Class membership not found.' });
        return;
      }
      res.json({ ok: true });
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
  // RESULTS & SUBMISSION DETAIL (STUDENT OWNER, TEACHER OWNER, OR ADMIN)
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
      const isAdmin = req.user!.role === 'admin';

      if (!isStudentOwner && !isTeacherOwner && !isAdmin) {
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

  router.post(
    '/results/:attemptId/explain',
    requireAuth,
    aiRateLimiter,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const attemptId = String(req.params.attemptId);
      const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId.trim() : '';
      if (!questionId) {
        res.status(400).json({ error: 'Question ID is required.' });
        return;
      }

      const resultWrap = await store.getResultDetail(attemptId);
      if (!resultWrap) {
        res.status(404).json({ error: 'Exam result not found.' });
        return;
      }

      const isStudentOwner =
        req.user!.role === 'student' && resultWrap.detail.studentId === req.user!.id;
      const isTeacherOwner =
        req.user!.role === 'teacher' && resultWrap.teacherId === req.user!.id;
      const isAdmin = req.user!.role === 'admin';

      if (!isStudentOwner && !isTeacherOwner && !isAdmin) {
        res.status(403).json({ error: 'Access denied.' });
        return;
      }

      if (resultWrap.status === 'in_progress') {
        res.status(403).json({ error: 'AI study explanations are only unlocked after submitting the exam.' });
        return;
      }

      const question = resultWrap.detail.questions.find((q) => q.questionId === questionId);
      if (!question) {
        res.status(404).json({ error: 'Question not found in this exam attempt.' });
        return;
      }

      try {
        const explanation = await explainQuestionConceptWithGroq({
          examTitle: resultWrap.detail.examTitle,
          subject: resultWrap.detail.subject,
          prompt: question.prompt,
          questionType: question.questionType,
          studentAnswer: question.studentAnswer,
          correctAnswer: question.correctAnswer,
          suggestedAnswer: question.suggestedAnswer,
          existingExplanation: question.explanation,
        });
        res.locals.logDetails = `${resultWrap.detail.examTitle} (${question.questionType})`;
        res.json({ explanation });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to generate explanation.';
        const status = msg.includes('No AI API key is configured') ? 503 : 502;
        res.status(status).json({ error: msg });
      }
    })
  );

  // =========================================================================
  // TEACHER TEACHING MODE (APPROVED TEACHERS ONLY)
  // =========================================================================
  router.get(
    '/teacher/dashboard',
    requireAuth,
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const teacherId = req.user!.id;
      const [students, classes, examsRows, submissions] = await Promise.all([
        domainStore.listTeacherEnrolledStudents(teacherId),
        domainStore.listTeacherClasses(teacherId),
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
          totalClasses: classes.length,
          totalExams: examsRows.length,
          pendingEvaluations,
          completedExams: completedSubmissions,
          classAverage,
          passRate,
        },
        students,
        classes,
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

  // Teacher Classes & Enrollment
  router.get(
    '/teacher/classes',
    requireAuth,
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const classes = await domainStore.listTeacherClasses(req.user!.id);
      res.json({ classes });
    })
  );

  router.post(
    '/teacher/classes',
    requireAuth,
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
      const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
      if (name.length < 2 || subject.length < 2) {
        res.status(400).json({ error: 'Class name and subject are required.' });
        return;
      }
      const classRecord = await domainStore.createClass({
        teacherId: req.user!.id,
        name: name.slice(0, 120),
        subject: subject.slice(0, 120),
        description: description.slice(0, 500),
      });
      res.locals.logDetails = `Created class ${classRecord.name} (${classRecord.enrollmentCode})`;
      res.status(201).json({ classRecord });
    })
  );

  router.patch(
    '/teacher/classes/:id',
    requireAuth,
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const updated = await domainStore.updateClass(String(req.params.id), req.user!.id, {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        subject: typeof req.body?.subject === 'string' ? req.body.subject : undefined,
        description: typeof req.body?.description === 'string' ? req.body.description : undefined,
        status: req.body?.status === 'archived' || req.body?.status === 'active' ? req.body.status : undefined,
        regenerateCode: Boolean(req.body?.regenerateCode),
      });
      if (!updated) {
        res.status(404).json({ error: 'Class not found.' });
        return;
      }
      res.json({ classRecord: updated });
    })
  );

  router.get(
    '/teacher/classes/:id/members',
    requireAuth,
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const roster = await domainStore.getClassWithRoster(String(req.params.id), req.user!.id);
      if (!roster) {
        res.status(404).json({ error: 'Class not found.' });
        return;
      }
      res.json(roster);
    })
  );

  router.post(
    '/teacher/classes/:id/members',
    requireAuth,
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const identifier =
        typeof req.body?.identifier === 'string'
          ? req.body.identifier
          : typeof req.body?.email === 'string'
            ? req.body.email
            : '';
      if (!identifier.trim()) {
        res.status(400).json({ error: 'Provide a student email or user ID.' });
        return;
      }
      const outcome = await domainStore.addStudentToClass(String(req.params.id), req.user!.id, identifier);
      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.status(201).json({ member: outcome.member });
    })
  );

  router.delete(
    '/teacher/classes/:id/members/:studentId',
    requireAuth,
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const removed = await domainStore.removeStudentFromClass(
        String(req.params.id),
        req.user!.id,
        String(req.params.studentId)
      );
      if (!removed) {
        res.status(404).json({ error: 'Class member not found.' });
        return;
      }
      res.json({ ok: true });
    })
  );

  router.get(
    '/teacher/students',
    requireAuth,
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const students = await domainStore.listTeacherEnrolledStudents(req.user!.id);
      res.json({ students });
    })
  );

  router.get(
    '/teacher/analytics',
    requireAuth,
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const classId = typeof req.query?.classId === 'string' && req.query.classId ? req.query.classId : undefined;
      const analytics = await domainStore.getTeacherClassAnalytics(req.user!.id, classId);
      res.json(analytics);
    })
  );

  // Admin-only usage visibility (blocked for non-admins to protect cross-user data)
  router.get(
    '/teacher/usage-logs',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const overview = await store.getUsageOverview();
      res.json(overview);
    })
  );

  // Question Bank CRUD
  router.get(
    '/teacher/question-bank',
    requireAuth,
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const items = await store.listBankQuestions(req.user!.id);
      res.json({ questions: items });
    })
  );

  router.post(
    '/teacher/question-bank',
    requireAuth,
    requireApprovedTeacher,
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
    requireApprovedTeacher,
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
    requireApprovedTeacher,
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
      const assignedClassIds = Array.isArray(req.body?.assignedClassIds)
        ? (req.body.assignedClassIds as string[])
        : [];
      const startTime =
        typeof req.body?.startTime === 'string' && req.body.startTime.trim() ? req.body.startTime.trim() : null;
      const endTime =
        typeof req.body?.endTime === 'string' && req.body.endTime.trim() ? req.body.endTime.trim() : null;
      const attemptLimit = Math.max(1, Math.min(10, Number(req.body?.attemptLimit) || 1));
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
        assignedClassIds,
        startTime,
        endTime,
        attemptLimit,
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
    requireApprovedTeacher,
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
    requireApprovedTeacher,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const examId = String(req.params.id);
      const assignAll = Boolean(req.body?.assignAll);
      const studentIds = Array.isArray(req.body?.studentIds) ? (req.body.studentIds as string[]) : [];
      const classIds = Array.isArray(req.body?.classIds) ? (req.body.classIds as string[]) : [];
      const startTime =
        typeof req.body?.startTime === 'string' && req.body.startTime.trim() ? req.body.startTime.trim() : null;
      const endTime =
        typeof req.body?.endTime === 'string' && req.body.endTime.trim() ? req.body.endTime.trim() : null;
      const attemptLimit = Math.max(1, Math.min(10, Number(req.body?.attemptLimit) || 1));

      const updated = await store.updateExamAssignments(examId, req.user!.id, assignAll, studentIds, classIds, {
        startTime,
        endTime,
        attemptLimit,
      });
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
    requireApprovedTeacher,
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
    requireApprovedTeacher,
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

  // =========================================================================
  // ADMIN CONSOLE ROUTES (STRICT ADMIN ROLE)
  // =========================================================================
  router.get(
    '/admin/overview',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const overview = await domainStore.getAdminOverview();
      res.json(overview);
    })
  );

  router.get(
    '/admin/users',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const role = typeof req.query?.role === 'string' ? req.query.role : 'all';
      const status = typeof req.query?.status === 'string' ? req.query.status : 'all';
      const search = typeof req.query?.search === 'string' ? req.query.search : '';
      const users = await domainStore.adminListUsers({ role, status, search });
      res.json({ users });
    })
  );

  router.post(
    '/admin/users',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : '';

      if (name.length < 2 || name.length > 80) {
        res.status(400).json({ error: 'Name must be between 2 and 80 characters.' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Valid email is required.' });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }
      if (roleRaw !== 'student' && roleRaw !== 'teacher' && roleRaw !== 'admin') {
        res.status(400).json({ error: 'Role must be student, teacher, or admin.' });
        return;
      }

      const created = await domainStore.adminCreateUser({
        name,
        email,
        passwordHash: hashPassword(password),
        role: roleRaw as UserRole,
        institution: typeof req.body?.institution === 'string' ? req.body.institution : '',
        subject: typeof req.body?.subject === 'string' ? req.body.subject : '',
        bio: typeof req.body?.bio === 'string' ? req.body.bio : '',
        approvalStatus:
          req.body?.approvalStatus === 'pending' || req.body?.approvalStatus === 'rejected'
            ? req.body.approvalStatus
            : 'approved',
        adminId: req.user!.id,
      });

      if (!created.ok) {
        res.status(created.status).json({ error: created.error });
        return;
      }
      res.status(201).json({ user: created.user });
    })
  );

  router.patch(
    '/admin/users/:id',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const outcome = await domainStore.adminUpdateUser(
        String(req.params.id),
        {
          name: typeof req.body?.name === 'string' ? req.body.name : undefined,
          role:
            req.body?.role === 'student' || req.body?.role === 'teacher' || req.body?.role === 'admin'
              ? (req.body.role as UserRole)
              : undefined,
          accountStatus:
            req.body?.accountStatus === 'active' ||
            req.body?.accountStatus === 'deactivated' ||
            req.body?.accountStatus === 'suspended'
              ? (req.body.accountStatus as AccountStatus)
              : undefined,
          institution: typeof req.body?.institution === 'string' ? req.body.institution : undefined,
          subject: typeof req.body?.subject === 'string' ? req.body.subject : undefined,
          bio: typeof req.body?.bio === 'string' ? req.body.bio : undefined,
          approvalStatus:
            req.body?.approvalStatus === 'pending' ||
            req.body?.approvalStatus === 'approved' ||
            req.body?.approvalStatus === 'rejected'
              ? (req.body.approvalStatus as TeacherApprovalStatus)
              : undefined,
          rejectionReason:
            typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason : undefined,
        },
        req.user!.id
      );

      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.json({ user: outcome.user });
    })
  );

  router.patch(
    '/admin/teachers/:id/approval',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const statusRaw = typeof req.body?.approvalStatus === 'string' ? req.body.approvalStatus : '';
      if (statusRaw !== 'approved' && statusRaw !== 'rejected' && statusRaw !== 'pending') {
        res.status(400).json({ error: 'approvalStatus must be approved, rejected, or pending.' });
        return;
      }
      const rejectionReason = typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason : '';
      const outcome = await domainStore.updateTeacherApproval(
        String(req.params.id),
        statusRaw as TeacherApprovalStatus,
        req.user!.id,
        rejectionReason
      );
      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.json({ user: outcome.user });
    })
  );

  router.get(
    '/admin/classes',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const classes = await domainStore.adminListClasses();
      res.json({ classes });
    })
  );

  router.get(
    '/admin/exams',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const exams = await domainStore.adminListExams();
      res.json({ exams });
    })
  );

  router.get(
    '/admin/attempts',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const attempts = await domainStore.adminListAttempts();
      res.json({ attempts });
    })
  );

  router.get(
    '/admin/results',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const results = await domainStore.adminListResults();
      res.json({ results });
    })
  );

  router.get(
    '/admin/settings',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const settings = await domainStore.getPlatformSettings();
      res.json({ settings });
    })
  );

  router.patch(
    '/admin/settings',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const settings = await domainStore.updatePlatformSettings(
        {
          allowTeacherRegistration:
            typeof req.body?.allowTeacherRegistration === 'boolean'
              ? req.body.allowTeacherRegistration
              : undefined,
          requireTeacherApproval:
            typeof req.body?.requireTeacherApproval === 'boolean' ? req.body.requireTeacherApproval : undefined,
          defaultMaxTabSwitches:
            typeof req.body?.defaultMaxTabSwitches === 'number' ? req.body.defaultMaxTabSwitches : undefined,
          allowPublicPractice:
            typeof req.body?.allowPublicPractice === 'boolean' ? req.body.allowPublicPractice : undefined,
        },
        req.user!.id
      );
      res.json({ settings });
    })
  );

  router.get(
    '/admin/database',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const database = await domainStore.getDatabaseOverview();
      res.json(database);
    })
  );

  router.get(
    '/admin/audit-logs',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const [auditLogs, usage] = await Promise.all([
        domainStore.listAdminAuditLogs(100),
        store.getUsageOverview(),
      ]);
      res.json({ auditLogs, requestLogs: usage.logs });
    })
  );

  router.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  return router;
}
