-- Non-Destructive Incremental Migration: Multi-User RBAC, Teacher Approvals, Classes, Exam Assignments & RLS
-- Safe to run on an existing ExamAI Supabase database without dropping existing user or exam data.

-- 1. Upgrade users table cleanly
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'teacher', 'admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS institution TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TEXT;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_owner_role_check;
ALTER TABLE documents ADD CONSTRAINT documents_owner_role_check CHECK (owner_role IN ('student', 'teacher', 'admin'));

-- 2. Upgrade questions table with topic for student topic analytics
ALTER TABLE questions ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT '';

-- 3. Upgrade exam_assignments cleanly to support class-level and student-level assignments with schedules
ALTER TABLE exam_assignments ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE exam_assignments DROP CONSTRAINT IF EXISTS exam_assignments_exam_id_student_id_key;
ALTER TABLE exam_assignments ADD COLUMN IF NOT EXISTS teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE exam_assignments ADD COLUMN IF NOT EXISTS class_id TEXT;
ALTER TABLE exam_assignments ADD COLUMN IF NOT EXISTS start_time TEXT;
ALTER TABLE exam_assignments ADD COLUMN IF NOT EXISTS end_time TEXT;
ALTER TABLE exam_assignments ADD COLUMN IF NOT EXISTS attempt_limit INTEGER NOT NULL DEFAULT 1;
ALTER TABLE exam_assignments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'assigned';

-- 4. Create new identity, class, reset token, and admin tables
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auth_user_id UUID UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  avatar_url TEXT NOT NULL DEFAULT '',
  institution TEXT NOT NULL DEFAULT '',
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'deactivated', 'suspended')),
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS teacher_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  institution TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  rejection_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  enrollment_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS class_members (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  UNIQUE (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- 5. Backfill profiles & existing teachers (existing teachers stay approved so no disruption occurs)
INSERT INTO profiles (id, full_name, email, role, avatar_url, institution, account_status, created_at, updated_at)
SELECT id, name, email, role, COALESCE(avatar_url, ''), COALESCE(institution, ''), COALESCE(account_status, 'active'), created_at, COALESCE(updated_at, created_at)
FROM users
ON CONFLICT (id) DO NOTHING;

INSERT INTO teacher_profiles (id, user_id, subject, institution, bio, approval_status, approved_at, created_at, updated_at)
SELECT 'tp_' || id, id, '', COALESCE(institution, ''), '', 'approved', created_at, created_at, created_at
FROM users
WHERE role = 'teacher'
ON CONFLICT (user_id) DO NOTHING;

-- Backfill question topics from linked question_bank rows
UPDATE questions q
SET topic = qb.topic
FROM question_bank qb
WHERE q.bank_question_id = qb.id
  AND (q.topic IS NULL OR q.topic = '');

-- 6. Recreate indexes & student_progress view
CREATE INDEX IF NOT EXISTS idx_classes_teacher_id ON classes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_classes_code ON classes(enrollment_code);
CREATE INDEX IF NOT EXISTS idx_class_members_student ON class_members(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_assignments_exam ON exam_assignments(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_assignments_class ON exam_assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_exam_assignments_student ON exam_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_status ON teacher_profiles(approval_status);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);

CREATE OR REPLACE VIEW student_progress AS
SELECT
  u.id AS student_id,
  u.name AS student_name,
  u.email AS student_email,
  COUNT(DISTINCT ea.id) AS total_attempted,
  COUNT(DISTINCT CASE WHEN ea.status IN ('submitted', 'evaluated') THEN ea.id END) AS total_completed,
  ROUND(AVG(CASE WHEN r.status = 'evaluated' THEN r.percentage END)::numeric, 1) AS average_score,
  MAX(CASE WHEN r.status = 'evaluated' THEN r.percentage END) AS highest_score,
  COUNT(DISTINCT pa.id) AS practice_attempts_count,
  ROUND(AVG(pa.percentage)::numeric, 1) AS practice_average
FROM users u
LEFT JOIN exam_attempts ea ON ea.student_id = u.id
LEFT JOIN results r ON r.attempt_id = ea.id
LEFT JOIN practice_attempts pa ON pa.student_id = u.id
WHERE u.role = 'student'
GROUP BY u.id, u.name, u.email;
