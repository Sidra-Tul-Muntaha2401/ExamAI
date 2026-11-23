-- ExamAI Complete PostgreSQL Schema & Row Level Security for Supabase
-- Safe & idempotent: preserves existing data if tables already exist.
-- Run this script in Supabase Project -> SQL Editor.

-- =========================================================================
-- 1. CORE IDENTITY & ROLE TABLES
-- =========================================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  avatar_url TEXT NOT NULL DEFAULT '',
  institution TEXT NOT NULL DEFAULT '',
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'deactivated', 'suspended')),
  last_login_at TEXT,
  updated_at TEXT,
  created_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

-- =========================================================================
-- 2. CLASSES & MEMBERSHIP
-- =========================================================================
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

-- =========================================================================
-- 3. STUDY MATERIALS, QUIZZES & EXAMS
-- =========================================================================
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_role TEXT NOT NULL CHECK (owner_role IN ('student', 'teacher', 'admin')),
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'docx')),
  file_size INTEGER NOT NULL,
  extracted_text TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_quizzes (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  question_type TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES practice_quizzes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers_json TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  total_marks DOUBLE PRECISION NOT NULL,
  percentage DOUBLE PRECISION NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_bank (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq', 'short_answer', 'long_answer', 'true_false')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  topic TEXT NOT NULL,
  prompt TEXT NOT NULL,
  correct_answer TEXT NOT NULL DEFAULT '',
  explanation TEXT NOT NULL DEFAULT '',
  suggested_answer TEXT NOT NULL DEFAULT '',
  marking_guidance TEXT NOT NULL DEFAULT '',
  marks INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  instructions TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  total_marks INTEGER NOT NULL,
  passing_marks INTEGER NOT NULL,
  deadline_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  randomize_questions INTEGER NOT NULL DEFAULT 1,
  randomize_options INTEGER NOT NULL DEFAULT 1,
  track_tab_switches INTEGER NOT NULL DEFAULT 1,
  warn_on_tab_leave INTEGER NOT NULL DEFAULT 1,
  require_fullscreen INTEGER NOT NULL DEFAULT 1,
  block_copy_paste INTEGER NOT NULL DEFAULT 1,
  max_tab_switches INTEGER NOT NULL DEFAULT 3,
  assign_all INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_assignments (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  class_id TEXT REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  start_time TEXT,
  end_time TEXT,
  attempt_limit INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'started', 'completed', 'expired')),
  assigned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  bank_question_id TEXT REFERENCES question_bank(id) ON DELETE SET NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq', 'short_answer', 'long_answer', 'true_false')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  topic TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  correct_answer TEXT NOT NULL DEFAULT '',
  explanation TEXT NOT NULL DEFAULT '',
  suggested_answer TEXT NOT NULL DEFAULT '',
  marking_guidance TEXT NOT NULL DEFAULT '',
  marks INTEGER NOT NULL DEFAULT 2,
  question_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS question_options (
  id TEXT PRIMARY KEY,
  question_id TEXT REFERENCES questions(id) ON DELETE CASCADE,
  bank_question_id TEXT REFERENCES question_bank(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  option_order INTEGER NOT NULL DEFAULT 0,
  is_correct INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'submitted', 'evaluated')),
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  question_seed TEXT NOT NULL,
  tab_switch_count INTEGER NOT NULL DEFAULT 0,
  focus_loss_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS student_answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL DEFAULT '',
  selected_option TEXT NOT NULL DEFAULT '',
  is_correct INTEGER,
  marks_awarded DOUBLE PRECISION,
  updated_at TEXT NOT NULL,
  UNIQUE (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES exam_attempts(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  descriptive_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_marks DOUBLE PRECISION NOT NULL,
  percentage DOUBLE PRECISION NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending_evaluation', 'evaluated')),
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marks_awarded DOUBLE PRECISION NOT NULL,
  feedback TEXT NOT NULL DEFAULT '',
  evaluated_at TEXT NOT NULL,
  UNIQUE (attempt_id, question_id)
);

-- =========================================================================
-- 4. AUDIT, INTEGRITY LOGS & PLATFORM SETTINGS
-- =========================================================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL DEFAULT 'Guest',
  user_email TEXT NOT NULL DEFAULT '',
  user_role TEXT NOT NULL DEFAULT 'anonymous',
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  action TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
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

-- =========================================================================
-- 5. INDEXES & PROGRESS VIEW
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_exams_teacher_id ON exams(teacher_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at DESC);
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

-- =========================================================================
-- 6. SECURITY DEFINER HELPERS & SUPABASE AUTH SYNC
-- =========================================================================
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.users
  WHERE auth_user_id = auth.uid()::text OR id = auth.uid()::text
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users
  WHERE auth_user_id = auth.uid()::text OR id = auth.uid()::text
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_approved_teacher()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.teacher_profiles tp ON tp.user_id = u.id
    WHERE (u.auth_user_id = auth.uid()::text OR u.id = auth.uid()::text)
      AND u.role = 'teacher'
      AND u.account_status = 'active'
      AND tp.approval_status = 'approved'
  );
$$;

-- Sync new Supabase Auth signups strictly into users/profiles as 'student' (never 'admin' from client metadata)
CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role TEXT;
  safe_role TEXT;
  safe_name TEXT;
  now_iso TEXT;
BEGIN
  requested_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
  IF requested_role = 'teacher' THEN
    safe_role := 'teacher';
  ELSE
    safe_role := 'student';
  END IF;

  safe_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1));
  now_iso := to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  INSERT INTO public.users (id, auth_user_id, name, email, password_hash, role, institution, account_status, created_at, updated_at)
  VALUES (NEW.id::text, NEW.id::text, safe_name, LOWER(NEW.email), '', safe_role, COALESCE(NEW.raw_user_meta_data->>'institution', ''), 'active', now_iso, now_iso)
  ON CONFLICT (email) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, updated_at = now_iso;

  INSERT INTO public.profiles (id, auth_user_id, full_name, email, role, institution, account_status, created_at, updated_at)
  VALUES (NEW.id::text, NEW.id, safe_name, LOWER(NEW.email), safe_role, COALESCE(NEW.raw_user_meta_data->>'institution', ''), 'active', now_iso, now_iso)
  ON CONFLICT (email) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, updated_at = now_iso;

  IF safe_role = 'teacher' THEN
    INSERT INTO public.teacher_profiles (id, user_id, subject, institution, bio, approval_status, created_at, updated_at)
    VALUES (
      'tp_' || NEW.id::text,
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data->>'subject', ''),
      COALESCE(NEW.raw_user_meta_data->>'institution', ''),
      COALESCE(NEW.raw_user_meta_data->>'bio', ''),
      'pending',
      now_iso,
      now_iso
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_created();

