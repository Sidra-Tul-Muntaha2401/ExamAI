import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  computeFinalResult,
  gradeObjectiveQuestions,
} from '../src/lib/examRules.ts';
import type {
  Difficulty,
  DocumentRecord,
  ExamResultDetail,
  PracticeQuizRecord,
  QuestionType,
  QuizQuestion,
  RequestLogRecord,
  UsageOverviewData,
  UserProfile,
  UserRole,
} from '../src/types/index.ts';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const keyBuf = Buffer.from(key, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

interface SqliteStatement {
  run: (...params: unknown[]) => { changes?: number | bigint };
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
}

interface SqliteDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
}

function resolveWritableDbPath(): string {
  const configured = path.resolve(process.cwd(), process.env.DATABASE_PATH || './data/exampilot.sqlite');
  try {
    fs.mkdirSync(path.dirname(configured), { recursive: true });
    fs.accessSync(path.dirname(configured), fs.constants.W_OK);
    return configured;
  } catch {
    const fallbackDir = path.join(os.tmpdir(), 'examai-data');
    fs.mkdirSync(fallbackDir, { recursive: true });
    return path.join(fallbackDir, 'exampilot.sqlite');
  }
}

export interface StoredUserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

export interface StoredExamRow {
  id: string;
  teacher_id: string;
  teacher_name?: string;
  title: string;
  subject: string;
  instructions: string;
  duration_minutes: number;
  total_marks: number;
  passing_marks: number;
  deadline_at: string | null;
  status: 'draft' | 'published';
  randomize_questions: boolean;
  randomize_options: boolean;
  track_tab_switches: boolean;
  warn_on_tab_leave: boolean;
  require_fullscreen: boolean;
  block_copy_paste: boolean;
  max_tab_switches: number;
  assign_all: boolean;
  created_at: string;
  question_count?: number;
  submission_count?: number;
  pending_count?: number;
}

export interface StoredAttemptRow {
  id: string;
  exam_id: string;
  student_id: string;
  status: 'in_progress' | 'submitted' | 'evaluated';
  started_at: string;
  submitted_at: string | null;
  question_seed: string;
  tab_switch_count: number;
  focus_loss_count: number;
  created_at: string;
}

export interface StoredQuestionRow {
  id: string;
  exam_id: string;
  question_type: QuestionType;
  difficulty: Difficulty;
  prompt: string;
  correct_answer: string;
  explanation: string;
  suggested_answer: string;
  marking_guidance: string;
  marks: number;
  question_order: number;
  options?: string[];
}

function buildSeedPayload() {
  const now = new Date().toISOString();
  const futureDeadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const earlierStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const earlierSubmit = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 14 * 60 * 1000).toISOString();

  const teacherId = 'usr_teacher_demo';
  const studentId = 'usr_student_demo';
  const student2Id = 'usr_student_marcus';

  const users = [
    {
      id: teacherId,
      name: 'Dr. Elena Vance',
      email: 'teacher@exampilot.edu',
      password_hash: hashPassword('Teacher123!'),
      role: 'teacher' as UserRole,
      created_at: now,
    },
    {
      id: studentId,
      name: 'Maya Lin',
      email: 'student@exampilot.edu',
      password_hash: hashPassword('Student123!'),
      role: 'student' as UserRole,
      created_at: now,
    },
    {
      id: student2Id,
      name: 'Marcus Alvarez',
      email: 'marcus@exampilot.edu',
      password_hash: hashPassword('Student123!'),
      role: 'student' as UserRole,
      created_at: now,
    },
  ];

  const studentDocText = `Cellular Respiration and ATP Synthesis Overview.
Cellular respiration is the metabolic pathway through which cells oxidize glucose into carbon dioxide and water while capturing chemical energy as adenosine triphosphate (ATP).
Stage 1: Glycolysis occurs in the cytoplasm without requiring oxygen. One six-carbon glucose molecule is split into two three-carbon pyruvate molecules, yielding a net gain of 2 ATP and 2 NADH.
Stage 2: Pyruvate Oxidation and the Citric Acid Cycle (Krebs Cycle) take place in the mitochondrial matrix. Each pyruvate is converted to acetyl-CoA, releasing CO2 and generating NADH. Across two turns of the cycle per glucose molecule, the cell produces 2 ATP (or GTP), 6 NADH, and 2 FADH2.
Stage 3: Oxidative Phosphorylation occurs across the inner mitochondrial membrane. Electrons from NADH and FADH2 travel through the Electron Transport Chain (ETC), pumping protons into the intermembrane space to establish an electrochemical proton gradient. ATP synthase uses this proton-motive force (chemiosmosis) to phosphorylate ADP into approximately 28 to 32 ATP molecules. Oxygen serves as the terminal electron acceptor, combining with protons and electrons to form water.`;

  const teacherDocText = `Relational Database Normalization and SQL Fundamentals.
Database normalization organizes relational tables to minimize data redundancy and eliminate insertion, update, and deletion anomalies.
First Normal Form (1NF) requires that every column holds atomic values and each record is uniquely identified by a primary key, with no repeating groups.
Second Normal Form (2NF) requires 1NF plus the elimination of partial dependencies: every non-key attribute must be functionally dependent on the entire primary key (especially relevant for composite primary keys).
Third Normal Form (3NF) requires 2NF plus the elimination of transitive dependencies: no non-key attribute may depend on another non-key attribute.
Boyce-Codd Normal Form (BCNF) strengthens 3NF by requiring that for every non-trivial functional dependency X -> Y, X must be a superkey.
Foreign keys enforce referential integrity between child and parent tables, ensuring orphaned references cannot be inserted when ON DELETE RESTRICT or CASCADE rules are configured.`;

  const documents = [
    {
      id: 'doc_student_bio',
      user_id: studentId,
      owner_role: 'student' as UserRole,
      title: 'Cellular Respiration & ATP Synthesis Notes',
      original_filename: 'Cellular_Respiration_Notes.docx',
      file_type: 'docx' as const,
      file_size: 24580,
      extracted_text: studentDocText,
      word_count: studentDocText.split(/\s+/).length,
      created_at: now,
    },
    {
      id: 'doc_teacher_db',
      user_id: teacherId,
      owner_role: 'teacher' as UserRole,
      title: 'Relational Database Normalization & SQL Lecture',
      original_filename: 'Database_Normalization_Lecture.pdf',
      file_type: 'pdf' as const,
      file_size: 184320,
      extracted_text: teacherDocText,
      word_count: teacherDocText.split(/\s+/).length,
      created_at: now,
    },
  ];

  const practiceQuestions = [
    {
      id: 'pq_1',
      questionType: 'mcq',
      difficulty: 'Easy',
      topic: 'Glycolysis',
      prompt: 'Where inside a eukaryotic cell does glycolysis take place?',
      options: ['Cytoplasm', 'Mitochondrial matrix', 'Inner mitochondrial membrane', 'Nucleus'],
      correctAnswer: 'Cytoplasm',
      explanation: 'Glycolysis occurs in the cytoplasm and does not require oxygen.',
      marks: 2,
    },
    {
      id: 'pq_2',
      questionType: 'mcq',
      difficulty: 'Medium',
      topic: 'Oxidative Phosphorylation',
      prompt: 'Which molecule acts as the final electron acceptor at the end of the Electron Transport Chain?',
      options: ['Oxygen', 'Pyruvate', 'NAD+', 'Carbon dioxide'],
      correctAnswer: 'Oxygen',
      explanation: 'Oxygen accepts low-energy electrons and combines with protons to form water.',
      marks: 2,
    },
    {
      id: 'pq_3',
      questionType: 'mcq',
      difficulty: 'Medium',
      topic: 'Citric Acid Cycle',
      prompt: 'What is the net ATP gain produced directly during glycolysis from one molecule of glucose?',
      options: ['2 ATP', '4 ATP', '32 ATP', '6 ATP'],
      correctAnswer: '2 ATP',
      explanation: 'Glycolysis invests 2 ATP and generates 4 ATP, resulting in a net gain of 2 ATP.',
      marks: 2,
    },
    {
      id: 'pq_4',
      questionType: 'true_false',
      difficulty: 'Easy',
      topic: 'Chemiosmosis',
      prompt: 'ATP synthase relies on a proton gradient across the inner mitochondrial membrane to synthesize ATP.',
      options: ['True', 'False'],
      correctAnswer: 'True',
      explanation: 'The proton-motive force drives protons through ATP synthase to phosphorylate ADP.',
      marks: 1,
    },
    {
      id: 'pq_5',
      questionType: 'mcq',
      difficulty: 'Hard',
      topic: 'Citric Acid Cycle',
      prompt: 'Before entering the Citric Acid Cycle, pyruvate is converted into which two-carbon derivative?',
      options: ['Acetyl-CoA', 'Lactate', 'Oxaloacetate', 'Citrate'],
      correctAnswer: 'Acetyl-CoA',
      explanation: 'Pyruvate oxidation removes one carbon as CO2 and attaches coenzyme A to form acetyl-CoA.',
      marks: 2,
    },
  ];

  const bankItems = [
    {
      id: 'qb_1',
      type: 'mcq' as QuestionType,
      difficulty: 'Easy' as Difficulty,
      topic: 'Normal Forms',
      prompt: 'Which requirement defines First Normal Form (1NF)?',
      options: [
        'Atomic column values with no repeating groups',
        'No transitive dependencies between non-key columns',
        'Every determinant must be a candidate superkey',
        'All foreign keys must permit NULL values',
      ],
      correct: 'Atomic column values with no repeating groups',
      explanation: '1NF eliminates multi-valued cells and repeating groups by enforcing atomic attributes.',
      suggested: '',
      guidance: '',
      marks: 2,
    },
    {
      id: 'qb_2',
      type: 'mcq' as QuestionType,
      difficulty: 'Medium' as Difficulty,
      topic: 'Normal Forms',
      prompt: 'A table with a composite primary key (StudentID, CourseID) stores CourseTitle, which depends only on CourseID. Which normal form does this violate?',
      options: ['Second Normal Form (2NF)', 'First Normal Form (1NF)', 'Fourth Normal Form (4NF)', 'Referential Integrity'],
      correct: 'Second Normal Form (2NF)',
      explanation: 'CourseTitle partially depends on CourseID alone, violating 2NF.',
      suggested: '',
      guidance: '',
      marks: 2,
    },
    {
      id: 'qb_3',
      type: 'mcq' as QuestionType,
      difficulty: 'Medium' as Difficulty,
      topic: 'SQL Constraints',
      prompt: 'Which SQL clause ensures a child row cannot reference a non-existent parent primary key?',
      options: ['FOREIGN KEY constraint', 'GROUP BY clause', 'CHECK DISTINCT', 'ORDER BY constraint'],
      correct: 'FOREIGN KEY constraint',
      explanation: 'Foreign keys enforce referential integrity between related tables.',
      suggested: '',
      guidance: '',
      marks: 2,
    },
    {
      id: 'qb_4',
      type: 'true_false' as QuestionType,
      difficulty: 'Easy' as Difficulty,
      topic: 'Normal Forms',
      prompt: 'A table in Third Normal Form (3NF) cannot contain transitive dependencies among non-key attributes.',
      options: ['True', 'False'],
      correct: 'True',
      explanation: '3NF explicitly removes transitive dependencies where a non-key attribute depends on another non-key attribute.',
      suggested: '',
      guidance: '',
      marks: 1,
    },
    {
      id: 'qb_5',
      type: 'short_answer' as QuestionType,
      difficulty: 'Medium' as Difficulty,
      topic: 'Anomalies',
      prompt: 'Briefly explain how unnormalized tables lead to update anomalies, using a short example.',
      options: undefined,
      correct: '',
      explanation: '',
      suggested: 'When the same fact (such as an instructor office number) is duplicated across multiple enrollment rows, updating it in one row but not others creates inconsistent data.',
      guidance: 'Award 2 marks for defining data inconsistency across duplicate rows and 3 marks for a concrete example.',
      marks: 5,
    },
    {
      id: 'qb_6',
      type: 'long_answer' as QuestionType,
      difficulty: 'Hard' as Difficulty,
      topic: 'Schema Design',
      prompt: 'Contrast 3NF and Boyce-Codd Normal Form (BCNF). Describe a scenario where a relation satisfies 3NF but fails BCNF, and explain how to decompose it.',
      options: undefined,
      correct: '',
      explanation: '',
      suggested: 'In 3NF, a dependency X -> Y is permitted if Y is a prime attribute. BCNF requires X to be a superkey for every non-trivial dependency. When multiple overlapping candidate keys exist, decompose along the violating determinant X -> Y into (X, Y) and (R - Y).',
      guidance: 'Award 4 marks for accurate 3NF vs BCNF rules, 3 marks for an overlapping candidate key example, and 3 marks for lossless decomposition steps.',
      marks: 10,
    },
  ];

  return {
    now,
    futureDeadline,
    earlierStart,
    earlierSubmit,
    teacherId,
    studentId,
    student2Id,
    users,
    documents,
    practiceQuestions,
    bankItems,
  };
}

