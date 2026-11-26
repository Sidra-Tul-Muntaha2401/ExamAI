import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSmartContextExcerpt,
  computeAssignmentLifecycleStatus,
  computeAttemptAnalytics,
  computeFinalResult,
  computeStudentProgressOverview,
  computeTeacherClassAnalytics,
  formatDurationSeconds,
  generateEnrollmentCode,
  getRemainingSeconds,
  gradeObjectiveQuestions,
  isAttemptWithinSubmissionWindow,
  normalizeEnrollmentCode,
  parseAndValidateGroqQuestions,
  sanitizePracticeQuestionForStudent,
  sanitizePracticeQuizForStudent,
  seededShuffle,
  shouldAutoSubmitForViolations,
  validateExtractedText,
  validateUploadMeta,
} from './examRules';

test('validateUploadMeta accepts valid PDF and DOCX under 10MB and rejects invalid files', () => {
  assert.deepEqual(validateUploadMeta('notes.pdf', 'application/pdf', 1024), {
    valid: true,
    fileType: 'pdf',
  });
  assert.deepEqual(
    validateUploadMeta(
      'lecture.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      2048
    ),
    { valid: true, fileType: 'docx' }
  );
  assert.equal(validateUploadMeta('photo.png', 'image/png', 1024).valid, false);
  assert.equal(validateUploadMeta('empty.pdf', 'application/pdf', 0).valid, false);
  assert.equal(validateUploadMeta('huge.pdf', 'application/pdf', 11 * 1024 * 1024).valid, false);
});

test('validateExtractedText flags scanned/empty PDFs honestly', () => {
  const scanned = validateExtractedText('   \n  ', 'pdf');
  assert.equal(scanned.valid, false);
  assert.match(scanned.error || '', /scanned|OCR/i);

  const valid = validateExtractedText(
    'Cellular respiration converts glucose and oxygen into ATP, carbon dioxide, and water across glycolysis and the citric acid cycle.',
    'pdf'
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.wordCount > 10, true);
});

test('buildSmartContextExcerpt samples substantive sections across long documents', () => {
  const intro = 'Table of Contents ........ 1\nChapter 1 ........ 3';
  const sec1 = 'Section One: ' + 'Mitochondrial electron transport generates proton motive force. '.repeat(35);
  const sec2 = 'Section Two: ' + 'Glycolysis converts six carbon glucose into two pyruvate molecules. '.repeat(35);
  const sec3 = 'Section Three: ' + 'Citric acid cycle yields NADH and FADH2 in the matrix. '.repeat(35);
  const full = [intro, sec1, sec2, sec3].join('\n\n');
  const excerpt = buildSmartContextExcerpt(full, 4000);
  assert.equal(excerpt.length <= 4000, true);
  assert.equal(excerpt.includes('Section One') || excerpt.includes('Section Three'), true);
});

test('seededShuffle is deterministic for the same seed and preserves all elements', () => {
  const input = ['A', 'B', 'C', 'D', 'E'];
  const first = seededShuffle(input, 'attempt-123');
  const second = seededShuffle(input, 'attempt-123');
  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort(), [...input].sort());
  assert.deepEqual(input, ['A', 'B', 'C', 'D', 'E']);
});

test('parseAndValidateGroqQuestions validates MCQ and descriptive JSON structures including LLM variants', () => {
  const raw = JSON.stringify({
    questions: [
      {
        questionType: 'mcq',
        difficulty: 'Medium',
        prompt: 'Which normal form eliminates partial functional dependencies?',
        options: ['1NF', '2NF', '3NF', 'BCNF'],
        correctAnswer: '2NF',
        explanation: 'Second Normal Form requires full functional dependency on the entire primary key.',
      },
      {
        type: 'mcq',
        difficulty: 'Easy',
        question: 'Which normal form removes repeating groups?',
        options: { A: 'A. First Normal Form', B: 'B. Second Normal Form', C: 'C. Third Normal Form', D: 'D. BCNF' },
        answer: 'A',
      },
      {
        questionType: 'true_false',
        prompt: 'Foreign keys enforce referential integrity.',
        correct_answer: true,
      },
      {
        questionType: 'short_answer',
        difficulty: 'Hard',
        prompt: 'Explain why transitive dependencies cause update anomalies.',
        suggestedAnswer: 'Non-key attributes depending on another non-key attribute duplicate facts across rows.',
        markingGuidance: 'Award 2 marks for dependency definition and 3 marks for anomaly example.',
      },
    ],
  });

  const parsed = parseAndValidateGroqQuestions(raw, 'mixed', 'Medium', 'Normalization');
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].questionType, 'mcq');
  assert.equal(parsed[0].correctAnswer, '2NF');
  assert.equal(parsed[1].correctAnswer, 'First Normal Form');
  assert.equal(parsed[2].correctAnswer, 'True');
  assert.equal(parsed[3].questionType, 'short_answer');
  assert.equal(parsed[3].marks, 5);

  assert.throws(() => parseAndValidateGroqQuestions('not json', 'mcq', 'Easy'));
  assert.throws(() => parseAndValidateGroqQuestions(JSON.stringify({ questions: [] }), 'mcq', 'Easy'));
});