-- =========================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles & Users: self read/update (no role/status escalation), admin full read/write
DROP POLICY IF EXISTS profiles_self_or_admin_select ON profiles;
CREATE POLICY profiles_self_or_admin_select ON profiles FOR SELECT
  USING (id = public.current_app_user_id() OR public.current_app_role() = 'admin');

DROP POLICY IF EXISTS profiles_self_update ON profiles;
CREATE POLICY profiles_self_update ON profiles FOR UPDATE
  USING (id = public.current_app_user_id())
  WITH CHECK (
    id = public.current_app_user_id()
    AND role = public.current_app_role()
  );

DROP POLICY IF EXISTS profiles_admin_all ON profiles;
CREATE POLICY profiles_admin_all ON profiles FOR ALL
  USING (public.current_app_role() = 'admin')
  WITH CHECK (public.current_app_role() = 'admin');

DROP POLICY IF EXISTS users_self_or_admin_select ON users;
CREATE POLICY users_self_or_admin_select ON users FOR SELECT
  USING (id = public.current_app_user_id() OR public.current_app_role() = 'admin');

DROP POLICY IF EXISTS users_admin_all ON users;
CREATE POLICY users_admin_all ON users FOR ALL
  USING (public.current_app_role() = 'admin')
  WITH CHECK (public.current_app_role() = 'admin');

-- Teacher Profiles: self read, admin full access
DROP POLICY IF EXISTS teacher_profiles_select ON teacher_profiles;
CREATE POLICY teacher_profiles_select ON teacher_profiles FOR SELECT
  USING (user_id = public.current_app_user_id() OR public.current_app_role() = 'admin');

DROP POLICY IF EXISTS teacher_profiles_admin_all ON teacher_profiles;
CREATE POLICY teacher_profiles_admin_all ON teacher_profiles FOR ALL
  USING (public.current_app_role() = 'admin')
  WITH CHECK (public.current_app_role() = 'admin');

-- Classes & Class Members
DROP POLICY IF EXISTS classes_select ON classes;
CREATE POLICY classes_select ON classes FOR SELECT
  USING (
    public.current_app_role() = 'admin'
    OR (teacher_id = public.current_app_user_id() AND public.is_approved_teacher())
    OR EXISTS (
      SELECT 1 FROM class_members cm
      WHERE cm.class_id = classes.id AND cm.student_id = public.current_app_user_id() AND cm.status = 'active'
    )
  );