function stripWrappingQuotes(value: string | undefined): string {
  if (!value) return '';
  let trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isPlaceholderValue(value: string): boolean {
  if (!value) return true;
  const lower = value.toLowerCase();
  return (
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'none' ||
    lower.includes('your_supabase') ||
    lower.includes('your-supabase') ||
    lower.includes('your-project') ||
    lower.includes('example.supabase') ||
    lower === 'changeme'
  );
}

export function normalizeSupabaseUrl(raw: string | undefined): { url: string | null; reason?: string } {
  const cleaned = stripWrappingQuotes(raw);
  if (!cleaned || isPlaceholderValue(cleaned)) {
    return { url: null };
  }

  // Handle accidental PostgreSQL URI pasted into SUPABASE_URL
  if (/^postgres(ql)?:\/\//i.test(cleaned)) {
    try {
      const pgParsed = new URL(cleaned);
      const match = pgParsed.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.(co|in)$/i);
      if (match) {
        return { url: `https://${match[1]}.supabase.${match[2]}` };
      }
    } catch {
      // fall through
    }
    return {
      url: null,
      reason: 'SUPABASE_URL looks like a PostgreSQL URI rather than https://<project-ref>.supabase.co.',
    };
  }

  const withProtocol =
    !/^https?:\/\//i.test(cleaned) && /^[a-z0-9-]+\.supabase\.(co|in)$/i.test(cleaned)
      ? `https://${cleaned}`
      : cleaned;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        url: null,
        reason: 'SUPABASE_URL must be an http:// or https:// URL (e.g. https://<project-ref>.supabase.co).',
      };
    }
    return { url: parsed.origin };
  } catch {
    return {
      url: null,
      reason: 'Configured SUPABASE_URL is not a valid HTTP/HTTPS URL (expected https://<project-ref>.supabase.co).',
    };
  }
}

class ExamDataStore {
  public provider: 'supabase' | 'sqlite' = 'sqlite';
  public ready = false;
  public initError: string | null = null;
  public fallbackNotice: string | null = null;