test('gradeObjectiveQuestions and computeFinalResult calculate scores accurately', () => {
  const summary = gradeObjectiveQuestions(
    [
      { id: 'q1', questionType: 'mcq', correctAnswer: '2NF', marks: 2 },
      { id: 'q2', questionType: 'true_false', correctAnswer: 'True', marks: 1 },
      { id: 'q3', questionType: 'short_answer', correctAnswer: '', marks: 5 },
    ],
    { q1: '2NF', q2: 'False', q3: 'My essay answer' }
  );

  assert.equal(summary.objectiveScore, 2);
  assert.equal(summary.objectiveTotalMarks, 3);
  assert.equal(summary.totalPossibleMarks, 8);
  assert.equal(summary.hasDescriptiveQuestions, true);
  assert.equal(summary.perQuestion.q1.isCorrect, true);
  assert.equal(summary.perQuestion.q2.isCorrect, false);
  assert.equal(summary.perQuestion.q3.isCorrect, null);

  const finalRes = computeFinalResult(2, 4, 8, 5);
  assert.equal(finalRes.totalScore, 6);
  assert.equal(finalRes.percentage, 75);
  assert.equal(finalRes.passed, true);
});

test('getRemainingSeconds and isAttemptWithinSubmissionWindow enforce server-side timing', () => {
  const start = '2026-11-21T10:00:00.000Z';
  const tenMinutesLater = Date.parse('2026-11-21T10:10:00.000Z');
  assert.equal(getRemainingSeconds(start, 30, null, tenMinutesLater), 20 * 60);

  const thirtyOneMinutesLater = Date.parse('2026-11-21T10:31:00.000Z');
  assert.equal(getRemainingSeconds(start, 30, null, thirtyOneMinutesLater), 0);
  assert.equal(isAttemptWithinSubmissionWindow(start, 30, null, thirtyOneMinutesLater, 20), false);
});

test('shouldAutoSubmitForViolations enforces configurable tab switch threshold', () => {
  assert.equal(shouldAutoSubmitForViolations(2, 3), false);
  assert.equal(shouldAutoSubmitForViolations(3, 3), true);
  assert.equal(shouldAutoSubmitForViolations(5, 3), true);
  assert.equal(shouldAutoSubmitForViolations(10, 0), false);
});

test('parseAndValidateGroqQuestions deduplicates near-identical question prompts', () => {
  const raw = JSON.stringify({
    questions: [
      {
        questionType: 'true_false',
        prompt: 'Indexing speeds up read queries in SQL.',
        correctAnswer: 'True',
      },
      {
        questionType: 'true_false',
        prompt: 'Indexing speeds up read queries in SQL!',
        correctAnswer: 'True',
      },
      {
        questionType: 'true_false',
        prompt: 'Indexes require extra storage and slow down writes.',
        correctAnswer: 'True',
      },
    ],
  });
  const parsed = parseAndValidateGroqQuestions(raw, 'true_false', 'Easy', 'Indexing');
  assert.equal(parsed.length, 2);
});

