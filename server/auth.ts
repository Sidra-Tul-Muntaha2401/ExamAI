import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import type { UserProfile, UserRole } from '../src/types/index.ts';
import { domainStore } from './domainStore.ts';
import { store } from './store.ts';

const SESSION_COOKIE_NAME = 'exampilot_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let cachedFallbackSecret: string | null = null;

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16) {
    return process.env.SESSION_SECRET.trim();
  }
  if (!cachedFallbackSecret) {
    cachedFallbackSecret = crypto.randomBytes(32).toString('hex');
  }
  return cachedFallbackSecret;
}

export function hashToken(rawToken: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(rawToken).digest('hex');
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(val);
    }
  }
  return out;
}

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  authSource?: 'bearer' | 'cookie';
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const id = `ses_${crypto.randomUUID()}`;

  await store.createSessionRecord({
    id,
    userId,
    tokenHash,
    expiresAt,
    createdAt: now,
  });

  return { token, expiresAt };
}

export async function deleteSessionByToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await store.deleteSessionByTokenHash(tokenHash);
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    partitioned: isHttps,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    partitioned: isHttps,
    path: '/',
  });
}

export function extractRawToken(req: Request): { token: string | null; source: 'bearer' | 'cookie' | null } {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return { token, source: 'bearer' };
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return { token: cookies[SESSION_COOKIE_NAME], source: 'cookie' };
  }
  return { token: null, source: null };
}

async function verifySupabaseJwtIfConfigured(token: string): Promise<UserProfile | null> {
  const pub = store.getSupabasePublicConfig();
  if (!pub.url || !pub.anonKey) return null;
  // Heuristic: JWTs always have 3 dot-separated segments
  if (token.split('.').length !== 3) return null;

  try {
    const sbAuth = createClient(pub.url, pub.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sbAuth.auth.getUser(token);
    if (error || !data?.user?.email) return null;

    const meta = (data.user.user_metadata || {}) as Record<string, unknown>;
    const rawRole = typeof meta.role === 'string' ? meta.role.toLowerCase() : 'student';
    const requestedRole: UserRole = rawRole === 'teacher' ? 'teacher' : 'student';
    const synced = await domainStore.syncSupabaseUser({
      authUserId: data.user.id,
      email: data.user.email,
      fullName: String(meta.full_name || meta.name || data.user.email.split('@')[0]),
      requestedRole,
      institution: typeof meta.institution === 'string' ? meta.institution : '',
      subject: typeof meta.subject === 'string' ? meta.subject : '',
      bio: typeof meta.bio === 'string' ? meta.bio : '',
    });

    if ('user' in synced) {
      return synced.user;
    }
    return null;
  } catch {
    return null;
  }
}

export async function attachOptionalUser(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token, source } = extractRawToken(req);
    if (!token || !source) {
      next();
      return;
    }

    const tokenHash = hashToken(token);
    const sessionRow = await store.findSessionWithUser(tokenHash);
    if (sessionRow) {
      if (Date.parse(sessionRow.expiresAt) < Date.now()) {
        await store.deleteSessionByTokenHash(tokenHash);
      } else {
        req.user = sessionRow.user;
        req.authSource = source;
        next();
        return;
      }
    }

    if (source === 'bearer') {
      const sbUser = await verifySupabaseJwtIfConfigured(token);
      if (sbUser) {
        req.user = sbUser;
        req.authSource = 'bearer';
        next();
        return;
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required. Please log in.' });
    return;
  }

  if (req.user.accountStatus && req.user.accountStatus !== 'active') {
    res.status(403).json({
      error: `Your account is currently ${req.user.accountStatus}. Contact an administrator for assistance.`,
    });
    return;
  }

  // CSRF check when mutating via cookie authentication
  const method = req.method.toUpperCase();
  if (req.authSource === 'cookie' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const requestedWith = req.headers['x-requested-with'];
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const originMatchesHost =
      origin && host
        ? (() => {
            try {
              return new URL(origin).host === host;
            } catch {
              return false;
            }
          })()
        : false;

    if (requestedWith !== 'ExamAI' && requestedWith !== 'ExamPilot' && !originMatchesHost) {
      res.status(403).json({ error: 'Cross-site request blocked.' });
      return;
    }
  }

  next();
}

export function requireRole(role: UserRole) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: `Access denied. This action requires a ${role} account.` });
      return;
    }
    next();
  };
}

export function requireAnyRole(roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Access denied for your account role.' });
      return;
    }
    next();
  };
}

export function requireApprovedTeacher(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.user.role !== 'teacher') {
    res.status(403).json({ error: 'Access denied. Teacher account required.' });
    return;
  }
  const approvalStatus = req.user.teacherProfile?.approvalStatus || 'pending';
  if (approvalStatus !== 'approved') {
    res.status(403).json({
      error:
        approvalStatus === 'rejected'
          ? 'Your teacher verification request was rejected. Contact an administrator for details.'
          : 'Your teacher account is pending administrator verification.',
      approvalStatus,
      rejectionReason: req.user.teacherProfile?.rejectionReason || '',
    });
    return;
  }
  next();
}