  private sqliteDb: SqliteDatabase | null = null;
  private supabase: SupabaseClient | null = null;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    const rawUrl = stripWrappingQuotes(process.env.SUPABASE_URL);
    const rawKey =
      stripWrappingQuotes(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
      stripWrappingQuotes(process.env.SUPABASE_SECRET_KEY) ||
      stripWrappingQuotes(process.env.SUPABASE_ANON_KEY);

    const hasRawUrl = Boolean(rawUrl && !isPlaceholderValue(rawUrl));
    const hasRawKey = Boolean(rawKey && !isPlaceholderValue(rawKey));

    if (hasRawUrl && hasRawKey) {
      const normalized = normalizeSupabaseUrl(rawUrl);
      if (normalized.url) {
        try {
          const client = createClient(normalized.url, rawKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { error } = await client.from('users').select('id').limit(1);
          if (error) {
            const msg = `Supabase schema check failed (${error.message}). Run supabase/schema.sql in your Supabase SQL Editor.`;
            if (process.env.VERCEL === '1') {
              this.provider = 'supabase';
              this.supabase = client;
              this.initError = msg;
              console.error(msg);
              this.ready = false;
              this.initPromise = null;
              return;
            }
            console.warn(`${msg} Falling back to local SQLite.`);
            this.fallbackNotice = msg;
          } else {
            this.provider = 'supabase';
            this.supabase = client;
            await this.seedSupabaseIfEmpty();
            this.initError = null;
            this.fallbackNotice = null;
            this.ready = true;
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Supabase initialization failed.';
          if (process.env.VERCEL === '1') {
            this.provider = 'supabase';
            this.initError = `Supabase connection failed: ${msg}`;
            console.error(this.initError);
            this.ready = false;
            this.initPromise = null;
            return;
          }
          console.warn(`Supabase connection failed (${msg}). Falling back to local SQLite.`);
          this.fallbackNotice = `Supabase connection failed (${msg}); using local SQLite.`;
        }
      } else {
        const msg =
          normalized.reason ||
          'Configured SUPABASE_URL is invalid; falling back to local SQLite.';
        console.warn(msg);
        this.fallbackNotice = msg;
      }
    }

    // Fallback to local SQLite (loaded dynamically so serverless bundlers do not statically fail on node:sqlite)
    try {
      this.provider = 'sqlite';
      this.supabase = null;
      const sqliteSpec = 'node:' + 'sqlite';
      const { DatabaseSync } = (await import(sqliteSpec)) as {
        DatabaseSync: new (filename: string) => SqliteDatabase;
      };
      const dbPath = resolveWritableDbPath();
      this.sqliteDb = new DatabaseSync(dbPath);
      this.sqliteDb.exec('PRAGMA foreign_keys = ON;');
      this.sqliteDb.exec('PRAGMA journal_mode = WAL;');

      this.createSqliteTables();
      this.seedSqliteIfEmpty();
      this.initError = null;
      this.ready = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to initialize SQLite database.';
      this.initError = msg;
      this.ready = false;
      this.initPromise = null;
      console.error('Database initialization error:', err);
    }
  }

  private getSql(): SqliteDatabase {
    if (!this.sqliteDb) {
      throw new Error(this.initError || 'SQLite database is not initialized.');
    }
    return this.sqliteDb;
  }

  private getSupa(): SupabaseClient {
    if (!this.supabase) {
      throw new Error(this.initError || 'Supabase client is not initialized.');
    }
    return this.supabase;
  }

  private createSqliteTables(): void {
    const db = this.getSql();
    db.exec(`
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
        score REAL NOT NULL,
        total_marks REAL NOT NULL,
        percentage REAL NOT NULL,
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
        marks_awarded REAL,
        updated_at TEXT NOT NULL,
        UNIQUE (attempt_id, question_id)
      );
      CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL UNIQUE REFERENCES exam_attempts(id) ON DELETE CASCADE,
        exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        objective_score REAL NOT NULL DEFAULT 0,
        descriptive_score REAL NOT NULL DEFAULT 0,
        total_score REAL NOT NULL DEFAULT 0,
        total_marks REAL NOT NULL,
        percentage REAL NOT NULL DEFAULT 0,
        passed INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('pending_evaluation', 'evaluated')),
        published_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        marks_awarded REAL NOT NULL,
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
    `);

    const examCols = db.prepare('PRAGMA table_info(exams)').all() as Array<{ name: string }>;
    const colNames = new Set(examCols.map((c) => c.name));
    if (!colNames.has('require_fullscreen')) {
      db.exec('ALTER TABLE exams ADD COLUMN require_fullscreen INTEGER NOT NULL DEFAULT 1;');
    }
    if (!colNames.has('block_copy_paste')) {
      db.exec('ALTER TABLE exams ADD COLUMN block_copy_paste INTEGER NOT NULL DEFAULT 1;');
    }
    if (!colNames.has('max_tab_switches')) {
      db.exec('ALTER TABLE exams ADD COLUMN max_tab_switches INTEGER NOT NULL DEFAULT 3;');
    }
  }

  private seedSqliteIfEmpty(): void {
    const db = this.getSql();
    const existing = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (existing.count > 0) return;

    const s = buildSeedPayload();
    const insertUser = db.prepare(
      'INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const u of s.users) {
      insertUser.run(u.id, u.name, u.email, u.password_hash, u.role, u.created_at);
    }

    const insertDoc = db.prepare(
      `INSERT INTO documents (id, user_id, owner_role, title, original_filename, file_type, file_size, extracted_text, word_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const d of s.documents) {
      insertDoc.run(d.id, d.user_id, d.owner_role, d.title, d.original_filename, d.file_type, d.file_size, d.extracted_text, d.word_count, d.created_at);
    }

    db.prepare(
      `INSERT INTO practice_quizzes (id, student_id, document_id, title, topic, difficulty, question_type, questions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('pq_bio_1', s.studentId, 'doc_student_bio', 'Cellular Respiration Practice Set', 'Cellular Respiration & ATP', 'Medium', 'mixed', JSON.stringify(s.practiceQuestions), s.now);

    db.prepare(
      `INSERT INTO practice_attempts (id, quiz_id, student_id, answers_json, score, total_marks, percentage, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('pa_bio_1', 'pq_bio_1', s.studentId, JSON.stringify({ pq_1: 'Cytoplasm', pq_2: 'Oxygen', pq_3: '2 ATP', pq_4: 'True', pq_5: 'Citrate' }), 7, 9, 77.8, s.now);

    const insertBank = db.prepare(
      `INSERT INTO question_bank (id, teacher_id, document_id, question_type, difficulty, topic, prompt, correct_answer, explanation, suggested_answer, marking_guidance, marks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertOpt = db.prepare(
      `INSERT INTO question_options (id, question_id, bank_question_id, option_text, option_order, is_correct)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const b of s.bankItems) {
      insertBank.run(b.id, s.teacherId, 'doc_teacher_db', b.type, b.difficulty, b.topic, b.prompt, b.correct || '', b.explanation || '', b.suggested || '', b.guidance || '', b.marks, s.now);
      if (b.options) {
        b.options.forEach((opt, idx) => {
          insertOpt.run(`opt_${b.id}_${idx}`, null, b.id, opt, idx, opt === b.correct ? 1 : 0);
        });
      }
    }

    const insertExam = db.prepare(
      `INSERT INTO exams (id, teacher_id, title, subject, instructions, duration_minutes, total_marks, passing_marks, deadline_at, status, randomize_questions, randomize_options, track_tab_switches, warn_on_tab_leave, assign_all, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertExam.run('exam_db_midterm', s.teacherId, 'Midterm: Relational Databases & SQL', 'CS 301 · Database Systems', 'Read each question carefully before answering. Your progress is automatically saved on every selection. Leaving the exam tab is logged for academic integrity review.', 30, 22, 13, s.futureDeadline, 'published', 1, 1, 1, 1, 1, s.now);
    insertExam.run('exam_norm_quiz1', s.teacherId, 'Quiz 1: Functional Dependencies & 3NF', 'CS 301 · Database Systems', 'Complete both the multiple-choice items and the short explanation on update anomalies.', 20, 9, 5, s.futureDeadline, 'published', 0, 0, 1, 1, 1, s.now);

    const insertExamQ = db.prepare(
      `INSERT INTO questions (id, exam_id, bank_question_id, question_type, difficulty, prompt, correct_answer, explanation, suggested_answer, marking_guidance, marks, question_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    s.bankItems.forEach((b, idx) => {
      const qId = `eq_mid_${idx + 1}`;
      insertExamQ.run(qId, 'exam_db_midterm', b.id, b.type, b.difficulty, b.prompt, b.correct || '', b.explanation || '', b.suggested || '', b.guidance || '', b.marks, idx + 1);
      if (b.options) {
        b.options.forEach((opt, oIdx) => {
          insertOpt.run(`opt_${qId}_${oIdx}`, qId, null, opt, oIdx, opt === b.correct ? 1 : 0);
        });
      }
    });

    [s.bankItems[0], s.bankItems[1], s.bankItems[4]].forEach((b, idx) => {
      const qId = `eq_q1_${idx + 1}`;
      insertExamQ.run(qId, 'exam_norm_quiz1', b.id, b.type, b.difficulty, b.prompt, b.correct || '', b.explanation || '', b.suggested || '', b.guidance || '', b.marks, idx + 1);
      if (b.options) {
        b.options.forEach((opt, oIdx) => {
          insertOpt.run(`opt_${qId}_${oIdx}`, qId, null, opt, oIdx, opt === b.correct ? 1 : 0);
        });
      }
    });

    const insertAtt = db.prepare(
      `INSERT INTO exam_attempts (id, exam_id, student_id, status, started_at, submitted_at, question_seed, tab_switch_count, focus_loss_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertAtt.run('att_maya_q1', 'exam_norm_quiz1', s.studentId, 'evaluated', s.earlierStart, s.earlierSubmit, 'seed_maya_q1', 0, 0, s.earlierStart);
    insertAtt.run('att_marcus_q1', 'exam_norm_quiz1', s.student2Id, 'submitted', s.earlierStart, s.earlierSubmit, 'seed_marcus_q1', 1, 1, s.earlierStart);

    const insertAns = db.prepare(
      `INSERT INTO student_answers (id, attempt_id, question_id, answer_text, selected_option, is_correct, marks_awarded, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertAns.run('ans_maya_1', 'att_maya_q1', 'eq_q1_1', 'Atomic column values with no repeating groups', 'Atomic column values with no repeating groups', 1, 2, s.earlierSubmit);
    insertAns.run('ans_maya_2', 'att_maya_q1', 'eq_q1_2', 'Second Normal Form (2NF)', 'Second Normal Form (2NF)', 1, 2, s.earlierSubmit);
    insertAns.run('ans_maya_3', 'att_maya_q1', 'eq_q1_3', 'When duplicate instructor details exist across enrollment records, updating an office number in only one row leaves conflicting records.', '', null, 4.5, s.earlierSubmit);

    insertAns.run('ans_marcus_1', 'att_marcus_q1', 'eq_q1_1', 'Atomic column values with no repeating groups', 'Atomic column values with no repeating groups', 1, 2, s.earlierSubmit);
    insertAns.run('ans_marcus_2', 'att_marcus_q1', 'eq_q1_2', 'First Normal Form (1NF)', 'First Normal Form (1NF)', 0, 0, s.earlierSubmit);
    insertAns.run('ans_marcus_3', 'att_marcus_q1', 'eq_q1_3', 'Unnormalized tables store repeated department data across rows, so changing one row without updating all others makes the table inconsistent.', '', null, null, s.earlierSubmit);

    db.prepare(
      `INSERT INTO evaluations (id, attempt_id, question_id, teacher_id, marks_awarded, feedback, evaluated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('eval_maya_3', 'att_maya_q1', 'eq_q1_3', s.teacherId, 4.5, 'Clear definition and relevant example. Mentioning how splitting into separate Instructor and Enrollment tables resolves the anomaly would earn full marks.', s.earlierSubmit);

    const insertRes = db.prepare(
      `INSERT INTO results (id, attempt_id, exam_id, student_id, objective_score, descriptive_score, total_score, total_marks, percentage, passed, status, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertRes.run('res_maya_q1', 'att_maya_q1', 'exam_norm_quiz1', s.studentId, 4, 4.5, 8.5, 9, 94.4, 1, 'evaluated', s.earlierSubmit);
    insertRes.run('res_marcus_q1', 'att_marcus_q1', 'exam_norm_quiz1', s.student2Id, 2, 0, 2, 9, 22.2, 0, 'pending_evaluation', s.earlierSubmit);

    const insertAct = db.prepare(
      `INSERT INTO activity_logs (id, attempt_id, exam_id, student_id, event_type, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insertAct.run('log_1', 'att_maya_q1', 'exam_norm_quiz1', s.studentId, 'exam_started', 'Exam session initialized', s.earlierStart);
    insertAct.run('log_2', 'att_maya_q1', 'exam_norm_quiz1', s.studentId, 'exam_submitted', 'Submitted within time window', s.earlierSubmit);
    insertAct.run('log_3', 'att_marcus_q1', 'exam_norm_quiz1', s.student2Id, 'exam_started', 'Exam session initialized', s.earlierStart);
    insertAct.run('log_4', 'att_marcus_q1', 'exam_norm_quiz1', s.student2Id, 'tab_hidden', 'Browser tab became hidden during attempt', s.earlierStart);
    insertAct.run('log_5', 'att_marcus_q1', 'exam_norm_quiz1', s.student2Id, 'exam_submitted', 'Submitted within time window', s.earlierSubmit);
  }

  private async seedSupabaseIfEmpty(): Promise<void> {
    const sb = this.getSupa();
    const { data: existing } = await sb.from('users').select('id').limit(1);
    if (existing && existing.length > 0) return;

    const s = buildSeedPayload();
    await sb.from('users').insert(s.users);
    await sb.from('documents').insert(s.documents);
    await sb.from('practice_quizzes').insert({
      id: 'pq_bio_1',
      student_id: s.studentId,
      document_id: 'doc_student_bio',
      title: 'Cellular Respiration Practice Set',
      topic: 'Cellular Respiration & ATP',
      difficulty: 'Medium',
      question_type: 'mixed',
      questions_json: JSON.stringify(s.practiceQuestions),
      created_at: s.now,
    });
    await sb.from('practice_attempts').insert({
      id: 'pa_bio_1',
      quiz_id: 'pq_bio_1',
      student_id: s.studentId,
      answers_json: JSON.stringify({ pq_1: 'Cytoplasm', pq_2: 'Oxygen', pq_3: '2 ATP', pq_4: 'True', pq_5: 'Citrate' }),
      score: 7,
      total_marks: 9,
      percentage: 77.8,
      completed_at: s.now,
    });

    await sb.from('question_bank').insert(
      s.bankItems.map((b) => ({
        id: b.id,
        teacher_id: s.teacherId,
        document_id: 'doc_teacher_db',
        question_type: b.type,
        difficulty: b.difficulty,
        topic: b.topic,
        prompt: b.prompt,
        correct_answer: b.correct || '',
        explanation: b.explanation || '',
        suggested_answer: b.suggested || '',
        marking_guidance: b.guidance || '',
        marks: b.marks,
        created_at: s.now,
      }))
    );

    const bankOpts: Array<Record<string, unknown>> = [];
    for (const b of s.bankItems) {
      if (b.options) {
        b.options.forEach((opt, idx) => {
          bankOpts.push({
            id: `opt_${b.id}_${idx}`,
            question_id: null,
            bank_question_id: b.id,
            option_text: opt,
            option_order: idx,
            is_correct: opt === b.correct ? 1 : 0,
          });
        });
      }
    }
    if (bankOpts.length > 0) await sb.from('question_options').insert(bankOpts);

    await sb.from('exams').insert([
      {
        id: 'exam_db_midterm',
        teacher_id: s.teacherId,
        title: 'Midterm: Relational Databases & SQL',
        subject: 'CS 301 · Database Systems',
        instructions: 'Read each question carefully before answering. Your progress is automatically saved on every selection. Leaving the exam tab is logged for academic integrity review.',
        duration_minutes: 30,
        total_marks: 22,
        passing_marks: 13,
        deadline_at: s.futureDeadline,
        status: 'published',
        randomize_questions: 1,
        randomize_options: 1,
        track_tab_switches: 1,
        warn_on_tab_leave: 1,
        require_fullscreen: 1,
        block_copy_paste: 1,
        max_tab_switches: 3,
        assign_all: 1,
        created_at: s.now,
      },
      {
        id: 'exam_norm_quiz1',
        teacher_id: s.teacherId,
        title: 'Quiz 1: Functional Dependencies & 3NF',
        subject: 'CS 301 · Database Systems',
        instructions: 'Complete both the multiple-choice items and the short explanation on update anomalies.',
        duration_minutes: 20,
        total_marks: 9,
        passing_marks: 5,
        deadline_at: s.futureDeadline,
        status: 'published',
        randomize_questions: 0,
        randomize_options: 0,
        track_tab_switches: 1,
        warn_on_tab_leave: 1,
        require_fullscreen: 1,
        block_copy_paste: 1,
        max_tab_switches: 3,
        assign_all: 1,
        created_at: s.now,
      },
    ]);

    const eqRows: Array<Record<string, unknown>> = [];
    const eqOpts: Array<Record<string, unknown>> = [];
    s.bankItems.forEach((b, idx) => {
      const qId = `eq_mid_${idx + 1}`;
      eqRows.push({
        id: qId,
        exam_id: 'exam_db_midterm',
        bank_question_id: b.id,
        question_type: b.type,
        difficulty: b.difficulty,
        prompt: b.prompt,
        correct_answer: b.correct || '',
        explanation: b.explanation || '',
        suggested_answer: b.suggested || '',
        marking_guidance: b.guidance || '',
        marks: b.marks,
        question_order: idx + 1,
      });
      b.options?.forEach((opt, oIdx) => {
        eqOpts.push({
          id: `opt_${qId}_${oIdx}`,
          question_id: qId,
          bank_question_id: null,
          option_text: opt,
          option_order: oIdx,
          is_correct: opt === b.correct ? 1 : 0,
        });
      });
    });

    [s.bankItems[0], s.bankItems[1], s.bankItems[4]].forEach((b, idx) => {
      const qId = `eq_q1_${idx + 1}`;
      eqRows.push({
        id: qId,
        exam_id: 'exam_norm_quiz1',
        bank_question_id: b.id,
        question_type: b.type,
        difficulty: b.difficulty,
        prompt: b.prompt,
        correct_answer: b.correct || '',
        explanation: b.explanation || '',
        suggested_answer: b.suggested || '',
        marking_guidance: b.guidance || '',
        marks: b.marks,
        question_order: idx + 1,
      });
      b.options?.forEach((opt, oIdx) => {
        eqOpts.push({
          id: `opt_${qId}_${oIdx}`,
          question_id: qId,
          bank_question_id: null,
          option_text: opt,
          option_order: oIdx,
          is_correct: opt === b.correct ? 1 : 0,
        });
      });
    });

    await sb.from('questions').insert(eqRows);
    if (eqOpts.length > 0) await sb.from('question_options').insert(eqOpts);

    await sb.from('exam_attempts').insert([
      {
        id: 'att_maya_q1',
        exam_id: 'exam_norm_quiz1',
        student_id: s.studentId,
        status: 'evaluated',
        started_at: s.earlierStart,
        submitted_at: s.earlierSubmit,
        question_seed: 'seed_maya_q1',
        tab_switch_count: 0,
        focus_loss_count: 0,
        created_at: s.earlierStart,
      },
      {
        id: 'att_marcus_q1',
        exam_id: 'exam_norm_quiz1',
        student_id: s.student2Id,
        status: 'submitted',
        started_at: s.earlierStart,
        submitted_at: s.earlierSubmit,
        question_seed: 'seed_marcus_q1',
        tab_switch_count: 1,
        focus_loss_count: 1,
        created_at: s.earlierStart,
      },
    ]);

    await sb.from('student_answers').insert([
      { id: 'ans_maya_1', attempt_id: 'att_maya_q1', question_id: 'eq_q1_1', answer_text: 'Atomic column values with no repeating groups', selected_option: 'Atomic column values with no repeating groups', is_correct: 1, marks_awarded: 2, updated_at: s.earlierSubmit },
      { id: 'ans_maya_2', attempt_id: 'att_maya_q1', question_id: 'eq_q1_2', answer_text: 'Second Normal Form (2NF)', selected_option: 'Second Normal Form (2NF)', is_correct: 1, marks_awarded: 2, updated_at: s.earlierSubmit },
      { id: 'ans_maya_3', attempt_id: 'att_maya_q1', question_id: 'eq_q1_3', answer_text: 'When duplicate instructor details exist across enrollment records, updating an office number in only one row leaves conflicting records.', selected_option: '', is_correct: null, marks_awarded: 4.5, updated_at: s.earlierSubmit },
      { id: 'ans_marcus_1', attempt_id: 'att_marcus_q1', question_id: 'eq_q1_1', answer_text: 'Atomic column values with no repeating groups', selected_option: 'Atomic column values with no repeating groups', is_correct: 1, marks_awarded: 2, updated_at: s.earlierSubmit },
      { id: 'ans_marcus_2', attempt_id: 'att_marcus_q1', question_id: 'eq_q1_2', answer_text: 'First Normal Form (1NF)', selected_option: 'First Normal Form (1NF)', is_correct: 0, marks_awarded: 0, updated_at: s.earlierSubmit },
      { id: 'ans_marcus_3', attempt_id: 'att_marcus_q1', question_id: 'eq_q1_3', answer_text: 'Unnormalized tables store repeated department data across rows, so changing one row without updating all others makes the table inconsistent.', selected_option: '', is_correct: null, marks_awarded: null, updated_at: s.earlierSubmit },
    ]);

    await sb.from('evaluations').insert({
      id: 'eval_maya_3',
      attempt_id: 'att_maya_q1',
      question_id: 'eq_q1_3',
      teacher_id: s.teacherId,
      marks_awarded: 4.5,
      feedback: 'Clear definition and relevant example. Mentioning how splitting into separate Instructor and Enrollment tables resolves the anomaly would earn full marks.',
      evaluated_at: s.earlierSubmit,
    });

    await sb.from('results').insert([
      { id: 'res_maya_q1', attempt_id: 'att_maya_q1', exam_id: 'exam_norm_quiz1', student_id: s.studentId, objective_score: 4, descriptive_score: 4.5, total_score: 8.5, total_marks: 9, percentage: 94.4, passed: 1, status: 'evaluated', published_at: s.earlierSubmit },
      { id: 'res_marcus_q1', attempt_id: 'att_marcus_q1', exam_id: 'exam_norm_quiz1', student_id: s.student2Id, objective_score: 2, descriptive_score: 0, total_score: 2, total_marks: 9, percentage: 22.2, passed: 0, status: 'pending_evaluation', published_at: s.earlierSubmit },
    ]);

    await sb.from('activity_logs').insert([
      { id: 'log_1', attempt_id: 'att_maya_q1', exam_id: 'exam_norm_quiz1', student_id: s.studentId, event_type: 'exam_started', details: 'Exam session initialized', created_at: s.earlierStart },
      { id: 'log_2', attempt_id: 'att_maya_q1', exam_id: 'exam_norm_quiz1', student_id: s.studentId, event_type: 'exam_submitted', details: 'Submitted within time window', created_at: s.earlierSubmit },
      { id: 'log_3', attempt_id: 'att_marcus_q1', exam_id: 'exam_norm_quiz1', student_id: s.student2Id, event_type: 'exam_started', details: 'Exam session initialized', created_at: s.earlierStart },
      { id: 'log_4', attempt_id: 'att_marcus_q1', exam_id: 'exam_norm_quiz1', student_id: s.student2Id, event_type: 'tab_hidden', details: 'Browser tab became hidden during attempt', created_at: s.earlierStart },
      { id: 'log_5', attempt_id: 'att_marcus_q1', exam_id: 'exam_norm_quiz1', student_id: s.student2Id, event_type: 'exam_submitted', details: 'Submitted within time window', created_at: s.earlierSubmit },
    ]);
  }

  // =========================================================================
  // USERS
  // =========================================================================
  async findUserByEmail(email: string): Promise<StoredUserRow | null> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('users')
        .select('id, name, email, password_hash, role, created_at')
        .eq('email', email)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as StoredUserRow | null) ?? null;
    }
    const row = this.getSql()
      .prepare('SELECT id, name, email, password_hash, role, created_at FROM users WHERE email = ?')
      .get(email) as StoredUserRow | undefined;
    return row ?? null;
  }

  async findUserById(id: string): Promise<UserProfile | null> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('users')
        .select('id, name, email, role, created_at')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: String(data.id),
        name: String(data.name),
        email: String(data.email),
        role: data.role as UserRole,
        createdAt: String(data.created_at),
      };
    }
    const row = this.getSql()
      .prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?')
      .get(id);
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      role: row.role as UserRole,
      createdAt: String(row.created_at),
    };
  }

  async createUser(user: StoredUserRow): Promise<void> {
    if (this.provider === 'supabase') {
      const { error } = await this.getSupa().from('users').insert(user);
      if (error) throw new Error(error.message);
      return;
    }
    this.getSql()
      .prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, user.name, user.email, user.password_hash, user.role, user.created_at);
  }

  async listStudents(): Promise<Array<{ id: string; name: string; email: string; created_at: string }>> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('users')
        .select('id, name, email, created_at')
        .eq('role', 'student')
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []) as Array<{ id: string; name: string; email: string; created_at: string }>;
    }
    return this.getSql()
      .prepare("SELECT id, name, email, created_at FROM users WHERE role = 'student' ORDER BY name ASC")
      .all() as Array<{ id: string; name: string; email: string; created_at: string }>;
  }

  async listAllUsers(): Promise<UserProfile[]> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('users')
        .select('id, name, email, role, created_at')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []).map((u) => ({
        id: String(u.id),
        name: String(u.name),
        email: String(u.email),
        role: u.role as UserRole,
        createdAt: String(u.created_at),
      }));
    }
    const rows = this.getSql()
      .prepare('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC')
      .all();
    return rows.map((u) => ({
      id: String(u.id),
      name: String(u.name),
      email: String(u.email),
      role: u.role as UserRole,
      createdAt: String(u.created_at),
    }));
  }