DROP POLICY IF EXISTS classes_teacher_write ON classes;
CREATE POLICY classes_teacher_write ON classes FOR ALL
  USING (
    public.current_app_role() = 'admin'
    OR (teacher_id = public.current_app_user_id() AND public.is_approved_teacher())
  )
  WITH CHECK (
    public.current_app_role() = 'admin'
    OR (teacher_id = public.current_app_user_id() AND public.is_approved_teacher())
  );

DROP POLICY IF EXISTS class_members_select ON class_members;
CREATE POLICY class_members_select ON class_members FOR SELECT
  USING (
    public.current_app_role() = 'admin'
    OR student_id = public.current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_members.class_id AND c.teacher_id = public.current_app_user_id() AND public.is_approved_teacher()
    )
  );

DROP POLICY IF EXISTS class_members_write ON class_members;
CREATE POLICY class_members_write ON class_members FOR ALL
  USING (
    public.current_app_role() = 'admin'
    OR student_id = public.current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_members.class_id AND c.teacher_id = public.current_app_user_id() AND public.is_approved_teacher()
    )
  )
  WITH CHECK (
    public.current_app_role() = 'admin'
    OR student_id = public.current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_members.class_id AND c.teacher_id = public.current_app_user_id() AND public.is_approved_teacher()
    )
  );

-- Documents, Practice Quizzes, Practice Attempts: strict owner or admin
DROP POLICY IF EXISTS documents_owner_or_admin ON documents;
CREATE POLICY documents_owner_or_admin ON documents FOR ALL
  USING (user_id = public.current_app_user_id() OR public.current_app_role() = 'admin')
  WITH CHECK (user_id = public.current_app_user_id() OR public.current_app_role() = 'admin');

DROP POLICY IF EXISTS practice_quizzes_owner_or_admin ON practice_quizzes;
CREATE POLICY practice_quizzes_owner_or_admin ON practice_quizzes FOR ALL
  USING (student_id = public.current_app_user_id() OR public.current_app_role() = 'admin')
  WITH CHECK (student_id = public.current_app_user_id() OR public.current_app_role() = 'admin');

DROP POLICY IF EXISTS practice_attempts_owner_or_admin ON practice_attempts;
CREATE POLICY practice_attempts_owner_or_admin ON practice_attempts FOR ALL
  USING (student_id = public.current_app_user_id() OR public.current_app_role() = 'admin')
  WITH CHECK (student_id = public.current_app_user_id() OR public.current_app_role() = 'admin');

-- Question Bank: approved teacher owner or admin
DROP POLICY IF EXISTS question_bank_owner_or_admin ON question_bank;
CREATE POLICY question_bank_owner_or_admin ON question_bank FOR ALL
  USING ((teacher_id = public.current_app_user_id() AND public.is_approved_teacher()) OR public.current_app_role() = 'admin')
  WITH CHECK ((teacher_id = public.current_app_user_id() AND public.is_approved_teacher()) OR public.current_app_role() = 'admin');

-- Exams: approved teacher owner, admin, or assigned student (read published only)
DROP POLICY IF EXISTS exams_select ON exams;
CREATE POLICY exams_select ON exams FOR SELECT
  USING (
    public.current_app_role() = 'admin'
    OR (teacher_id = public.current_app_user_id() AND public.is_approved_teacher())
    OR (
      status = 'published' AND (
        assign_all = 1
        OR EXISTS (
          SELECT 1 FROM exam_assignments ea
          WHERE ea.exam_id = exams.id
            AND (
              ea.student_id = public.current_app_user_id()
              OR EXISTS (
                SELECT 1 FROM class_members cm
                WHERE cm.class_id = ea.class_id AND cm.student_id = public.current_app_user_id() AND cm.status = 'active'
              )
            )
        )
      )
    )
  );

DROP POLICY IF EXISTS exams_teacher_write ON exams;
CREATE POLICY exams_teacher_write ON exams FOR ALL
  USING ((teacher_id = public.current_app_user_id() AND public.is_approved_teacher()) OR public.current_app_role() = 'admin')
  WITH CHECK ((teacher_id = public.current_app_user_id() AND public.is_approved_teacher()) OR public.current_app_role() = 'admin');

-- Exam Assignments
DROP POLICY IF EXISTS exam_assignments_select ON exam_assignments;
CREATE POLICY exam_assignments_select ON exam_assignments FOR SELECT
  USING (
    public.current_app_role() = 'admin'
    OR student_id = public.current_app_user_id()
    OR EXISTS (
      SELECT 1 FROM class_members cm
      WHERE cm.class_id = exam_assignments.class_id AND cm.student_id = public.current_app_user_id() AND cm.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM exams e WHERE e.id = exam_assignments.exam_id AND e.teacher_id = public.current_app_user_id()
    )
  );