test('computeAttemptAnalytics calculates real durations, counts, and difficulty/type breakdown', () => {
  const analytics = computeAttemptAnalytics({
    startedAt: '2026-11-22T10:00:00.000Z',
    submittedAt: '2026-11-22T10:12:35.000Z',
    questions: [
      {
        questionId: 'q1',
        questionType: 'mcq',
        difficulty: 'Easy',
        prompt: 'Q1',
        options: ['A', 'B'],
        marks: 2,
        studentAnswer: 'A',
        correctAnswer: 'A',
        explanation: '',
        suggestedAnswer: '',
        markingGuidance: '',
        isCorrect: true,
        marksAwarded: 2,
        teacherFeedback: null,
      },
      {
        questionId: 'q2',
        questionType: 'mcq',
        difficulty: 'Hard',
        prompt: 'Q2',
        options: ['A', 'B'],
        marks: 2,
        studentAnswer: 'B',
        correctAnswer: 'A',
        explanation: '',
        suggestedAnswer: '',
        markingGuidance: '',
        isCorrect: false,
        marksAwarded: 0,
        teacherFeedback: null,
      },
      {
        questionId: 'q3',
        questionType: 'true_false',
        difficulty: 'Hard',
        prompt: 'Q3',
        options: ['True', 'False'],
        marks: 1,
        studentAnswer: '',
        correctAnswer: 'True',
        explanation: '',
        suggestedAnswer: '',
        markingGuidance: '',
        isCorrect: false,
        marksAwarded: 0,
        teacherFeedback: null,
      },
      {
        questionId: 'q4',
        questionType: 'short_answer',
        difficulty: 'Medium',
        prompt: 'Q4',
        options: [],
        marks: 5,
        studentAnswer: 'Written explanation',
        correctAnswer: '',
        explanation: '',
        suggestedAnswer: '',
        markingGuidance: '',
        isCorrect: null,
        marksAwarded: null,
        teacherFeedback: null,
      },
    ],
  });

  assert.equal(analytics.totalQuestions, 4);
  assert.equal(analytics.correctCount, 1);
  assert.equal(analytics.incorrectCount, 1);
  assert.equal(analytics.unansweredCount, 1);
  assert.equal(analytics.pendingCount, 1);
  assert.equal(analytics.timeTakenSeconds, 755);
  assert.equal(analytics.formattedDuration, '12m 35s');
  assert.equal(formatDurationSeconds(3665), '1h 1m 5s');
  assert.equal(analytics.byDifficulty.find((d) => d.key === 'Easy')?.accuracyPercent, 100);
  assert.equal(analytics.byDifficulty.find((d) => d.key === 'Hard')?.accuracyPercent, 0);
  assert.equal(analytics.reviewFocusLabels.length >= 2, true);
});

test('generateEnrollmentCode and computeAssignmentLifecycleStatus handle codes and windows', () => {
  const code = generateEnrollmentCode(new Uint8Array([1, 2, 3, 4, 5, 6]));
  assert.match(code, /^EXAM-[A-Z2-9]{6}$/);
  assert.equal(normalizeEnrollmentCode(' exam-ab23cd '), 'EXAM-AB23CD');

  const now = Date.parse('2026-11-23T12:00:00.000Z');
  assert.equal(computeAssignmentLifecycleStatus({ attemptStatus: 'evaluated', nowMs: now }), 'Completed');
  assert.equal(computeAssignmentLifecycleStatus({ attemptStatus: 'in_progress', nowMs: now }), 'Started');
  assert.equal(
    computeAssignmentLifecycleStatus({ endTime: '2026-11-23T11:00:00.000Z', nowMs: now }),
    'Expired'
  );
  assert.equal(
    computeAssignmentLifecycleStatus({ startTime: '2026-11-23T10:00:00.000Z', endTime: '2026-11-24T10:00:00.000Z', nowMs: now }),
    'Not attempted'
  );
  assert.equal(
    computeAssignmentLifecycleStatus({ startTime: '2026-11-24T10:00:00.000Z', nowMs: now }),
    'Assigned'
  );
});

