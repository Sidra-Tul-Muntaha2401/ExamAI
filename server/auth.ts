import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { db, dbDir } from './db.ts';
import type { UserProfile, UserRole } from '../src/types/index.ts';

const SESSION_COOKIE_NAME = 'exampilot_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let cachedFallbackSecret: string | null = null;

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16) {
    return process.env.SESSION_SECRET.trim();
  }
  if (cachedFallbackSecret) {
    return cachedFallbackSecret;
  }
  const secretPath = path.join(dbDir, '.session_secret');
  try {
    if (fs.existsSync(secretPath)) {
      const stored = fs.readFileSync(secretPath, 'utf8').trim();
      if (stored.length >= 32) {
        cachedFallbackSecret = stored;
        return stored;
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
    cachedFallbackSecret = generated;
    return generated;
  } catch {
    cachedFallbackSecret = crypto.randomBytes(32).toString('hex');
    return cachedFallbackSecret;
  }
}

function hashToken(rawToken: string): string {
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

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const id = `ses_${crypto.randomUUID()}`;

  db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, tokenHash, expiresAt, now);

  return { token, expiresAt };
}

export function deleteSessionByToken(token: string): void {
  const tokenHash = hashToken(token);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
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

export function attachOptionalUser(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const { token, source } = extractRawToken(req);
  if (!token || !source) {
    next();
    return;
  }

  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.created_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as
    | { id: string; name: string; email: string; role: UserRole; created_at: string; expires_at: string }
    | undefined;

  if (!row) {
    next();
    return;
  }

  if (Date.parse(row.expires_at) < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    next();
    return;
  }

  req.user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
  req.authSource = source;
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required. Please log in.' });
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

    if (requestedWith !== 'ExamPilot' && !originMatchesHost) {
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