  // =========================================================================
  // SESSIONS
  // =========================================================================
  async createSessionRecord(session: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    createdAt: string;
  }): Promise<void> {
    if (this.provider === 'supabase') {
      const { error } = await this.getSupa().from('sessions').insert({
        id: session.id,
        user_id: session.userId,
        token_hash: session.tokenHash,
        expires_at: session.expiresAt,
        created_at: session.createdAt,
      });
      if (error) throw new Error(error.message);
      return;
    }
    this.getSql()
      .prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(session.id, session.userId, session.tokenHash, session.expiresAt, session.createdAt);
  }

  async findSessionWithUser(tokenHash: string): Promise<{ user: UserProfile; expiresAt: string } | null> {
    if (this.provider === 'supabase') {
      const { data: ses, error } = await this.getSupa()
        .from('sessions')
        .select('user_id, expires_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();
      if (error || !ses) return null;
      const user = await this.findUserById(String(ses.user_id));
      if (!user) return null;
      return { user, expiresAt: String(ses.expires_at) };
    }
    const row = this.getSql()
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.created_at, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash);
    if (!row) return null;
    return {
      user: {
        id: String(row.id),
        name: String(row.name),
        email: String(row.email),
        role: row.role as UserRole,
        createdAt: String(row.created_at),
      },
      expiresAt: String(row.expires_at),
    };
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    if (this.provider === 'supabase') {
      await this.getSupa().from('sessions').delete().eq('token_hash', tokenHash);
      return;
    }
    this.getSql().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  // =========================================================================
  // DOCUMENTS
  // =========================================================================
  async createDocument(doc: DocumentRecord): Promise<void> {
    if (this.provider === 'supabase') {
      const { error } = await this.getSupa().from('documents').insert({
        id: doc.id,
        user_id: doc.userId,
        owner_role: doc.ownerRole,
        title: doc.title,
        original_filename: doc.originalFilename,
        file_type: doc.fileType,
        file_size: doc.fileSize,
        extracted_text: doc.extractedText,
        word_count: doc.wordCount,
        created_at: doc.createdAt,
      });
      if (error) throw new Error(error.message);
      return;
    }
    this.getSql()
      .prepare(
        `INSERT INTO documents (id, user_id, owner_role, title, original_filename, file_type, file_size, extracted_text, word_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        doc.id,
        doc.userId,
        doc.ownerRole,
        doc.title,
        doc.originalFilename,
        doc.fileType,
        doc.fileSize,
        doc.extractedText,
        doc.wordCount,
        doc.createdAt
      );
  }

  async listDocumentsByUser(userId: string): Promise<DocumentRecord[]> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('documents')
        .select('id, user_id, owner_role, title, original_filename, file_type, file_size, extracted_text, word_count, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({
        id: String(r.id),
        userId: String(r.user_id),
        ownerRole: r.owner_role as UserRole,
        title: String(r.title),
        originalFilename: String(r.original_filename),
        fileType: r.file_type as 'pdf' | 'docx',
        fileSize: Number(r.file_size),
        extractedText: String(r.extracted_text),
        wordCount: Number(r.word_count),
        createdAt: String(r.created_at),
      }));
    }
    const rows = this.getSql()
      .prepare(
        `SELECT id, user_id, owner_role, title, original_filename, file_type, file_size, extracted_text, word_count, created_at
         FROM documents WHERE user_id = ? ORDER BY created_at DESC`
      )
      .all(userId);
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      ownerRole: r.owner_role as UserRole,
      title: String(r.title),
      originalFilename: String(r.original_filename),
      fileType: r.file_type as 'pdf' | 'docx',
      fileSize: Number(r.file_size),
      extractedText: String(r.extracted_text),
      wordCount: Number(r.word_count),
      createdAt: String(r.created_at),
    }));
  }

  async findDocumentById(id: string): Promise<DocumentRecord | null> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('documents')
        .select('id, user_id, owner_role, title, original_filename, file_type, file_size, extracted_text, word_count, created_at')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: String(data.id),
        userId: String(data.user_id),
        ownerRole: data.owner_role as UserRole,
        title: String(data.title),
        originalFilename: String(data.original_filename),
        fileType: data.file_type as 'pdf' | 'docx',
        fileSize: Number(data.file_size),
        extractedText: String(data.extracted_text),
        wordCount: Number(data.word_count),
        createdAt: String(data.created_at),
      };
    }
    const r = this.getSql()
      .prepare(
        `SELECT id, user_id, owner_role, title, original_filename, file_type, file_size, extracted_text, word_count, created_at
         FROM documents WHERE id = ?`
      )
      .get(id);
    if (!r) return null;
    return {
      id: String(r.id),
      userId: String(r.user_id),
      ownerRole: r.owner_role as UserRole,
      title: String(r.title),
      originalFilename: String(r.original_filename),
      fileType: r.file_type as 'pdf' | 'docx',
      fileSize: Number(r.file_size),
      extractedText: String(r.extracted_text),
      wordCount: Number(r.word_count),
      createdAt: String(r.created_at),
    };
  }

  async deleteDocument(id: string, userId: string): Promise<boolean> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('documents')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .select('id');
      if (error) throw new Error(error.message);
      return Boolean(data && data.length > 0);
    }
    const res = this.getSql().prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(id, userId);
    return Number(res.changes || 0) > 0;
  }

  async countDocumentsByUser(userId: string): Promise<number> {
    if (this.provider === 'supabase') {
      const { count, error } = await this.getSupa()
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return count || 0;
    }
    const row = this.getSql().prepare('SELECT COUNT(*) as c FROM documents WHERE user_id = ?').get(userId) as { c: number };
    return Number(row.c);
  }

  // =========================================================================
  // PRACTICE QUIZZES
  // =========================================================================
  async listPracticeQuizzesForStudent(studentId: string): Promise<PracticeQuizRecord[]> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: quizzes, error } = await sb
        .from('practice_quizzes')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);

      const { data: attempts } = await sb
        .from('practice_attempts')
        .select('id, quiz_id, score, total_marks, percentage, completed_at')
        .eq('student_id', studentId)
        .order('completed_at', { ascending: false });

      const latestByQuiz = new Map<string, Record<string, unknown>>();
      for (const a of attempts || []) {
        const qid = String(a.quiz_id);
        if (!latestByQuiz.has(qid)) latestByQuiz.set(qid, a as Record<string, unknown>);
      }

      return (quizzes || []).map((q) => {
        const att = latestByQuiz.get(String(q.id));
        return {
          id: String(q.id),
          studentId: String(q.student_id),
          documentId: q.document_id ? String(q.document_id) : null,
          title: String(q.title),
          topic: String(q.topic),
          difficulty: q.difficulty as Difficulty,
          questionType: String(q.question_type) as QuestionType | 'mixed',
          questions: JSON.parse(String(q.questions_json)) as QuizQuestion[],
          createdAt: String(q.created_at),
          lastAttempt: att
            ? {
                id: String(att.id),
                score: Number(att.score),
                totalMarks: Number(att.total_marks),
                percentage: Number(att.percentage),
                completedAt: String(att.completed_at),
              }
            : null,
        };
      });
    }

    const rows = this.getSql()
      .prepare(
        `SELECT pq.*, pa.id as attempt_id, pa.score, pa.total_marks, pa.percentage, pa.completed_at
         FROM practice_quizzes pq
         LEFT JOIN practice_attempts pa ON pa.id = (
           SELECT id FROM practice_attempts WHERE quiz_id = pq.id AND student_id = ? ORDER BY completed_at DESC LIMIT 1
         )
         WHERE pq.student_id = ?
         ORDER BY pq.created_at DESC`
      )
      .all(studentId, studentId);

    return rows.map((q) => ({
      id: String(q.id),
      studentId: String(q.student_id),
      documentId: q.document_id ? String(q.document_id) : null,
      title: String(q.title),
      topic: String(q.topic),
      difficulty: q.difficulty as Difficulty,
      questionType: String(q.question_type) as QuestionType | 'mixed',
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
  }

  async createPracticeQuiz(quiz: {
    id: string;
    studentId: string;
    documentId: string | null;
    title: string;
    topic: string;
    difficulty: Difficulty;
    questionType: string;
    questions: QuizQuestion[];
    createdAt: string;
  }): Promise<void> {
    if (this.provider === 'supabase') {
      const { error } = await this.getSupa().from('practice_quizzes').insert({
        id: quiz.id,
        student_id: quiz.studentId,
        document_id: quiz.documentId,
        title: quiz.title,
        topic: quiz.topic,
        difficulty: quiz.difficulty,
        question_type: quiz.questionType,
        questions_json: JSON.stringify(quiz.questions),
        created_at: quiz.createdAt,
      });
      if (error) throw new Error(error.message);
      return;
    }
    this.getSql()
      .prepare(
        `INSERT INTO practice_quizzes (id, student_id, document_id, title, topic, difficulty, question_type, questions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        quiz.id,
        quiz.studentId,
        quiz.documentId,
        quiz.title,
        quiz.topic,
        quiz.difficulty,
        quiz.questionType,
        JSON.stringify(quiz.questions),
        quiz.createdAt
      );
  }

  async findPracticeQuiz(id: string, studentId: string): Promise<PracticeQuizRecord | null> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('practice_quizzes')
        .select('*')
        .eq('id', id)
        .eq('student_id', studentId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: String(data.id),
        studentId: String(data.student_id),
        documentId: data.document_id ? String(data.document_id) : null,
        title: String(data.title),
        topic: String(data.topic),
        difficulty: data.difficulty as Difficulty,
        questionType: String(data.question_type) as QuestionType | 'mixed',
        questions: JSON.parse(String(data.questions_json)) as QuizQuestion[],
        createdAt: String(data.created_at),
      };
    }
    const row = this.getSql()
      .prepare('SELECT * FROM practice_quizzes WHERE id = ? AND student_id = ?')
      .get(id, studentId);
    if (!row) return null;
    return {
      id: String(row.id),
      studentId: String(row.student_id),
      documentId: row.document_id ? String(row.document_id) : null,
      title: String(row.title),
      topic: String(row.topic),
      difficulty: row.difficulty as Difficulty,
      questionType: String(row.question_type) as QuestionType | 'mixed',
      questions: JSON.parse(String(row.questions_json)) as QuizQuestion[],
      createdAt: String(row.created_at),
    };
  }

  async deletePracticeQuiz(id: string, studentId: string): Promise<boolean> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('practice_quizzes')
        .delete()
        .eq('id', id)
        .eq('student_id', studentId)
        .select('id');
      if (error) throw new Error(error.message);
      return Boolean(data && data.length > 0);
    }
    const res = this.getSql()
      .prepare('DELETE FROM practice_quizzes WHERE id = ? AND student_id = ?')
      .run(id, studentId);
    return Number(res.changes || 0) > 0;
  }

  async createPracticeAttempt(attempt: {
    id: string;
    quizId: string;
    studentId: string;
    answers: Record<string, string>;
    score: number;
    totalMarks: number;
    percentage: number;
    completedAt: string;
  }): Promise<void> {
    if (this.provider === 'supabase') {
      const { error } = await this.getSupa().from('practice_attempts').insert({
        id: attempt.id,
        quiz_id: attempt.quizId,
        student_id: attempt.studentId,
        answers_json: JSON.stringify(attempt.answers),
        score: attempt.score,
        total_marks: attempt.totalMarks,
        percentage: attempt.percentage,
        completed_at: attempt.completedAt,
      });
      if (error) throw new Error(error.message);
      return;
    }
    this.getSql()
      .prepare(
        `INSERT INTO practice_attempts (id, quiz_id, student_id, answers_json, score, total_marks, percentage, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        attempt.id,
        attempt.quizId,
        attempt.studentId,
        JSON.stringify(attempt.answers),
        attempt.score,
        attempt.totalMarks,
        attempt.percentage,
        attempt.completedAt
      );
  }

  async listRecentPracticeAttempts(
    studentId: string,
    limit: number
  ): Promise<Array<{ id: string; quizTitle: string; score: number; totalMarks: number; percentage: number; completedAt: string }>> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: attempts, error } = await sb
        .from('practice_attempts')
        .select('id, quiz_id, score, total_marks, percentage, completed_at')
        .eq('student_id', studentId)
        .order('completed_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      if (!attempts || attempts.length === 0) return [];
      const quizIds = Array.from(new Set(attempts.map((a) => String(a.quiz_id))));
      const { data: quizzes } = await sb.from('practice_quizzes').select('id, title').in('id', quizIds);
      const titleMap = new Map((quizzes || []).map((q) => [String(q.id), String(q.title)]));
      return attempts.map((a) => ({
        id: String(a.id),
        quizTitle: titleMap.get(String(a.quiz_id)) || 'Practice Quiz',
        score: Number(a.score),
        totalMarks: Number(a.total_marks),
        percentage: Number(a.percentage),
        completedAt: String(a.completed_at),
      }));
    }

    const rows = this.getSql()
      .prepare(
        `SELECT pa.*, pq.title as quiz_title
         FROM practice_attempts pa
         JOIN practice_quizzes pq ON pq.id = pa.quiz_id
         WHERE pa.student_id = ?
         ORDER BY pa.completed_at DESC
         LIMIT ?`
      )
      .all(studentId, limit);

    return rows.map((pa) => ({
      id: String(pa.id),
      quizTitle: String(pa.quiz_title),
      score: Number(pa.score),
      totalMarks: Number(pa.total_marks),
      percentage: Number(pa.percentage),
      completedAt: String(pa.completed_at),
    }));
  }

  // =========================================================================
  // QUESTION BANK
  // =========================================================================
  async listBankQuestions(teacherId: string): Promise<Array<QuizQuestion & { createdAt: string }>> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: rows, error } = await sb
        .from('question_bank')
        .select('*')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) return [];
      const bankIds = rows.map((r) => String(r.id));
      const { data: opts } = await sb
        .from('question_options')
        .select('bank_question_id, option_text, option_order')
        .in('bank_question_id', bankIds)
        .order('option_order', { ascending: true });
      const optsMap = new Map<string, string[]>();
      for (const o of opts || []) {
        const bid = String(o.bank_question_id);
        const list = optsMap.get(bid) || [];
        list.push(String(o.option_text));
        optsMap.set(bid, list);
      }
      return rows.map((r) => ({
        id: String(r.id),
        questionType: r.question_type as QuestionType,
        difficulty: r.difficulty as Difficulty,
        topic: String(r.topic),
        prompt: String(r.prompt),
        options: optsMap.get(String(r.id)) || [],
        correctAnswer: String(r.correct_answer || ''),
        explanation: String(r.explanation || ''),
        suggestedAnswer: String(r.suggested_answer || ''),
        markingGuidance: String(r.marking_guidance || ''),
        marks: Number(r.marks),
        createdAt: String(r.created_at),
      }));
    }

    const rows = this.getSql()
      .prepare('SELECT * FROM question_bank WHERE teacher_id = ? ORDER BY created_at DESC')
      .all(teacherId);
    const getOpts = this.getSql().prepare(
      'SELECT option_text FROM question_options WHERE bank_question_id = ? ORDER BY option_order ASC'
    );
    return rows.map((r) => {
      const opts = getOpts.all(String(r.id)) as Array<{ option_text: string }>;
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
  }

  async createBankQuestions(
    teacherId: string,
    documentId: string | null,
    questionsInput: QuizQuestion[]
  ): Promise<string[]> {
    const now = new Date().toISOString();
    const savedIds: string[] = [];
    const bankRows: Array<Record<string, unknown>> = [];
    const optRows: Array<Record<string, unknown>> = [];

    for (const q of questionsInput) {
      const prompt = String(q.prompt || '').trim();
      if (prompt.length < 5) continue;
      const id = `qb_${crypto.randomUUID()}`;
      const qType = q.questionType || 'mcq';
      const difficulty = q.difficulty || 'Medium';
      const marks =
        Number(q.marks) || (qType === 'long_answer' ? 10 : qType === 'short_answer' ? 5 : qType === 'true_false' ? 1 : 2);

      bankRows.push({
        id,
        teacher_id: teacherId,
        document_id: documentId,
        question_type: qType,
        difficulty,
        topic: String(q.topic || 'General').trim(),
        prompt,
        correct_answer: String(q.correctAnswer || '').trim(),
        explanation: String(q.explanation || '').trim(),
        suggested_answer: String(q.suggestedAnswer || '').trim(),
        marking_guidance: String(q.markingGuidance || '').trim(),
        marks,
        created_at: now,
      });

      const opts =
        qType === 'true_false'
          ? ['True', 'False']
          : Array.isArray(q.options)
            ? q.options.map((o) => String(o).trim()).filter(Boolean)
            : [];
      opts.forEach((optText, idx) => {
        optRows.push({
          id: `opt_${crypto.randomUUID()}`,
          question_id: null,
          bank_question_id: id,
          option_text: optText,
          option_order: idx,
          is_correct: optText.toLowerCase() === String(q.correctAnswer || '').trim().toLowerCase() ? 1 : 0,
        });
      });

      savedIds.push(id);
    }

    if (bankRows.length === 0) return [];

    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { error } = await sb.from('question_bank').insert(bankRows);
      if (error) throw new Error(error.message);
      if (optRows.length > 0) {
        const { error: optErr } = await sb.from('question_options').insert(optRows);
        if (optErr) throw new Error(optErr.message);
      }
      return savedIds;
    }

    const db = this.getSql();
    const insertBank = db.prepare(
      `INSERT INTO question_bank (id, teacher_id, document_id, question_type, difficulty, topic, prompt, correct_answer, explanation, suggested_answer, marking_guidance, marks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertOpt = db.prepare(
      `INSERT INTO question_options (id, question_id, bank_question_id, option_text, option_order, is_correct)
       VALUES (?, NULL, ?, ?, ?, ?)`
    );
    for (const r of bankRows) {
      insertBank.run(
        r.id,
        r.teacher_id,
        r.document_id,
        r.question_type,
        r.difficulty,
        r.topic,
        r.prompt,
        r.correct_answer,
        r.explanation,
        r.suggested_answer,
        r.marking_guidance,
        r.marks,
        r.created_at
      );
    }
    for (const o of optRows) {
      insertOpt.run(o.id, o.bank_question_id, o.option_text, o.option_order, o.is_correct);
    }
    return savedIds;
  }

  async deleteBankQuestion(id: string, teacherId: string): Promise<boolean> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('question_bank')
        .delete()
        .eq('id', id)
        .eq('teacher_id', teacherId)
        .select('id');
      if (error) throw new Error(error.message);
      return Boolean(data && data.length > 0);
    }
    const res = this.getSql().prepare('DELETE FROM question_bank WHERE id = ? AND teacher_id = ?').run(id, teacherId);
    return Number(res.changes || 0) > 0;
  }

  // =========================================================================
  // EXAMS, ATTEMPTS & LOCKS
  // =========================================================================
  async getActiveExamAttemptLock(
    studentId: string
  ): Promise<{ attemptId: string; examId: string; examTitle: string } | null> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: att } = await sb
        .from('exam_attempts')
        .select('id, exam_id')
        .eq('student_id', studentId)
        .eq('status', 'in_progress')
        .limit(1)
        .maybeSingle();
      if (!att) return null;
      const { data: exam } = await sb.from('exams').select('title').eq('id', String(att.exam_id)).maybeSingle();
      return {
        attemptId: String(att.id),
        examId: String(att.exam_id),
        examTitle: exam ? String(exam.title) : 'Official Exam',
      };
    }

    const row = this.getSql()
      .prepare(
        `SELECT ea.id as attempt_id, ea.exam_id, e.title as exam_title
         FROM exam_attempts ea
         JOIN exams e ON e.id = ea.exam_id
         WHERE ea.student_id = ? AND ea.status = 'in_progress'
         LIMIT 1`
      )
      .get(studentId);
    if (!row) return null;
    return {
      attemptId: String(row.attempt_id),
      examId: String(row.exam_id),
      examTitle: String(row.exam_title),
    };
  }

  private mapExamRow(e: Record<string, unknown>, extra?: Partial<StoredExamRow>): StoredExamRow {
    return {
      id: String(e.id),
      teacher_id: String(e.teacher_id),
      teacher_name: e.teacher_name ? String(e.teacher_name) : extra?.teacher_name,
      title: String(e.title),
      subject: String(e.subject),
      instructions: String(e.instructions),
      duration_minutes: Number(e.duration_minutes),
      total_marks: Number(e.total_marks),
      passing_marks: Number(e.passing_marks),
      deadline_at: e.deadline_at ? String(e.deadline_at) : null,
      status: e.status as 'draft' | 'published',
      randomize_questions: Boolean(e.randomize_questions),
      randomize_options: Boolean(e.randomize_options),
      track_tab_switches: Boolean(e.track_tab_switches),
      warn_on_tab_leave: Boolean(e.warn_on_tab_leave),
      require_fullscreen: e.require_fullscreen !== undefined ? Boolean(e.require_fullscreen) : true,
      block_copy_paste: e.block_copy_paste !== undefined ? Boolean(e.block_copy_paste) : true,
      max_tab_switches: e.max_tab_switches !== undefined ? Number(e.max_tab_switches) : 3,
      assign_all: Boolean(e.assign_all),
      created_at: String(e.created_at),
      question_count: extra?.question_count ?? (e.question_count !== undefined ? Number(e.question_count) : undefined),
      submission_count: extra?.submission_count ?? (e.submission_count !== undefined ? Number(e.submission_count) : undefined),
      pending_count: extra?.pending_count ?? (e.pending_count !== undefined ? Number(e.pending_count) : undefined),
    };
  }

  async listPublishedExamsForStudent(studentId: string): Promise<
    Array<{
      exam: StoredExamRow;
      attempt: StoredAttemptRow | null;
      result: Record<string, unknown> | null;
    }>
  > {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: exams, error } = await sb
        .from('exams')
        .select('*')
        .eq('status', 'published')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      if (!exams || exams.length === 0) return [];

      const { data: assignments } = await sb
        .from('exam_assignments')
        .select('exam_id')
        .eq('student_id', studentId);
      const assignedIds = new Set((assignments || []).map((a) => String(a.exam_id)));

      const visibleExams = exams.filter((e) => Boolean(e.assign_all) || assignedIds.has(String(e.id)));
      if (visibleExams.length === 0) return [];

      const teacherIds = Array.from(new Set(visibleExams.map((e) => String(e.teacher_id))));
      const examIds = visibleExams.map((e) => String(e.id));

      const [{ data: teachers }, { data: questions }, { data: attempts }, { data: results }] = await Promise.all([
        sb.from('users').select('id, name').in('id', teacherIds),
        sb.from('questions').select('exam_id').in('exam_id', examIds),
        sb.from('exam_attempts').select('*').eq('student_id', studentId).in('exam_id', examIds),
        sb.from('results').select('*').eq('student_id', studentId).in('exam_id', examIds),
      ]);

      const teacherMap = new Map((teachers || []).map((t) => [String(t.id), String(t.name)]));
      const qCountMap = new Map<string, number>();
      for (const q of questions || []) {
        const eid = String(q.exam_id);
        qCountMap.set(eid, (qCountMap.get(eid) || 0) + 1);
      }
      const attMap = new Map((attempts || []).map((a) => [String(a.exam_id), a as StoredAttemptRow]));
      const resMap = new Map((results || []).map((r) => [String(r.attempt_id), r as Record<string, unknown>]));

      return visibleExams.map((e) => {
        const att = attMap.get(String(e.id)) || null;
        return {
          exam: this.mapExamRow(e, {
            teacher_name: teacherMap.get(String(e.teacher_id)) || 'Instructor',
            question_count: qCountMap.get(String(e.id)) || 0,
          }),
          attempt: att,
          result: att ? resMap.get(att.id) || null : null,
        };
      });
    }

    const db = this.getSql();
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
      .all(studentId);

    const out = [];
    for (const e of examRows) {
      const attempt = db
        .prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND student_id = ?')
        .get(String(e.id), studentId) as StoredAttemptRow | undefined;
      let result: Record<string, unknown> | null = null;
      if (attempt) {
        result =
          db.prepare('SELECT * FROM results WHERE attempt_id = ?').get(String(attempt.id)) ?? null;
      }
      out.push({
        exam: this.mapExamRow(e),
        attempt: attempt ?? null,
        result,
      });
    }
    return out;
  }

  async listTeacherExams(teacherId: string): Promise<StoredExamRow[]> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: exams, error } = await sb
        .from('exams')
        .select('*')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      if (!exams || exams.length === 0) return [];
      const examIds = exams.map((e) => String(e.id));
      const [{ data: qs }, { data: atts }] = await Promise.all([
        sb.from('questions').select('exam_id').in('exam_id', examIds),
        sb.from('exam_attempts').select('exam_id, status').in('exam_id', examIds),
      ]);
      const qCounts = new Map<string, number>();
      for (const q of qs || []) qCounts.set(String(q.exam_id), (qCounts.get(String(q.exam_id)) || 0) + 1);
      const subCounts = new Map<string, number>();
      const pendCounts = new Map<string, number>();
      for (const a of atts || []) {
        const eid = String(a.exam_id);
        if (a.status === 'submitted' || a.status === 'evaluated') {
          subCounts.set(eid, (subCounts.get(eid) || 0) + 1);
        }
        if (a.status === 'submitted') {
          pendCounts.set(eid, (pendCounts.get(eid) || 0) + 1);
        }
      }
      return exams.map((e) =>
        this.mapExamRow(e, {
          question_count: qCounts.get(String(e.id)) || 0,
          submission_count: subCounts.get(String(e.id)) || 0,
          pending_count: pendCounts.get(String(e.id)) || 0,
        })
      );
    }

    const rows = this.getSql()
      .prepare(
        `SELECT e.*,
          (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as question_count,
          (SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id = e.id AND ea.status IN ('submitted', 'evaluated')) as submission_count,
          (SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id = e.id AND ea.status = 'submitted') as pending_count
         FROM exams e
         WHERE e.teacher_id = ?
         ORDER BY e.created_at DESC`
      )
      .all(teacherId);
    return rows.map((e) => this.mapExamRow(e));
  }

  async findExamById(examId: string): Promise<StoredExamRow | null> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa().from('exams').select('*').eq('id', examId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? this.mapExamRow(data) : null;
    }
    const row = this.getSql().prepare('SELECT * FROM exams WHERE id = ?').get(examId);
    return row ? this.mapExamRow(row) : null;
  }

  async findPublishedExamById(examId: string): Promise<StoredExamRow | null> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('exams')
        .select('*')
        .eq('id', examId)
        .eq('status', 'published')
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? this.mapExamRow(data) : null;
    }
    const row = this.getSql().prepare('SELECT * FROM exams WHERE id = ? AND status = ?').get(examId, 'published');
    return row ? this.mapExamRow(row) : null;
  }

  async isStudentAssigned(examId: string, studentId: string): Promise<boolean> {
    if (this.provider === 'supabase') {
      const { data } = await this.getSupa()
        .from('exam_assignments')
        .select('id')
        .eq('exam_id', examId)
        .eq('student_id', studentId)
        .maybeSingle();
      return Boolean(data);
    }
    const row = this.getSql()
      .prepare('SELECT id FROM exam_assignments WHERE exam_id = ? AND student_id = ?')
      .get(examId, studentId);
    return Boolean(row);
  }

  async createExam(input: {
    id: string;
    teacherId: string;
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
    assignedStudentIds: string[];
    questions: QuizQuestion[];
    createdAt: string;
  }): Promise<void> {
    const qRows: Array<Record<string, unknown>> = [];
    const optRows: Array<Record<string, unknown>> = [];

    input.questions.forEach((q, idx) => {
      const qId = `eq_${crypto.randomUUID()}`;
      const qType = q.questionType || 'mcq';
      const marks = Number(q.marks) || 2;
      qRows.push({
        id: qId,
        exam_id: input.id,
        bank_question_id: null,
        question_type: qType,
        difficulty: q.difficulty || 'Medium',
        prompt: String(q.prompt).trim(),
        correct_answer: String(q.correctAnswer || '').trim(),
        explanation: String(q.explanation || '').trim(),
        suggested_answer: String(q.suggestedAnswer || '').trim(),
        marking_guidance: String(q.markingGuidance || '').trim(),
        marks,
        question_order: idx + 1,
      });

      const opts =
        qType === 'true_false'
          ? ['True', 'False']
          : Array.isArray(q.options)
            ? q.options.map((o) => String(o).trim()).filter(Boolean)
            : [];
      opts.forEach((optText, oIdx) => {
        optRows.push({
          id: `opt_${crypto.randomUUID()}`,
          question_id: qId,
          bank_question_id: null,
          option_text: optText,
          option_order: oIdx,
          is_correct: optText.toLowerCase() === String(q.correctAnswer || '').trim().toLowerCase() ? 1 : 0,
        });
      });
    });

    const assignRows =
      !input.assignAll && input.assignedStudentIds.length > 0
        ? input.assignedStudentIds.map((sid) => ({
            id: `asg_${crypto.randomUUID()}`,
            exam_id: input.id,
            student_id: sid,
            assigned_at: input.createdAt,
          }))
        : [];

    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { error } = await sb.from('exams').insert({
        id: input.id,
        teacher_id: input.teacherId,
        title: input.title,
        subject: input.subject,
        instructions: input.instructions,
        duration_minutes: input.durationMinutes,
        total_marks: input.totalMarks,
        passing_marks: input.passingMarks,
        deadline_at: input.deadlineAt,
        status: input.status,
        randomize_questions: input.randomizeQuestions ? 1 : 0,
        randomize_options: input.randomizeOptions ? 1 : 0,
        track_tab_switches: input.trackTabSwitches ? 1 : 0,
        warn_on_tab_leave: input.warnOnTabLeave ? 1 : 0,
        require_fullscreen: input.requireFullscreen ? 1 : 0,
        block_copy_paste: input.blockCopyPaste ? 1 : 0,
        max_tab_switches: input.maxTabSwitches,
        assign_all: input.assignAll ? 1 : 0,
        created_at: input.createdAt,
      });
      if (error) throw new Error(error.message);
      if (qRows.length > 0) await sb.from('questions').insert(qRows);
      if (optRows.length > 0) await sb.from('question_options').insert(optRows);
      if (assignRows.length > 0) await sb.from('exam_assignments').insert(assignRows);
      return;
    }

    const db = this.getSql();
    db.prepare(
      `INSERT INTO exams (id, teacher_id, title, subject, instructions, duration_minutes, total_marks, passing_marks, deadline_at, status, randomize_questions, randomize_options, track_tab_switches, warn_on_tab_leave, require_fullscreen, block_copy_paste, max_tab_switches, assign_all, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.teacherId,
      input.title,
      input.subject,
      input.instructions,
      input.durationMinutes,
      input.totalMarks,
      input.passingMarks,
      input.deadlineAt,
      input.status,
      input.randomizeQuestions ? 1 : 0,
      input.randomizeOptions ? 1 : 0,
      input.trackTabSwitches ? 1 : 0,
      input.warnOnTabLeave ? 1 : 0,
      input.requireFullscreen ? 1 : 0,
      input.blockCopyPaste ? 1 : 0,
      input.maxTabSwitches,
      input.assignAll ? 1 : 0,
      input.createdAt
    );

    const insertQ = db.prepare(
      `INSERT INTO questions (id, exam_id, bank_question_id, question_type, difficulty, prompt, correct_answer, explanation, suggested_answer, marking_guidance, marks, question_order)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const q of qRows) {
      insertQ.run(q.id, q.exam_id, q.question_type, q.difficulty, q.prompt, q.correct_answer, q.explanation, q.suggested_answer, q.marking_guidance, q.marks, q.question_order);
    }
    const insertOpt = db.prepare(
      `INSERT INTO question_options (id, question_id, bank_question_id, option_text, option_order, is_correct)
       VALUES (?, ?, NULL, ?, ?, ?)`
    );
    for (const o of optRows) {
      insertOpt.run(o.id, o.question_id, o.option_text, o.option_order, o.is_correct);
    }
    const insertAssign = db.prepare(
      'INSERT OR IGNORE INTO exam_assignments (id, exam_id, student_id, assigned_at) VALUES (?, ?, ?, ?)'
    );
    for (const a of assignRows) {
      insertAssign.run(a.id, a.exam_id, a.student_id, a.assigned_at);
    }
  }

  async updateExamStatus(examId: string, teacherId: string, status: 'draft' | 'published'): Promise<boolean> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('exams')
        .update({ status })
        .eq('id', examId)
        .eq('teacher_id', teacherId)
        .select('id');
      if (error) throw new Error(error.message);
      return Boolean(data && data.length > 0);
    }
    const res = this.getSql().prepare('UPDATE exams SET status = ? WHERE id = ? AND teacher_id = ?').run(status, examId, teacherId);
    return Number(res.changes || 0) > 0;
  }

  async updateExamAssignments(examId: string, teacherId: string, assignAll: boolean, studentIds: string[]): Promise<boolean> {
    const exam = await this.findExamById(examId);
    if (!exam || exam.teacher_id !== teacherId) return false;

    const now = new Date().toISOString();
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      await sb.from('exams').update({ assign_all: assignAll ? 1 : 0 }).eq('id', examId);
      await sb.from('exam_assignments').delete().eq('exam_id', examId);
      if (!assignAll && studentIds.length > 0) {
        await sb.from('exam_assignments').insert(
          studentIds.map((sid) => ({
            id: `asg_${crypto.randomUUID()}`,
            exam_id: examId,
            student_id: sid,
            assigned_at: now,
          }))
        );
      }
      return true;
    }

    const db = this.getSql();
    db.prepare('UPDATE exams SET assign_all = ? WHERE id = ?').run(assignAll ? 1 : 0, examId);
    db.prepare('DELETE FROM exam_assignments WHERE exam_id = ?').run(examId);
    if (!assignAll && studentIds.length > 0) {
      const insertAssign = db.prepare(
        'INSERT OR IGNORE INTO exam_assignments (id, exam_id, student_id, assigned_at) VALUES (?, ?, ?, ?)'
      );
      for (const sid of studentIds) {
        insertAssign.run(`asg_${crypto.randomUUID()}`, examId, sid, now);
      }
    }
    return true;
  }

  async deleteExam(examId: string, teacherId: string): Promise<boolean> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('exams')
        .delete()
        .eq('id', examId)
        .eq('teacher_id', teacherId)
        .select('id');
      if (error) throw new Error(error.message);
      return Boolean(data && data.length > 0);
    }
    const res = this.getSql().prepare('DELETE FROM exams WHERE id = ? AND teacher_id = ?').run(examId, teacherId);
    return Number(res.changes || 0) > 0;
  }

  async listExamQuestions(examId: string, includeOptions = false): Promise<StoredQuestionRow[]> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: qs, error } = await sb
        .from('questions')
        .select('*')
        .eq('exam_id', examId)
        .order('question_order', { ascending: true });
      if (error) throw new Error(error.message);
      const qList = (qs || []) as StoredQuestionRow[];
      if (!includeOptions || qList.length === 0) return qList;

      const qIds = qList.map((q) => String(q.id));
      const { data: opts } = await sb
        .from('question_options')
        .select('question_id, option_text, option_order')
        .in('question_id', qIds)
        .order('option_order', { ascending: true });
      const optMap = new Map<string, string[]>();
      for (const o of opts || []) {
        const qid = String(o.question_id);
        const arr = optMap.get(qid) || [];
        arr.push(String(o.option_text));
        optMap.set(qid, arr);
      }
      return qList.map((q) => ({ ...q, options: optMap.get(String(q.id)) || [] }));
    }

    const db = this.getSql();
    const qs = db.prepare('SELECT * FROM questions WHERE exam_id = ? ORDER BY question_order ASC').all(examId);
    const getOpts = db.prepare('SELECT option_text FROM question_options WHERE question_id = ? ORDER BY option_order ASC');
    return qs.map((q) => ({
      id: String(q.id),
      exam_id: String(q.exam_id),
      question_type: q.question_type as QuestionType,
      difficulty: q.difficulty as Difficulty,
      prompt: String(q.prompt),
      correct_answer: String(q.correct_answer || ''),
      explanation: String(q.explanation || ''),
      suggested_answer: String(q.suggested_answer || ''),
      marking_guidance: String(q.marking_guidance || ''),
      marks: Number(q.marks),
      question_order: Number(q.question_order),
      options: includeOptions
        ? (getOpts.all(String(q.id)) as Array<{ option_text: string }>).map((o) => o.option_text)
        : undefined,
    }));
  }

  async findExamQuestion(questionId: string, examId: string): Promise<{ id: string; question_type: QuestionType; marks: number } | null> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('questions')
        .select('id, question_type, marks')
        .eq('id', questionId)
        .eq('exam_id', examId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { id: string; question_type: QuestionType; marks: number } | null) ?? null;
    }
    const row = this.getSql()
      .prepare('SELECT id, question_type, marks FROM questions WHERE id = ? AND exam_id = ?')
      .get(questionId, examId);
    return row ? { id: String(row.id), question_type: row.question_type as QuestionType, marks: Number(row.marks) } : null;
  }

  async findAttemptForExamStudent(examId: string, studentId: string): Promise<StoredAttemptRow | null> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('exam_attempts')
        .select('*')
        .eq('exam_id', examId)
        .eq('student_id', studentId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as StoredAttemptRow | null) ?? null;
    }
    const row = this.getSql()
      .prepare('SELECT * FROM exam_attempts WHERE exam_id = ? AND student_id = ?')
      .get(examId, studentId);
    return (row as unknown as StoredAttemptRow | undefined) ?? null;
  }

  async findAttemptWithExamForStudent(
    attemptId: string,
    studentId: string
  ): Promise<{ attempt: StoredAttemptRow; exam: StoredExamRow } | null> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: att } = await sb
        .from('exam_attempts')
        .select('*')
        .eq('id', attemptId)
        .eq('student_id', studentId)
        .maybeSingle();
      if (!att) return null;
      const exam = await this.findExamById(String(att.exam_id));
      if (!exam) return null;
      return { attempt: att as StoredAttemptRow, exam };
    }
    const row = this.getSql()
      .prepare('SELECT * FROM exam_attempts WHERE id = ? AND student_id = ?')
      .get(attemptId, studentId);
    if (!row) return null;
    const exam = await this.findExamById(String(row.exam_id));
    if (!exam) return null;
    return { attempt: row as unknown as StoredAttemptRow, exam };
  }

  async createExamAttempt(attempt: StoredAttemptRow): Promise<void> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { error } = await sb.from('exam_attempts').insert(attempt);
      if (error) throw new Error(error.message);
      await sb.from('activity_logs').insert({
        id: `log_${crypto.randomUUID()}`,
        attempt_id: attempt.id,
        exam_id: attempt.exam_id,
        student_id: attempt.student_id,
        event_type: 'exam_started',
        details: 'Exam attempt started',
        created_at: attempt.started_at,
      });
      return;
    }
    const db = this.getSql();
    db.prepare(
      `INSERT INTO exam_attempts (id, exam_id, student_id, status, started_at, submitted_at, question_seed, tab_switch_count, focus_loss_count, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 0, ?)`
    ).run(attempt.id, attempt.exam_id, attempt.student_id, attempt.status, attempt.started_at, attempt.question_seed, attempt.created_at);

    db.prepare(
      `INSERT INTO activity_logs (id, attempt_id, exam_id, student_id, event_type, details, created_at)
       VALUES (?, ?, ?, ?, 'exam_started', 'Exam attempt started', ?)`
    ).run(`log_${crypto.randomUUID()}`, attempt.id, attempt.exam_id, attempt.student_id, attempt.started_at);
  }

  async listStudentAnswers(attemptId: string): Promise<Record<string, string>> {
    if (this.provider === 'supabase') {
      const { data, error } = await this.getSupa()
        .from('student_answers')
        .select('question_id, answer_text, selected_option')
        .eq('attempt_id', attemptId);
      if (error) throw new Error(error.message);
      const out: Record<string, string> = {};
      for (const a of data || []) {
        out[String(a.question_id)] = String(a.selected_option || a.answer_text || '');
      }
      return out;
    }
    const rows = this.getSql()
      .prepare('SELECT question_id, answer_text, selected_option FROM student_answers WHERE attempt_id = ?')
      .all(attemptId);
    const out: Record<string, string> = {};
    for (const a of rows) {
      out[String(a.question_id)] = String(a.selected_option || a.answer_text || '');
    }
    return out;
  }

  async upsertStudentAnswer(input: {
    attemptId: string;
    questionId: string;
    answerText: string;
    selectedOption: string;
    updatedAt: string;
  }): Promise<void> {
    if (this.provider === 'supabase') {
      const { error } = await this.getSupa()
        .from('student_answers')
        .upsert(
          {
            id: `ans_${crypto.randomUUID()}`,
            attempt_id: input.attemptId,
            question_id: input.questionId,
            answer_text: input.answerText,
            selected_option: input.selectedOption,
            updated_at: input.updatedAt,
          },
          { onConflict: 'attempt_id,question_id' }
        );
      if (error) throw new Error(error.message);
      return;
    }
    this.getSql()
      .prepare(
        `INSERT INTO student_answers (id, attempt_id, question_id, answer_text, selected_option, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id, question_id)
         DO UPDATE SET answer_text = excluded.answer_text, selected_option = excluded.selected_option, updated_at = excluded.updated_at`
      )
      .run(`ans_${crypto.randomUUID()}`, input.attemptId, input.questionId, input.answerText, input.selectedOption, input.updatedAt);
  }

  async logSimpleActivityEvent(input: {
    attemptId: string;
    examId: string;
    studentId: string;
    eventType: string;
    details: string;
    createdAt: string;
  }): Promise<void> {
    if (this.provider === 'supabase') {
      await this.getSupa().from('activity_logs').insert({
        id: `log_${crypto.randomUUID()}`,
        attempt_id: input.attemptId,
        exam_id: input.examId,
        student_id: input.studentId,
        event_type: input.eventType,
        details: input.details,
        created_at: input.createdAt,
      });
      return;
    }
    this.getSql()
      .prepare(
        `INSERT INTO activity_logs (id, attempt_id, exam_id, student_id, event_type, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(`log_${crypto.randomUUID()}`, input.attemptId, input.examId, input.studentId, input.eventType, input.details, input.createdAt);
  }

  async recordExamSecurityEvent(input: {
    attemptId: string;
    examId: string;
    studentId: string;
    eventType: string;
    details: string;
    currentTabSwitchCount: number;
    currentFocusLossCount: number;
  }): Promise<{ tabSwitchCount: number; focusLossCount: number }> {
    const now = new Date().toISOString();
    let tabSwitchCount = input.currentTabSwitchCount;
    let focusLossCount = input.currentFocusLossCount;

    if (input.eventType === 'tab_hidden' || input.eventType === 'fullscreen_exited') {
      tabSwitchCount += 1;
    } else if (input.eventType === 'window_blur') {
      focusLossCount += 1;
    }

    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      if (input.eventType === 'tab_hidden' || input.eventType === 'fullscreen_exited') {
        await sb.from('exam_attempts').update({ tab_switch_count: tabSwitchCount }).eq('id', input.attemptId);
      } else if (input.eventType === 'window_blur') {
        await sb.from('exam_attempts').update({ focus_loss_count: focusLossCount }).eq('id', input.attemptId);
      }
      await sb.from('activity_logs').insert({
        id: `log_${crypto.randomUUID()}`,
        attempt_id: input.attemptId,
        exam_id: input.examId,
        student_id: input.studentId,
        event_type: input.eventType,
        details: input.details,
        created_at: now,
      });
      return { tabSwitchCount, focusLossCount };
    }

    const db = this.getSql();
    if (input.eventType === 'tab_hidden' || input.eventType === 'fullscreen_exited') {
      db.prepare('UPDATE exam_attempts SET tab_switch_count = tab_switch_count + 1 WHERE id = ?').run(input.attemptId);
    } else if (input.eventType === 'window_blur') {
      db.prepare('UPDATE exam_attempts SET focus_loss_count = focus_loss_count + 1 WHERE id = ?').run(input.attemptId);
    }
    db.prepare(
      `INSERT INTO activity_logs (id, attempt_id, exam_id, student_id, event_type, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(`log_${crypto.randomUUID()}`, input.attemptId, input.examId, input.studentId, input.eventType, input.details, now);

    const updated = db
      .prepare('SELECT tab_switch_count, focus_loss_count FROM exam_attempts WHERE id = ?')
      .get(input.attemptId) as { tab_switch_count: number; focus_loss_count: number };
    return {
      tabSwitchCount: Number(updated.tab_switch_count),
      focusLossCount: Number(updated.focus_loss_count),
    };
  }

  async finalizeAttemptSubmission(
    attempt: {
      id: string;
      exam_id: string;
      student_id: string;
      total_marks: number;
      passing_marks: number;
    },
    logEventType: string,
    logDetails: string
  ): Promise<{ attemptStatus: 'submitted' | 'evaluated' }> {
    const nowIso = new Date().toISOString();
    const examQuestions = await this.listExamQuestions(attempt.exam_id, false);
    const answersMap = await this.listStudentAnswers(attempt.id);

    const grading = gradeObjectiveQuestions(
      examQuestions.map((q) => ({
        id: q.id,
        questionType: q.question_type,
        correctAnswer: q.correct_answer,
        marks: q.marks,
      })),
      answersMap
    );

    const resultStatus = grading.hasDescriptiveQuestions ? 'pending_evaluation' : 'evaluated';
    const attemptStatus = grading.hasDescriptiveQuestions ? 'submitted' : 'evaluated';
    const totalMarks = Number(attempt.total_marks);
    const passingMarks = Number(attempt.passing_marks);
    const computed = computeFinalResult(grading.objectiveScore, 0, totalMarks, passingMarks);

    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      for (const q of examQuestions) {
        const resQ = grading.perQuestion[q.id];
        const isCorrectVal = resQ.isCorrect === null ? null : resQ.isCorrect ? 1 : 0;
        const { data: updated } = await sb
          .from('student_answers')
          .update({ is_correct: isCorrectVal, marks_awarded: resQ.marksAwarded })
          .eq('attempt_id', attempt.id)
          .eq('question_id', q.id)
          .select('id');
        if (!updated || updated.length === 0) {
          await sb.from('student_answers').insert({
            id: `ans_${crypto.randomUUID()}`,
            attempt_id: attempt.id,
            question_id: q.id,
            answer_text: '',
            selected_option: '',
            is_correct: isCorrectVal,
            marks_awarded: resQ.marksAwarded,
            updated_at: nowIso,
          });
        }
      }

      await sb.from('exam_attempts').update({ status: attemptStatus, submitted_at: nowIso }).eq('id', attempt.id);
      await sb.from('results').upsert(
        {
          id: `res_${crypto.randomUUID()}`,
          attempt_id: attempt.id,
          exam_id: attempt.exam_id,
          student_id: attempt.student_id,
          objective_score: grading.objectiveScore,
          descriptive_score: 0,
          total_score: computed.totalScore,
          total_marks: totalMarks,
          percentage: computed.percentage,
          passed: computed.passed ? 1 : 0,
          status: resultStatus,
          published_at: nowIso,
        },
        { onConflict: 'attempt_id', ignoreDuplicates: true }
      );
      await sb.from('activity_logs').insert({
        id: `log_${crypto.randomUUID()}`,
        attempt_id: attempt.id,
        exam_id: attempt.exam_id,
        student_id: attempt.student_id,
        event_type: logEventType,
        details: logDetails,
        created_at: nowIso,
      });
      return { attemptStatus };
    }

    const db = this.getSql();
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

    db.prepare('UPDATE exam_attempts SET status = ?, submitted_at = ? WHERE id = ?').run(attemptStatus, nowIso, attempt.id);
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

  async getResultDetail(attemptId: string): Promise<{ detail: ExamResultDetail; teacherId: string; status: string } | null> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: att } = await sb.from('exam_attempts').select('*').eq('id', attemptId).maybeSingle();
      if (!att) return null;
      const [exam, student, { data: resRow }, questions, { data: ansRows }, { data: evalRows }, { data: logRows }] =
        await Promise.all([
          this.findExamById(String(att.exam_id)),
          this.findUserById(String(att.student_id)),
          sb.from('results').select('*').eq('attempt_id', attemptId).maybeSingle(),
          this.listExamQuestions(String(att.exam_id), true),
          sb.from('student_answers').select('*').eq('attempt_id', attemptId),
          sb.from('evaluations').select('*').eq('attempt_id', attemptId),
          sb.from('activity_logs').select('id, event_type, details, created_at').eq('attempt_id', attemptId).order('created_at', { ascending: true }),
        ]);

      if (!exam || !student) return null;
      const ansMap = new Map((ansRows || []).map((a) => [String(a.question_id), a]));
      const evalMap = new Map((evalRows || []).map((e) => [String(e.question_id), e]));

      const detail: ExamResultDetail = {
        attemptId,
        examId: exam.id,
        examTitle: exam.title,
        subject: exam.subject,
        studentId: student.id,
        studentName: student.name,
        studentEmail: student.email,
        startedAt: String(att.started_at),
        submittedAt: att.submitted_at ? String(att.submitted_at) : null,
        status: (resRow?.status as 'pending_evaluation' | 'evaluated') || 'pending_evaluation',
        objectiveScore: Number(resRow?.objective_score || 0),
        descriptiveScore: Number(resRow?.descriptive_score || 0),
        totalScore: Number(resRow?.total_score || 0),
        totalMarks: Number(resRow?.total_marks || exam.total_marks),
        passingMarks: exam.passing_marks,
        percentage: Number(resRow?.percentage || 0),
        passed: Boolean(resRow?.passed),
        tabSwitchCount: Number(att.tab_switch_count || 0),
        focusLossCount: Number(att.focus_loss_count || 0),
        questions: questions.map((q) => {
          const ans = ansMap.get(q.id);
          const ev = evalMap.get(q.id);
          return {
            questionId: q.id,
            questionType: q.question_type,
            difficulty: q.difficulty,
            prompt: q.prompt,
            options: q.options || [],
            marks: q.marks,
            studentAnswer: ans ? String(ans.selected_option || ans.answer_text || '') : '',
            correctAnswer: q.correct_answer,
            explanation: q.explanation,
            suggestedAnswer: q.suggested_answer,
            markingGuidance: q.marking_guidance,
            isCorrect: ans && ans.is_correct !== null ? Boolean(ans.is_correct) : null,
            marksAwarded:
              ev !== undefined
                ? Number(ev.marks_awarded)
                : ans && ans.marks_awarded !== null
                  ? Number(ans.marks_awarded)
                  : null,
            teacherFeedback: ev ? String(ev.feedback) : null,
          };
        }),
        activityLogs: (logRows || []).map((l) => ({
          id: String(l.id),
          eventType: String(l.event_type),
          details: String(l.details),
          createdAt: String(l.created_at),
        })),
      };

      return { detail, teacherId: exam.teacher_id, status: String(att.status) };
    }

    const db = this.getSql();
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
      .get(attemptId);
    if (!row) return null;

    const questions = await this.listExamQuestions(String(row.exam_id), true);
    const getAns = db.prepare('SELECT * FROM student_answers WHERE attempt_id = ? AND question_id = ?');
    const getEval = db.prepare('SELECT * FROM evaluations WHERE attempt_id = ? AND question_id = ?');

    const questionDetails = questions.map((q) => {
      const ans = getAns.get(attemptId, q.id);
      const evalRow = getEval.get(attemptId, q.id);
      return {
        questionId: q.id,
        questionType: q.question_type,
        difficulty: q.difficulty,
        prompt: q.prompt,
        options: q.options || [],
        marks: q.marks,
        studentAnswer: ans ? String(ans.selected_option || ans.answer_text || '') : '',
        correctAnswer: q.correct_answer,
        explanation: q.explanation,
        suggestedAnswer: q.suggested_answer,
        markingGuidance: q.marking_guidance,
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
      .all(attemptId);

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

    return { detail, teacherId: String(row.teacher_id), status: String(row.status) };
  }

  async listTeacherSubmissions(teacherId: string): Promise<Array<Record<string, unknown>>> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: exams } = await sb.from('exams').select('id, title, subject, passing_marks').eq('teacher_id', teacherId);
      if (!exams || exams.length === 0) return [];
      const examIds = exams.map((e) => String(e.id));
      const examMap = new Map(exams.map((e) => [String(e.id), e]));

      const { data: attempts } = await sb
        .from('exam_attempts')
        .select('*')
        .in('exam_id', examIds)
        .in('status', ['submitted', 'evaluated'])
        .order('submitted_at', { ascending: false });
      if (!attempts || attempts.length === 0) return [];

      const attemptIds = attempts.map((a) => String(a.id));
      const studentIds = Array.from(new Set(attempts.map((a) => String(a.student_id))));

      const [{ data: users }, { data: results }] = await Promise.all([
        sb.from('users').select('id, name, email').in('id', studentIds),
        sb.from('results').select('*').in('attempt_id', attemptIds),
      ]);
      const userMap = new Map((users || []).map((u) => [String(u.id), u]));
      const resMap = new Map((results || []).map((r) => [String(r.attempt_id), r]));

      return attempts.map((ea) => {
        const ex = examMap.get(String(ea.exam_id));
        const st = userMap.get(String(ea.student_id));
        const res = resMap.get(String(ea.id));
        return {
          attempt_id: ea.id,
          exam_id: ea.exam_id,
          student_id: ea.student_id,
          attempt_status: ea.status,
          submitted_at: ea.submitted_at,
          tab_switch_count: ea.tab_switch_count,
          focus_loss_count: ea.focus_loss_count,
          exam_title: ex?.title || '',
          subject: ex?.subject || '',
          passing_marks: ex?.passing_marks || 0,
          student_name: st?.name || 'Student',
          student_email: st?.email || '',
          objective_score: res?.objective_score || 0,
          descriptive_score: res?.descriptive_score || 0,
          total_score: res?.total_score || 0,
          total_marks: res?.total_marks || 0,
          percentage: res?.percentage || 0,
          passed: res?.passed || 0,
          result_status: res?.status || 'pending_evaluation',
        };
      });
    }

    return this.getSql()
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
      .all(teacherId);
  }

  async saveTeacherEvaluations(input: {
    attemptId: string;
    teacherId: string;
    evaluations: Array<{ questionId: string; marksAwarded: number; feedback: string }>;
  }): Promise<{ totalScore: number; percentage: number; passed: boolean } | { error: string; status: number }> {
    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const { data: att } = await sb.from('exam_attempts').select('*').eq('id', input.attemptId).maybeSingle();
      if (!att) return { error: 'Submission not found or unauthorized.', status: 404 };
      const exam = await this.findExamById(String(att.exam_id));
      if (!exam || exam.teacher_id !== input.teacherId) {
        return { error: 'Submission not found or unauthorized.', status: 404 };
      }
      if (att.status === 'in_progress') {
        return { error: 'Cannot evaluate an attempt that has not been submitted yet.', status: 400 };
      }

      const now = new Date().toISOString();
      const examQuestions = await this.listExamQuestions(exam.id, false);
      const qMap = new Map(examQuestions.map((q) => [q.id, q]));

      for (const ev of input.evaluations) {
        const q = qMap.get(ev.questionId);
        if (!q) continue;
        const clampedMarks = Math.min(Math.max(0, Number(ev.marksAwarded) || 0), q.marks);
        await sb.from('evaluations').upsert(
          {
            id: `eval_${crypto.randomUUID()}`,
            attempt_id: input.attemptId,
            question_id: q.id,
            teacher_id: input.teacherId,
            marks_awarded: clampedMarks,
            feedback: String(ev.feedback || '').trim(),
            evaluated_at: now,
          },
          { onConflict: 'attempt_id,question_id' }
        );
        await sb
          .from('student_answers')
          .update({ marks_awarded: clampedMarks })
          .eq('attempt_id', input.attemptId)
          .eq('question_id', q.id);
      }

      const [{ data: ansRows }, { data: evalRows }] = await Promise.all([
        sb.from('student_answers').select('question_id, marks_awarded').eq('attempt_id', input.attemptId),
        sb.from('evaluations').select('question_id, marks_awarded').eq('attempt_id', input.attemptId),
      ]);

      let objectiveScore = 0;
      for (const a of ansRows || []) {
        const q = qMap.get(String(a.question_id));
        if (q && (q.question_type === 'mcq' || q.question_type === 'true_false')) {
          objectiveScore += Number(a.marks_awarded || 0);
        }
      }
      let descriptiveScore = 0;
      for (const ev of evalRows || []) {
        const q = qMap.get(String(ev.question_id));
        if (q && (q.question_type === 'short_answer' || q.question_type === 'long_answer')) {
          descriptiveScore += Number(ev.marks_awarded || 0);
        }
      }

      const computed = computeFinalResult(objectiveScore, descriptiveScore, exam.total_marks, exam.passing_marks);
      await sb.from('exam_attempts').update({ status: 'evaluated' }).eq('id', input.attemptId);
      await sb
        .from('results')
        .update({
          objective_score: objectiveScore,
          descriptive_score: descriptiveScore,
          total_score: computed.totalScore,
          percentage: computed.percentage,
          passed: computed.passed ? 1 : 0,
          status: 'evaluated',
          published_at: now,
        })
        .eq('attempt_id', input.attemptId);

      return computed;
    }

    const db = this.getSql();
    const row = db
      .prepare(
        `SELECT ea.id, ea.exam_id, ea.status, e.teacher_id, e.total_marks, e.passing_marks
         FROM exam_attempts ea
         JOIN exams e ON e.id = ea.exam_id
         WHERE ea.id = ?`
      )
      .get(input.attemptId) as
      | { id: string; exam_id: string; status: string; teacher_id: string; total_marks: number; passing_marks: number }
      | undefined;

    if (!row || row.teacher_id !== input.teacherId) {
      return { error: 'Submission not found or unauthorized.', status: 404 };
    }
    if (row.status === 'in_progress') {
      return { error: 'Cannot evaluate an attempt that has not been submitted yet.', status: 400 };
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

    for (const ev of input.evaluations) {
      const q = db
        .prepare('SELECT id, marks FROM questions WHERE id = ? AND exam_id = ?')
        .get(ev.questionId, row.exam_id) as { id: string; marks: number } | undefined;
      if (!q) continue;
      const clampedMarks = Math.min(Math.max(0, Number(ev.marksAwarded) || 0), q.marks);
      upsertEval.run(`eval_${crypto.randomUUID()}`, input.attemptId, q.id, input.teacherId, clampedMarks, String(ev.feedback || '').trim(), now);
      updateAnsMarks.run(clampedMarks, input.attemptId, q.id);
    }

    const objectiveRow = db
      .prepare(
        `SELECT COALESCE(SUM(sa.marks_awarded), 0) as score
         FROM student_answers sa
         JOIN questions q ON q.id = sa.question_id
         WHERE sa.attempt_id = ? AND q.question_type IN ('mcq', 'true_false')`
      )
      .get(input.attemptId) as { score: number };

    const descriptiveRow = db
      .prepare(
        `SELECT COALESCE(SUM(ev.marks_awarded), 0) as score
         FROM evaluations ev
         JOIN questions q ON q.id = ev.question_id
         WHERE ev.attempt_id = ? AND q.question_type IN ('short_answer', 'long_answer')`
      )
      .get(input.attemptId) as { score: number };

    const computed = computeFinalResult(
      Number(objectiveRow.score),
      Number(descriptiveRow.score),
      row.total_marks,
      row.passing_marks
    );

    db.prepare("UPDATE exam_attempts SET status = 'evaluated' WHERE id = ?").run(input.attemptId);
    db.prepare(
      `UPDATE results
       SET objective_score = ?, descriptive_score = ?, total_score = ?, percentage = ?, passed = ?, status = 'evaluated', published_at = ?
       WHERE attempt_id = ?`
    ).run(Number(objectiveRow.score), Number(descriptiveRow.score), computed.totalScore, computed.percentage, computed.passed ? 1 : 0, now, input.attemptId);

    return computed;
  }

  // =========================================================================
  // USAGE & REQUEST AUDIT LOGS
  // =========================================================================
  async createRequestLog(log: RequestLogRecord): Promise<void> {
    try {
      if (this.provider === 'supabase') {
        await this.getSupa().from('request_logs').insert({
          id: log.id,
          user_id: log.userId,
          user_name: log.userName,
          user_email: log.userEmail,
          user_role: log.userRole,
          method: log.method,
          endpoint: log.endpoint,
          action: log.action,
          status_code: log.statusCode,
          details: log.details,
          ip_address: log.ipAddress,
          created_at: log.createdAt,
        });
        return;
      }
      this.getSql()
        .prepare(
          `INSERT INTO request_logs (id, user_id, user_name, user_email, user_role, method, endpoint, action, status_code, details, ip_address, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          log.id,
          log.userId,
          log.userName,
          log.userEmail,
          log.userRole,
          log.method,
          log.endpoint,
          log.action,
          log.statusCode,
          log.details,
          log.ipAddress,
          log.createdAt
        );
    } catch {
      // Non-blocking audit logging
    }
  }

  async getUsageOverview(): Promise<UsageOverviewData> {
    const users = await this.listAllUsers();
    let logs: RequestLogRecord[] = [];
    let totalDocuments = 0;
    let totalRequests = 0;
    let totalAiGenerations = 0;

    if (this.provider === 'supabase') {
      const sb = this.getSupa();
      const [{ data: logRows, count: logCount }, { count: docCount }, { count: aiCount }] = await Promise.all([
        sb.from('request_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).limit(150),
        sb.from('documents').select('id', { count: 'exact', head: true }),
        sb.from('request_logs').select('id', { count: 'exact', head: true }).eq('endpoint', '/api/ai/generate-questions'),
      ]);

      totalDocuments = docCount || 0;
      totalRequests = logCount || 0;
      totalAiGenerations = aiCount || 0;
      logs = (logRows || []).map((l) => ({
        id: String(l.id),
        userId: l.user_id ? String(l.user_id) : null,
        userName: String(l.user_name || 'Guest'),
        userEmail: String(l.user_email || ''),
        userRole: String(l.user_role || 'anonymous'),
        method: String(l.method),
        endpoint: String(l.endpoint),
        action: String(l.action),
        statusCode: Number(l.status_code),
        details: String(l.details || ''),
        ipAddress: String(l.ip_address || ''),
        createdAt: String(l.created_at),
      }));
    } else {
      const db = this.getSql();
      const docCountRow = db.prepare('SELECT COUNT(*) as c FROM documents').get() as { c: number };
      const logCountRow = db.prepare('SELECT COUNT(*) as c FROM request_logs').get() as { c: number };
      const aiCountRow = db
        .prepare("SELECT COUNT(*) as c FROM request_logs WHERE endpoint = '/api/ai/generate-questions'")
        .get() as { c: number };
      totalDocuments = Number(docCountRow.c);
      totalRequests = Number(logCountRow.c);
      totalAiGenerations = Number(aiCountRow.c);

      const logRows = db.prepare('SELECT * FROM request_logs ORDER BY created_at DESC LIMIT 150').all();
      logs = logRows.map((l) => ({
        id: String(l.id),
        userId: l.user_id ? String(l.user_id) : null,
        userName: String(l.user_name || 'Guest'),
        userEmail: String(l.user_email || ''),
        userRole: String(l.user_role || 'anonymous'),
        method: String(l.method),
        endpoint: String(l.endpoint),
        action: String(l.action),
        statusCode: Number(l.status_code),
        details: String(l.details || ''),
        ipAddress: String(l.ip_address || ''),
        createdAt: String(l.created_at),
      }));
    }

    const uniqueActiveUsers = new Set(logs.map((l) => l.userId).filter(Boolean)).size;
    return {
      dbProvider: this.provider,
      summary: {
        totalRequests,
        uniqueActiveUsers,
        totalUsers: users.length,
        totalStudents: users.filter((u) => u.role === 'student').length,
        totalTeachers: users.filter((u) => u.role === 'teacher').length,
        totalDocuments,
        totalAiGenerations,
      },
      users,
      logs,
    };
  }
}

export const store = new ExamDataStore();
