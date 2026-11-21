import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFinalResult,
  getRemainingSeconds,
  gradeObjectiveQuestions,
  isAttemptWithinSubmissionWindow,
  parseAndValidateGroqQuestions,
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

test('seededShuffle is deterministic for the same seed and preserves all elements', () => {
  const input = ['A', 'B', 'C', 'D', 'E'];
  const first = seededShuffle(input, 'attempt-123');
  const second = seededShuffle(input, 'attempt-123');
  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort(), [...input].sort());
  assert.deepEqual(input, ['A', 'B', 'C', 'D', 'E']);
});

test('parseAndValidateGroqQuestions validates MCQ and descriptive JSON structures', () => {
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
        questionType: 'short_answer',
        difficulty: 'Hard',
        prompt: 'Explain why transitive dependencies cause update anomalies.',
        suggestedAnswer: 'Non-key attributes depending on another non-key attribute duplicate facts across rows.',
        markingGuidance: 'Award 2 marks for dependency definition and 3 marks for anomaly example.',
      },
    ],
  });

  const parsed = parseAndValidateGroqQuestions(raw, 'mixed', 'Medium', 'Normalization');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].questionType, 'mcq');
  assert.equal(parsed[0].correctAnswer, '2NF');
  assert.equal(parsed[1].questionType, 'short_answer');
  assert.equal(parsed[1].marks, 5);

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