test('computeStudentProgressOverview handles insufficient data honestly and aggregates real topics', () => {
  const empty = computeStudentProgressOverview({ exams: [], practiceAttempts: [] });
  assert.equal(empty.hasSufficientData, false);
  assert.equal(empty.averageScore, null);
  assert.match(empty.suggestions[0] || '', /Complete at least one/i);

  const summary = computeStudentProgressOverview({
    exams: [
      {
        examId: 'ex1',
        examTitle: 'Midterm SQL',
        subject: 'CS 301',
        attemptId: 'att1',
        attemptStatus: 'evaluated',
        startedAt: '2026-11-20T10:00:00.000Z',
        submittedAt: '2026-11-20T10:25:00.000Z',
        result: {
          totalScore: 7,
          totalMarks: 10,
          percentage: 70,
          passed: true,
          status: 'evaluated',
        },
        questionAnswers: [
          { topic: 'Normal Forms', marks: 5, marksAwarded: 5, isCorrect: true, studentAnswer: '3NF' },
          { topic: 'SQL Joins', marks: 5, marksAwarded: 2, isCorrect: false, studentAnswer: 'Partial' },
        ],
      },
    ],
    practiceAttempts: [
      {
        id: 'pa1',
        quizTitle: 'Bio Practice',
        topic: 'Glycolysis',
        score: 8,
        totalMarks: 10,
        percentage: 80,
        completedAt: '2026-11-21T09:00:00.000Z',
      },
    ],
  });

  assert.equal(summary.hasSufficientData, true);
  assert.equal(summary.averageScore, 70);
  assert.equal(summary.highestScore, 70);
  assert.equal(summary.practiceAverage, 80);
  assert.equal(summary.strongTopics.some((t) => t.topic === 'Normal Forms'), true);
  assert.equal(summary.weakTopics.some((t) => t.topic === 'SQL Joins'), true);
  assert.equal(summary.scoreTrend.length, 2);
});

test('computeTeacherClassAnalytics calculates real class averages, distribution, and support list', () => {
  const analytics = computeTeacherClassAnalytics({
    members: [
      { studentId: 's1', studentName: 'Maya', studentEmail: 'maya@edu' },
      { studentId: 's2', studentName: 'Marcus', studentEmail: 'marcus@edu' },
      { studentId: 's3', studentName: 'Zoe', studentEmail: 'zoe@edu' },
    ],
    submissions: [
      { studentId: 's1', studentName: 'Maya', studentEmail: 'maya@edu', percentage: 92, passed: true, status: 'evaluated' },
      { studentId: 's2', studentName: 'Marcus', studentEmail: 'marcus@edu', percentage: 48, passed: false, status: 'evaluated' },
    ],
  });

  assert.equal(analytics.classAverage, 70);
  assert.equal(analytics.highestScore, 92);
  assert.equal(analytics.lowestScore, 48);
  assert.equal(analytics.completionRate, 66.7);
  assert.equal(analytics.ranking[0].studentName, 'Maya');
  assert.equal(analytics.studentsNeedingSupport.length, 2); // Marcus (48%) + Zoe (0 attempts)
});

test('sanitizePracticeQuizForStudent strips answer keys, explanations, and rubrics while keeping prompts and options', () => {
  const sanitizedQuestion = sanitizePracticeQuestionForStudent({
    id: 'q1',
    questionType: 'mcq',
    difficulty: 'Medium',
    topic: 'SQL',
    prompt: 'Which key uniquely identifies a row?',
    options: ['Primary Key', 'Foreign Key', 'Index', 'Trigger'],
    correctAnswer: 'Primary Key',
    explanation: 'A primary key uniquely identifies each record in a table.',
    marks: 2,
  });

  assert.equal('correctAnswer' in sanitizedQuestion, false);
  assert.equal('explanation' in sanitizedQuestion, false);
  assert.equal('suggestedAnswer' in sanitizedQuestion, false);
  assert.equal('markingGuidance' in sanitizedQuestion, false);
  assert.deepEqual(sanitizedQuestion.options, ['Primary Key', 'Foreign Key', 'Index', 'Trigger']);

  const sanitizedQuiz = sanitizePracticeQuizForStudent({
    id: 'pq_1',
    studentId: 'stu_1',
    documentId: 'doc_1',
    title: 'Database Quiz',
    topic: 'SQL',
    difficulty: 'Medium',
    questionType: 'mixed',
    createdAt: '2026-11-24T12:00:00.000Z',
    questions: [
      sanitizedQuestion,
      {
        id: 'q2',
        questionType: 'short_answer',
        difficulty: 'Hard',
        prompt: 'Explain BCNF.',
        options: [],
        suggestedAnswer: 'Every determinant must be a candidate key.',
        markingGuidance: 'Award 5 marks for candidate key condition.',
        marks: 5,
      },
    ],
  });

  assert.equal(sanitizedQuiz.questions.length, 2);
  assert.equal('suggestedAnswer' in sanitizedQuiz.questions[1], false);
  assert.equal('markingGuidance' in sanitizedQuiz.questions[1], false);
  assert.equal(sanitizedQuiz.questions[1].prompt, 'Explain BCNF.');
});

