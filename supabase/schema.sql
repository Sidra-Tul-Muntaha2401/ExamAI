-- ExamAI PostgreSQL Schema for Supabase
-- Run this entire script once inside your Supabase Project -> SQL Editor.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_role TEXT NOT NULL CHECK (owner_role IN ('student', 'teacher')),
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
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  UNIQUE (exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  bank_question_id TEXT REFERENCES question_bank(id) ON DELETE SET NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq', 'short_answer', 'long_answer', 'true_false')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
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

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_exams_teacher_id ON exams(teacher_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at DESC);