DROP POLICY IF EXISTS exam_assignments_teacher_write ON exam_assignments;
CREATE POLICY exam_assignments_teacher_write ON exam_assignments FOR ALL
  USING (
    public.current_app_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM exams e WHERE e.id = exam_assignments.exam_id AND e.teacher_id = public.current_app_user_id() AND public.is_approved_teacher()
    )
  )
  WITH CHECK (
    public.current_app_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM exams e WHERE e.id = exam_assignments.exam_id AND e.teacher_id = public.current_app_user_id() AND public.is_approved_teacher()
    )
  );

-- Attempts, Answers, Results, Evaluations, Activity Logs
DROP POLICY IF EXISTS exam_attempts_access ON exam_attempts;
CREATE POLICY exam_attempts_access ON exam_attempts FOR ALL
  USING (
    public.current_app_role() = 'admin'
    OR student_id = public.current_app_user_id()
    OR EXISTS (SELECT 1 FROM exams e WHERE e.id = exam_attempts.exam_id AND e.teacher_id = public.current_app_user_id())
  )
  WITH CHECK (
    public.current_app_role() = 'admin'
    OR student_id = public.current_app_user_id()
    OR EXISTS (SELECT 1 FROM exams e WHERE e.id = exam_attempts.exam_id AND e.teacher_id = public.current_app_user_id())
  );

DROP POLICY IF EXISTS student_answers_access ON student_answers;
CREATE POLICY student_answers_access ON student_answers FOR ALL
  USING (
    public.current_app_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN exams e ON e.id = ea.exam_id
      WHERE ea.id = student_answers.attempt_id
        AND (ea.student_id = public.current_app_user_id() OR e.teacher_id = public.current_app_user_id())
    )
  );

DROP POLICY IF EXISTS results_access ON results;
CREATE POLICY results_access ON results FOR SELECT
  USING (
    public.current_app_role() = 'admin'
    OR student_id = public.current_app_user_id()
    OR EXISTS (SELECT 1 FROM exams e WHERE e.id = results.exam_id AND e.teacher_id = public.current_app_user_id())
  );

DROP POLICY IF EXISTS evaluations_access ON evaluations;
CREATE POLICY evaluations_access ON evaluations FOR ALL
  USING (
    public.current_app_role() = 'admin'
    OR teacher_id = public.current_app_user_id()
    OR EXISTS (SELECT 1 FROM exam_attempts ea WHERE ea.id = evaluations.attempt_id AND ea.student_id = public.current_app_user_id())
  );

DROP POLICY IF EXISTS activity_logs_access ON activity_logs;
CREATE POLICY activity_logs_access ON activity_logs FOR ALL
  USING (
    public.current_app_role() = 'admin'
    OR student_id = public.current_app_user_id()
    OR EXISTS (SELECT 1 FROM exams e WHERE e.id = activity_logs.exam_id AND e.teacher_id = public.current_app_user_id())
  );

-- Questions & Options (teacher owner or admin)
DROP POLICY IF EXISTS questions_access ON questions;
CREATE POLICY questions_access ON questions FOR SELECT
  USING (
    public.current_app_role() = 'admin'
    OR EXISTS (SELECT 1 FROM exams e WHERE e.id = questions.exam_id AND e.teacher_id = public.current_app_user_id())
  );

DROP POLICY IF EXISTS question_options_access ON question_options;
CREATE POLICY question_options_access ON question_options FOR SELECT
  USING (public.current_app_role() = 'admin');

-- Admin-only tables
DROP POLICY IF EXISTS request_logs_admin ON request_logs;
CREATE POLICY request_logs_admin ON request_logs FOR ALL
  USING (public.current_app_role() = 'admin')
  WITH CHECK (public.current_app_role() = 'admin');

DROP POLICY IF EXISTS platform_settings_admin ON platform_settings;
CREATE POLICY platform_settings_admin ON platform_settings FOR ALL
  USING (public.current_app_role() = 'admin')
  WITH CHECK (public.current_app_role() = 'admin');

DROP POLICY IF EXISTS admin_audit_logs_admin ON admin_audit_logs;
CREATE POLICY admin_audit_logs_admin ON admin_audit_logs FOR ALL
  USING (public.current_app_role() = 'admin')
  WITH CHECK (public.current_app_role() = 'admin');
