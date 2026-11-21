import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

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

const dbPath = resolveWritableDbPath();
export const dbDir = path.dirname(dbPath);

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

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

export function initializeDatabase(): void {
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
  `);

  // Safe migration for existing SQLite files
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

  seedDemoData();
}

function seedDemoData(): void {
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (existingUsers.count > 0) {
    return;
  }

  const now = new Date().toISOString();
  const futureDeadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const teacherId = 'usr_teacher_demo';
  const studentId = 'usr_student_demo';
  const student2Id = 'usr_student_marcus';

  const insertUser = db.prepare(
    'INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertUser.run(teacherId, 'Dr. Elena Vance', 'teacher@exampilot.edu', hashPassword('Teacher123!'), 'teacher', now);
  insertUser.run(studentId, 'Maya Lin', 'student@exampilot.edu', hashPassword('Student123!'), 'student', now);
  insertUser.run(student2Id, 'Marcus Alvarez', 'marcus@exampilot.edu', hashPassword('Student123!'), 'student', now);

  // Seed study & teaching documents
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

  const insertDoc = db.prepare(
    `INSERT INTO documents (id, user_id, owner_role, title, original_filename, file_type, file_size, extracted_text, word_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertDoc.run(
    'doc_student_bio',
    studentId,
    'student',
    'Cellular Respiration & ATP Synthesis Notes',
    'Cellular_Respiration_Notes.docx',
    'docx',
    24580,
    studentDocText,
    studentDocText.split(/\s+/).length,
    now
  );
  insertDoc.run(
    'doc_teacher_db',
    teacherId,
    'teacher',
    'Relational Database Normalization & SQL Lecture',
    'Database_Normalization_Lecture.pdf',
    'pdf',
    184320,
    teacherDocText,
    teacherDocText.split(/\s+/).length,
    now
  );

  // Seed student practice quiz
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

  db.prepare(
    `INSERT INTO practice_quizzes (id, student_id, document_id, title, topic, difficulty, question_type, questions_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'pq_bio_1',
    studentId,
    'doc_student_bio',
    'Cellular Respiration Practice Set',
    'Cellular Respiration & ATP',
    'Medium',
    'mixed',
    JSON.stringify(practiceQuestions),
    now
  );

  db.prepare(
    `INSERT INTO practice_attempts (id, quiz_id, student_id, answers_json, score, total_marks, percentage, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'pa_bio_1',
    'pq_bio_1',
    studentId,
    JSON.stringify({
      pq_1: 'Cytoplasm',
      pq_2: 'Oxygen',
      pq_3: '2 ATP',
      pq_4: 'True',
      pq_5: 'Citrate',
    }),
    7,
    9,
    77.8,
    now
  );

  // Seed Question Bank for teacher
  const bankItems = [
    {
      id: 'qb_1',
      type: 'mcq',
      difficulty: 'Easy',
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
      marks: 2,
    },
    {
      id: 'qb_2',
      type: 'mcq',
      difficulty: 'Medium',
      topic: 'Normal Forms',
      prompt: 'A table with a composite primary key (StudentID, CourseID) stores CourseTitle, which depends only on CourseID. Which normal form does this violate?',
      options: ['Second Normal Form (2NF)', 'First Normal Form (1NF)', 'Fourth Normal Form (4NF)', 'Referential Integrity'],
      correct: 'Second Normal Form (2NF)',
      explanation: 'CourseTitle partially depends on CourseID alone, violating 2NF.',
      marks: 2,
    },
    {
      id: 'qb_3',
      type: 'mcq',
      difficulty: 'Medium',
      topic: 'SQL Constraints',
      prompt: 'Which SQL clause ensures a child row cannot reference a non-existent parent primary key?',
      options: ['FOREIGN KEY constraint', 'GROUP BY clause', 'CHECK DISTINCT', 'ORDER BY constraint'],
      correct: 'FOREIGN KEY constraint',
      explanation: 'Foreign keys enforce referential integrity between related tables.',
      marks: 2,
    },
    {
      id: 'qb_4',
      type: 'true_false',
      difficulty: 'Easy',
      topic: 'Normal Forms',
      prompt: 'A table in Third Normal Form (3NF) cannot contain transitive dependencies among non-key attributes.',
      options: ['True', 'False'],
      correct: 'True',
      explanation: '3NF explicitly removes transitive dependencies where a non-key attribute depends on another non-key attribute.',
      marks: 1,
    },
    {
      id: 'qb_5',
      type: 'short_answer',
      difficulty: 'Medium',
      topic: 'Anomalies',
      prompt: 'Briefly explain how unnormalized tables lead to update anomalies, using a short example.',
      suggested: 'When the same fact (such as an instructor office number) is duplicated across multiple enrollment rows, updating it in one row but not others creates inconsistent data.',
      guidance: 'Award 2 marks for defining data inconsistency across duplicate rows and 3 marks for a concrete example.',
      marks: 5,
    },
    {
      id: 'qb_6',
      type: 'long_answer',
      difficulty: 'Hard',
      topic: 'Schema Design',
      prompt: 'Contrast 3NF and Boyce-Codd Normal Form (BCNF). Describe a scenario where a relation satisfies 3NF but fails BCNF, and explain how to decompose it.',
      suggested: 'In 3NF, a dependency X -> Y is permitted if Y is a prime attribute. BCNF requires X to be a superkey for every non-trivial dependency. When multiple overlapping candidate keys exist, decompose along the violating determinant X -> Y into (X, Y) and (R - Y).',
      guidance: 'Award 4 marks for accurate 3NF vs BCNF rules, 3 marks for an overlapping candidate key example, and 3 marks for lossless decomposition steps.',
      marks: 10,
    },
  ];

  const insertBank = db.prepare(
    `INSERT INTO question_bank (id, teacher_id, document_id, question_type, difficulty, topic, prompt, correct_answer, explanation, suggested_answer, marking_guidance, marks, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertOption = db.prepare(
    `INSERT INTO question_options (id, question_id, bank_question_id, option_text, option_order, is_correct)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const b of bankItems) {
    insertBank.run(
      b.id,
      teacherId,
      'doc_teacher_db',
      b.type,
      b.difficulty,
      b.topic,
      b.prompt,
      b.correct || '',
      b.explanation || '',
      b.suggested || '',
      b.guidance || '',
      b.marks,
      now
    );
    if (b.options) {
      b.options.forEach((opt, idx) => {
        insertOption.run(
          `opt_${b.id}_${idx}`,
          null,
          b.id,
          opt,
          idx,
          opt === b.correct ? 1 : 0
        );
      });
    }
  }

  // Official Exam 1: Open & available for Maya to take right away
  const insertExam = db.prepare(
    `INSERT INTO exams (id, teacher_id, title, subject, instructions, duration_minutes, total_marks, passing_marks, deadline_at, status, randomize_questions, randomize_options, track_tab_switches, warn_on_tab_leave, assign_all, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertExam.run(
    'exam_db_midterm',
    teacherId,
    'Midterm: Relational Databases & SQL',
    'CS 301 · Database Systems',
    'Read each question carefully before answering. Your progress is automatically saved on every selection. Leaving the exam tab is logged for academic integrity review.',
    30,
    22,
    13,
    futureDeadline,
    'published',
    1,
    1,
    1,
    1,
    1,
    now
  );

  const insertExamQuestion = db.prepare(
    `INSERT INTO questions (id, exam_id, bank_question_id, question_type, difficulty, prompt, correct_answer, explanation, suggested_answer, marking_guidance, marks, question_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  bankItems.forEach((b, idx) => {
    const qId = `eq_mid_${idx + 1}`;
    insertExamQuestion.run(
      qId,
      'exam_db_midterm',
      b.id,
      b.type,
      b.difficulty,
      b.prompt,
      b.correct || '',
      b.explanation || '',
      b.suggested || '',
      b.guidance || '',
      b.marks,
      idx + 1
    );
    if (b.options) {
      b.options.forEach((opt, oIdx) => {
        insertOption.run(`opt_${qId}_${oIdx}`, qId, null, opt, oIdx, opt === b.correct ? 1 : 0);
      });
    }
  });

  // Official Exam 2: Earlier quiz with 1 evaluated attempt (Maya) and 1 pending evaluation attempt (Marcus)
  insertExam.run(
    'exam_norm_quiz1',
    teacherId,
    'Quiz 1: Functional Dependencies & 3NF',
    'CS 301 · Database Systems',
    'Complete both the multiple-choice items and the short explanation on update anomalies.',
    20,
    9,
    5,
    futureDeadline,
    'published',
    0,
    0,
    1,
    1,
    1,
    now
  );

  const quiz1Questions = [bankItems[0], bankItems[1], bankItems[4]];
  quiz1Questions.forEach((b, idx) => {
    const qId = `eq_q1_${idx + 1}`;
    insertExamQuestion.run(
      qId,
      'exam_norm_quiz1',
      b.id,
      b.type,
      b.difficulty,
      b.prompt,
      b.correct || '',
      b.explanation || '',
      b.suggested || '',
      b.guidance || '',
      b.marks,
      idx + 1
    );
    if (b.options) {
      b.options.forEach((opt, oIdx) => {
        insertOption.run(`opt_${qId}_${oIdx}`, qId, null, opt, oIdx, opt === b.correct ? 1 : 0);
      });
    }
  });

  const earlierStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const earlierSubmit = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 14 * 60 * 1000).toISOString();

  // Maya's evaluated attempt
  db.prepare(
    `INSERT INTO exam_attempts (id, exam_id, student_id, status, started_at, submitted_at, question_seed, tab_switch_count, focus_loss_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('att_maya_q1', 'exam_norm_quiz1', studentId, 'evaluated', earlierStart, earlierSubmit, 'seed_maya_q1', 0, 0, earlierStart);

  const insertAnswer = db.prepare(
    `INSERT INTO student_answers (id, attempt_id, question_id, answer_text, selected_option, is_correct, marks_awarded, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertAnswer.run('ans_maya_1', 'att_maya_q1', 'eq_q1_1', 'Atomic column values with no repeating groups', 'Atomic column values with no repeating groups', 1, 2, earlierSubmit);
  insertAnswer.run('ans_maya_2', 'att_maya_q1', 'eq_q1_2', 'Second Normal Form (2NF)', 'Second Normal Form (2NF)', 1, 2, earlierSubmit);
  insertAnswer.run(
    'ans_maya_3',
    'att_maya_q1',
    'eq_q1_3',
    'When duplicate instructor details exist across enrollment records, updating an office number in only one row leaves conflicting records.',
    '',
    null,
    4.5,
    earlierSubmit
  );

  db.prepare(
    `INSERT INTO evaluations (id, attempt_id, question_id, teacher_id, marks_awarded, feedback, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'eval_maya_3',
    'att_maya_q1',
    'eq_q1_3',
    teacherId,
    4.5,
    'Clear definition and relevant example. Mentioning how splitting into separate Instructor and Enrollment tables resolves the anomaly would earn full marks.',
    earlierSubmit
  );

  db.prepare(
    `INSERT INTO results (id, attempt_id, exam_id, student_id, objective_score, descriptive_score, total_score, total_marks, percentage, passed, status, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('res_maya_q1', 'att_maya_q1', 'exam_norm_quiz1', studentId, 4, 4.5, 8.5, 9, 94.4, 1, 'evaluated', earlierSubmit);

  // Marcus's submitted attempt waiting for teacher evaluation
  db.prepare(
    `INSERT INTO exam_attempts (id, exam_id, student_id, status, started_at, submitted_at, question_seed, tab_switch_count, focus_loss_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('att_marcus_q1', 'exam_norm_quiz1', student2Id, 'submitted', earlierStart, earlierSubmit, 'seed_marcus_q1', 1, 1, earlierStart);

  insertAnswer.run('ans_marcus_1', 'att_marcus_q1', 'eq_q1_1', 'Atomic column values with no repeating groups', 'Atomic column values with no repeating groups', 1, 2, earlierSubmit);
  insertAnswer.run('ans_marcus_2', 'att_marcus_q1', 'eq_q1_2', 'First Normal Form (1NF)', 'First Normal Form (1NF)', 0, 0, earlierSubmit);
  insertAnswer.run(
    'ans_marcus_3',
    'att_marcus_q1',
    'eq_q1_3',
    'Unnormalized tables store repeated department data across rows, so changing one row without updating all others makes the table inconsistent.',
    '',
    null,
    null,
    earlierSubmit
  );

  db.prepare(
    `INSERT INTO results (id, attempt_id, exam_id, student_id, objective_score, descriptive_score, total_score, total_marks, percentage, passed, status, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('res_marcus_q1', 'att_marcus_q1', 'exam_norm_quiz1', student2Id, 2, 0, 2, 9, 22.2, 0, 'pending_evaluation', earlierSubmit);

  const insertActivity = db.prepare(
    `INSERT INTO activity_logs (id, attempt_id, exam_id, student_id, event_type, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertActivity.run('log_1', 'att_maya_q1', 'exam_norm_quiz1', studentId, 'exam_started', 'Exam session initialized', earlierStart);
  insertActivity.run('log_2', 'att_maya_q1', 'exam_norm_quiz1', studentId, 'exam_submitted', 'Submitted within time window', earlierSubmit);
  insertActivity.run('log_3', 'att_marcus_q1', 'exam_norm_quiz1', student2Id, 'exam_started', 'Exam session initialized', earlierStart);
  insertActivity.run('log_4', 'att_marcus_q1', 'exam_norm_quiz1', student2Id, 'tab_hidden', 'Browser tab became hidden during attempt', earlierStart);
  insertActivity.run('log_5', 'att_marcus_q1', 'exam_norm_quiz1', student2Id, 'exam_submitted', 'Submitted within time window', earlierSubmit);
}
