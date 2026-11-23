import type {
  AssignmentLifecycleStatus,
  Difficulty,
  ExamResultDetail,
  QuestionType,
  QuizQuestion,
  StudentProgressSummary,
} from '../types/index';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_PDF_MIMES = new Set(['application/pdf', 'application/x-pdf']);
const ALLOWED_DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // Some browsers/OS send generic octet-stream for .docx
]);

export interface UploadMetaValidationResult {
  valid: boolean;
  fileType?: 'pdf' | 'docx';
  error?: string;
}

export function validateUploadMeta(
  filename: string,
  mimetype: string,
  sizeBytes: number
): UploadMetaValidationResult {
  const lower = filename.trim().toLowerCase();
  const isPdfExt = lower.endsWith('.pdf');
  const isDocxExt = lower.endsWith('.docx');

  if (!isPdfExt && !isDocxExt) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a .pdf or .docx document.',
    };
  }

  if (sizeBytes <= 0) {
    return {
      valid: false,
      error: 'The uploaded file is empty (0 bytes).',
    };
  }

  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return {
      valid: false,
      error: 'File exceeds the 10 MB upload limit. Please upload a smaller document.',
    };
  }

  if (isPdfExt && mimetype && !ALLOWED_PDF_MIMES.has(mimetype) && mimetype !== 'application/octet-stream') {
    return {
      valid: false,
      error: 'Invalid MIME type for a PDF file.',
    };
  }

  if (isDocxExt && mimetype && !ALLOWED_DOCX_MIMES.has(mimetype)) {
    return {
      valid: false,
      error: 'Invalid MIME type for a DOCX file.',
    };
  }

  return {
    valid: true,
    fileType: isPdfExt ? 'pdf' : 'docx',
  };
}

export interface TextExtractionValidationResult {
  valid: boolean;
  cleanedText: string;
  wordCount: number;
  error?: string;
}

export function validateExtractedText(rawText: string, fileType: 'pdf' | 'docx'): TextExtractionValidationResult {
  const cleanedText = rawText
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const words = cleanedText.split(/\s+/).filter((w) => w.length > 0);
  const meaningfulChars = cleanedText.replace(/\s+/g, '');

  if (meaningfulChars.length < 40 || words.length < 8) {
    if (fileType === 'pdf') {
      return {
        valid: false,
        cleanedText: '',
        wordCount: 0,
        error:
          'No extractable text was found in this PDF. It appears to be empty or a scanned image-only PDF. ExamAI does not perform OCR on scanned PDFs—please upload a text-based PDF or DOCX file.',
      };
    }
    return {
      valid: false,
      cleanedText: '',
      wordCount: 0,
      error: 'The uploaded DOCX document contains insufficient readable text (minimum 8 words required).',
    };
  }

  return {
    valid: true,
    cleanedText,
    wordCount: words.length,
  };
}

/**
 * Deterministic Fisher-Yates shuffle using FNV-1a + Mulberry32 PRNG.
 * Ensures question and option randomization stays stable across page refreshes for the same attempt seed.
 */
export function seededShuffle<T>(items: readonly T[], seedString: string): T[] {
  const copy = [...items];
  let hash = 2166136261;
  for (let i = 0; i < seedString.length; i++) {
    hash ^= seedString.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  const nextRandom = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

export function buildSmartContextExcerpt(sourceText: string, maxChars = 15000): string {
  const normalized = sourceText.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const chunkTargetSize = 2400;
  const paragraphs = normalized.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (para.length > chunkTargetSize) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      for (let i = 0; i < para.length; i += chunkTargetSize) {
        chunks.push(para.slice(i, i + chunkTargetSize).trim());
      }
    } else if (current.length + para.length + 2 > chunkTargetSize) {
      if (current.trim()) chunks.push(current.trim());
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  if (chunks.length <= 1) {
    return normalized.slice(0, maxChars);
  }

  // Prefer substantive content chunks over short title/TOC fragments
  const scoredChunks = chunks.map((text, index) => {
    const words = text.split(/\s+/).filter(Boolean).length;
    const dotLeaders = (text.match(/\.{4,}/g) || []).length;
    const score = words - dotLeaders * 12;
    return { text, index, score };
  });

  const substantive = scoredChunks.filter((c) => c.score >= 40);
  const pool = substantive.length >= 2 ? substantive : scoredChunks;

  const maxChunks = Math.max(1, Math.floor(maxChars / chunkTargetSize));
  const selectedIndices = new Set<number>();

  if (pool.length <= maxChunks) {
    for (const c of pool) selectedIndices.add(c.index);
  } else {
    for (let k = 0; k < maxChunks; k++) {
      const pos = Math.round((k * (pool.length - 1)) / Math.max(1, maxChunks - 1));
      selectedIndices.add(pool[pos].index);
    }
  }

  const ordered = chunks
    .filter((_, idx) => selectedIndices.has(idx))
    .join('\n\n---\n\n');

  return ordered.slice(0, maxChars);
}

export function stripMarkdownCodeFences(raw: string): string {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = withoutThink.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : withoutThink;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }
  return candidate;
}

function stripOptionLabelPrefix(text: string): string {
  return text.replace(/^[A-Ea-e][).:\]]\s+/, '').trim();
}

export function parseAndValidateGroqQuestions(
  rawResponse: string,
  requestedType: QuestionType | 'mixed',
  requestedDifficulty: Difficulty,
  defaultTopic?: string
): QuizQuestion[] {
  const cleaned = stripMarkdownCodeFences(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI response could not be parsed as valid JSON.');
  }

  const rawList = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown[] }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown[] }).items)
        ? (parsed as { items: unknown[] }).items
        : null;

  if (!rawList || rawList.length === 0) {
    throw new Error('AI response did not contain a non-empty questions array.');
  }

  const validated: QuizQuestion[] = [];
  const seenPrompts = new Set<string>();
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i] as Record<string, unknown>;
    if (!item || typeof item !== 'object') {
      continue;
    }

    const rawTypeVal = item.questionType ?? item.type ?? item.question_type;
    const rawType = typeof rawTypeVal === 'string' ? rawTypeVal.trim().toLowerCase() : requestedType;
    const normalizedType: QuestionType =
      rawType === 'mcq' || rawType === 'multiple_choice' || rawType === 'multiple-choice'
        ? 'mcq'
        : rawType === 'true_false' || rawType === 'true/false' || rawType === 'boolean'
          ? 'true_false'
          : rawType === 'long_answer' || rawType === 'long' || rawType === 'essay'
            ? 'long_answer'
            : rawType === 'short_answer' || rawType === 'short'
              ? 'short_answer'
              : requestedType === 'mixed'
                ? 'mcq'
                : requestedType;

    const prompt = typeof item.prompt === 'string'
      ? item.prompt.trim()
      : typeof item.question === 'string'
        ? item.question.trim()
        : typeof item.statement === 'string'
          ? item.statement.trim()
          : '';

    if (!prompt || prompt.length < 8) {
      continue;
    }

    const normalizedPromptKey = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (seenPrompts.has(normalizedPromptKey)) {
      continue;
    }
    seenPrompts.add(normalizedPromptKey);

    const difficultyRaw = typeof item.difficulty === 'string' ? item.difficulty.trim() : requestedDifficulty;
    const difficulty: Difficulty =
      difficultyRaw === 'Easy' || difficultyRaw === 'Medium' || difficultyRaw === 'Hard'
        ? difficultyRaw
        : requestedDifficulty;

    if (normalizedType === 'mcq') {
      let rawOptions: string[] = [];
      if (Array.isArray(item.options)) {
        rawOptions = item.options.map((opt) => stripOptionLabelPrefix(String(opt))).filter((opt) => opt.length > 0);
      } else if (item.options && typeof item.options === 'object') {
        rawOptions = Object.values(item.options as Record<string, unknown>)
          .map((opt) => stripOptionLabelPrefix(String(opt)))
          .filter((opt) => opt.length > 0);
      } else if (Array.isArray(item.choices)) {
        rawOptions = item.choices.map((opt) => stripOptionLabelPrefix(String(opt))).filter((opt) => opt.length > 0);
      }

      const uniqueOptions = Array.from(new Set(rawOptions));
      if (uniqueOptions.length < 2) {
        continue;
      }
      const options = uniqueOptions.slice(0, 5);
      const rawAnswerVal = item.correctAnswer ?? item.correct_answer ?? item.answer ?? item.correctOption ?? item.correct;
      const rawCorrect = typeof rawAnswerVal === 'string' || typeof rawAnswerVal === 'number'
        ? String(rawAnswerVal).trim()
        : '';
      const strippedCorrect = stripOptionLabelPrefix(rawCorrect);

      let matchedOption =
        options.find((opt) => opt.toLowerCase() === rawCorrect.toLowerCase()) ||
        options.find((opt) => opt.toLowerCase() === strippedCorrect.toLowerCase());

      if (!matchedOption) {
        const letterMatch = rawCorrect.toLowerCase().replace(/[^a-e]/g, '');
        if (rawCorrect.length <= 2 && letterMatch.length === 1 && ['a', 'b', 'c', 'd', 'e'].includes(letterMatch)) {
          matchedOption = options['abcde'.indexOf(letterMatch)];
        } else if (/^[1-5]$/.test(rawCorrect)) {
          matchedOption = options[Number(rawCorrect) - 1];
        } else {
          matchedOption = options.find(
            (opt) =>
              opt.toLowerCase().includes(strippedCorrect.toLowerCase()) ||
              (strippedCorrect.length > 3 && strippedCorrect.toLowerCase().includes(opt.toLowerCase()))
          );
        }
      }

      if (!matchedOption) {
        continue;
      }

      validated.push({
        id: `q-${i + 1}`,
        questionType: 'mcq',
        difficulty,
        topic: typeof item.topic === 'string' && item.topic.trim() ? item.topic.trim() : defaultTopic || '',
        prompt,
        options,
        correctAnswer: matchedOption,
        explanation:
          typeof item.explanation === 'string' && item.explanation.trim()
            ? item.explanation.trim()
            : 'Review the source material section referenced by this question.',
        marks: 2,
      });
    } else if (normalizedType === 'true_false') {
      const rawVal = item.correctAnswer ?? item.correct_answer ?? item.answer ?? item.correct;
      const rawCorrect = String(rawVal ?? '').trim().toLowerCase();
      if (rawCorrect !== 'true' && rawCorrect !== 'false') {
        continue;
      }
      validated.push({
        id: `q-${i + 1}`,
        questionType: 'true_false',
        difficulty,
        topic: typeof item.topic === 'string' && item.topic.trim() ? item.topic.trim() : defaultTopic || '',
        prompt,
        options: ['True', 'False'],
        correctAnswer: rawCorrect === 'true' ? 'True' : 'False',
        explanation:
          typeof item.explanation === 'string' && item.explanation.trim()
            ? item.explanation.trim()
            : 'Verify the statement against the uploaded study material.',
        marks: 1,
      });
    } else {
      const rawSuggested = item.suggestedAnswer ?? item.suggested_answer ?? item.correctAnswer ?? item.answer ?? item.modelAnswer;
      const suggestedAnswer = typeof rawSuggested === 'string' && rawSuggested.trim() ? rawSuggested.trim() : '';
      if (!suggestedAnswer) {
        continue;
      }
      const rawGuidance = item.markingGuidance ?? item.marking_guidance ?? item.rubric;
      const markingGuidance =
        typeof rawGuidance === 'string' && rawGuidance.trim()
          ? rawGuidance.trim()
          : 'Award marks for accurate core concepts, terminology, and supporting explanation from the source material.';
      validated.push({
        id: `q-${i + 1}`,
        questionType: normalizedType,
        difficulty,
        topic: typeof item.topic === 'string' && item.topic.trim() ? item.topic.trim() : defaultTopic || '',
        prompt,
        options: [],
        suggestedAnswer,
        markingGuidance,
        marks: normalizedType === 'long_answer' ? 10 : 5,
      });
    }
  }

  if (validated.length === 0) {
    throw new Error('Generated questions failed validation (missing options, answers, or required fields).');
  }

  return validated;
}

export interface GradeableQuestion {
  id: string;
  questionType: QuestionType;
  correctAnswer: string;
  marks: number;
}

export interface AttemptGradingSummary {
  objectiveScore: number;
  objectiveTotalMarks: number;
  totalPossibleMarks: number;
  hasDescriptiveQuestions: boolean;
  perQuestion: Record<string, { isCorrect: boolean | null; marksAwarded: number | null }>;
  percentageIfComplete: number;
}

export function gradeObjectiveQuestions(
  questions: readonly GradeableQuestion[],
  answersByQuestionId: Record<string, string>
): AttemptGradingSummary {
  let objectiveScore = 0;
  let objectiveTotalMarks = 0;
  let totalPossibleMarks = 0;
  let hasDescriptiveQuestions = false;
  const perQuestion: Record<string, { isCorrect: boolean | null; marksAwarded: number | null }> = {};

  for (const q of questions) {
    totalPossibleMarks += q.marks;
    const studentRaw = (answersByQuestionId[q.id] || '').trim();

    if (q.questionType === 'mcq' || q.questionType === 'true_false') {
      objectiveTotalMarks += q.marks;
      const isCorrect =
        studentRaw.length > 0 && studentRaw.toLowerCase() === q.correctAnswer.trim().toLowerCase();
      const awarded = isCorrect ? q.marks : 0;
      objectiveScore += awarded;
      perQuestion[q.id] = { isCorrect, marksAwarded: awarded };
    } else {
      hasDescriptiveQuestions = true;
      perQuestion[q.id] = { isCorrect: null, marksAwarded: null };
    }
  }

  const percentageIfComplete =
    totalPossibleMarks > 0 ? Math.round((objectiveScore / totalPossibleMarks) * 1000) / 10 : 0;

  return {
    objectiveScore,
    objectiveTotalMarks,
    totalPossibleMarks,
    hasDescriptiveQuestions,
    perQuestion,
    percentageIfComplete,
  };
}

export function computeFinalResult(
  objectiveScore: number,
  descriptiveScore: number,
  totalMarks: number,
  passingMarks: number
): { totalScore: number; percentage: number; passed: boolean } {
  const totalScore = Math.max(0, Math.round((objectiveScore + descriptiveScore) * 100) / 100);
  const percentage = totalMarks > 0 ? Math.round((totalScore / totalMarks) * 1000) / 10 : 0;
  const passed = totalScore >= passingMarks;
  return { totalScore, percentage, passed };
}

export function getRemainingSeconds(
  startedAtIso: string,
  durationMinutes: number,
  deadlineIso?: string | null,
  nowMs: number = Date.now()
): number {
  const startMs = Date.parse(startedAtIso);
  if (Number.isNaN(startMs)) {
    return 0;
  }
  const durationEndMs = startMs + durationMinutes * 60 * 1000;
  let effectiveEndMs = durationEndMs;
  if (deadlineIso) {
    const deadlineMs = Date.parse(deadlineIso);
    if (!Number.isNaN(deadlineMs)) {
      effectiveEndMs = Math.min(durationEndMs, deadlineMs);
    }
  }
  return Math.max(0, Math.floor((effectiveEndMs - nowMs) / 1000));
}

export function isAttemptWithinSubmissionWindow(
  startedAtIso: string,
  durationMinutes: number,
  deadlineIso?: string | null,
  nowMs: number = Date.now(),
  graceSeconds: number = 20
): boolean {
  const startMs = Date.parse(startedAtIso);
  if (Number.isNaN(startMs)) {
    return false;
  }
  const durationEndMs = startMs + durationMinutes * 60 * 1000 + graceSeconds * 1000;
  if (nowMs > durationEndMs) {
    return false;
  }
  if (deadlineIso) {
    const deadlineMs = Date.parse(deadlineIso);
    if (!Number.isNaN(deadlineMs) && nowMs > deadlineMs + graceSeconds * 1000) {
      return false;
    }
  }
  return true;
}

export function shouldAutoSubmitForViolations(
  tabSwitchCount: number,
  maxTabSwitches: number
): boolean {
  if (maxTabSwitches <= 0) {
    return false;
  }
  return tabSwitchCount >= maxTabSwitches;
}

export interface AnalyticsBucket {
  key: string;
  label: string;
  totalQuestions: number;
  answeredQuestions: number;
  gradedQuestions: number;
  correctQuestions: number;
  marksEarned: number;
  marksPossible: number;
  accuracyPercent: number | null;
}

export interface AttemptAnalytics {
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  pendingCount: number;
  timeTakenSeconds: number | null;
  formattedDuration: string;
  byQuestionType: AnalyticsBucket[];
  byDifficulty: AnalyticsBucket[];
  reviewFocusLabels: string[];
}

export function formatDurationSeconds(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '—';
  }
  const rounded = Math.round(totalSeconds);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Multiple Choice',
  true_false: 'True / False',
  short_answer: 'Short Answer',
  long_answer: 'Long Answer',
};

export function computeAttemptAnalytics(result: Pick<ExamResultDetail, 'startedAt' | 'submittedAt' | 'questions'>): AttemptAnalytics {
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  let pendingCount = 0;

  const typeMap = new Map<QuestionType, AnalyticsBucket>();
  const diffMap = new Map<Difficulty, AnalyticsBucket>();

  const getBucket = <K extends string>(map: Map<K, AnalyticsBucket>, key: K, label: string): AnalyticsBucket => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        label,
        totalQuestions: 0,
        answeredQuestions: 0,
        gradedQuestions: 0,
        correctQuestions: 0,
        marksEarned: 0,
        marksPossible: 0,
        accuracyPercent: null,
      };
      map.set(key, bucket);
    }
    return bucket;
  };

  for (const q of result.questions) {
    const hasAnswer = q.studentAnswer.trim().length > 0;
    const isObjective = q.questionType === 'mcq' || q.questionType === 'true_false';
    const isGraded = q.marksAwarded !== null;

    if (!hasAnswer) {
      unansweredCount += 1;
    }

    if (!isGraded) {
      pendingCount += 1;
    } else if (isObjective) {
      if (q.isCorrect) {
        correctCount += 1;
      } else if (hasAnswer) {
        incorrectCount += 1;
      }
    } else {
      // Descriptive graded by teacher
      if ((q.marksAwarded || 0) >= q.marks * 0.5) {
        correctCount += 1;
      } else if (hasAnswer) {
        incorrectCount += 1;
      }
    }

    const tb = getBucket(typeMap, q.questionType, QUESTION_TYPE_LABELS[q.questionType]);
    const db = getBucket(diffMap, q.difficulty, q.difficulty);

    for (const bucket of [tb, db]) {
      bucket.totalQuestions += 1;
      if (hasAnswer) bucket.answeredQuestions += 1;
      if (isGraded) {
        bucket.gradedQuestions += 1;
        bucket.marksPossible += q.marks;
        bucket.marksEarned += q.marksAwarded || 0;
        if (isObjective ? Boolean(q.isCorrect) : (q.marksAwarded || 0) >= q.marks * 0.5) {
          bucket.correctQuestions += 1;
        }
      }
    }
  }

  const finalizeBuckets = (buckets: AnalyticsBucket[]): AnalyticsBucket[] =>
    buckets.map((b) => ({
      ...b,
      marksEarned: Math.round(b.marksEarned * 100) / 100,
      accuracyPercent:
        b.marksPossible > 0 ? Math.round((b.marksEarned / b.marksPossible) * 1000) / 10 : null,
    }));

  const byQuestionType = finalizeBuckets(Array.from(typeMap.values()));
  const diffOrder: Difficulty[] = ['Easy', 'Medium', 'Hard'];
  const byDifficulty = finalizeBuckets(
    diffOrder.map((d) => diffMap.get(d)).filter((b): b is AnalyticsBucket => Boolean(b))
  );

  let timeTakenSeconds: number | null = null;
  if (result.startedAt && result.submittedAt) {
    const startMs = Date.parse(result.startedAt);
    const endMs = Date.parse(result.submittedAt);
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
      timeTakenSeconds = Math.round((endMs - startMs) / 1000);
    }
  }

  const reviewFocusLabels: string[] = [];
  for (const bucket of [...byDifficulty, ...byQuestionType]) {
    if (bucket.gradedQuestions >= 2 && bucket.accuracyPercent !== null && bucket.accuracyPercent < 60) {
      reviewFocusLabels.push(`${bucket.label} (${bucket.accuracyPercent}% scored across ${bucket.gradedQuestions} questions)`);
    }
  }
  if (unansweredCount > 0) {
    reviewFocusLabels.push(`${unansweredCount} unanswered question${unansweredCount > 1 ? 's' : ''} — practice pacing with timed quizzes`);
  }

  return {
    totalQuestions: result.questions.length,
    correctCount,
    incorrectCount,
    unansweredCount,
    pendingCount,
    timeTakenSeconds,
    formattedDuration: formatDurationSeconds(timeTakenSeconds),
    byQuestionType,
    byDifficulty,
    reviewFocusLabels,
  };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateEnrollmentCode(randomBytes?: Uint8Array): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    const byteVal =
      randomBytes && randomBytes.length > i
        ? randomBytes[i]
        : Math.floor(Math.random() * 256);
    code += CODE_ALPHABET[byteVal % CODE_ALPHABET.length];
  }
  return `EXAM-${code}`;
}

export function normalizeEnrollmentCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function computeAssignmentLifecycleStatus(params: {
  startTime?: string | null;
  endTime?: string | null;
  deadlineAt?: string | null;
  attemptStatus?: 'in_progress' | 'submitted' | 'evaluated' | null;
  nowMs?: number;
}): AssignmentLifecycleStatus {
  const now = params.nowMs ?? Date.now();
  if (params.attemptStatus === 'submitted' || params.attemptStatus === 'evaluated') {
    return 'Completed';
  }
  if (params.attemptStatus === 'in_progress') {
    return 'Started';
  }
  const expiryIso = params.endTime || params.deadlineAt;
  if (expiryIso) {
    const expMs = Date.parse(expiryIso);
    if (!Number.isNaN(expMs) && now > expMs) {
      return 'Expired';
    }
  }
  if (params.startTime) {
    const startMs = Date.parse(params.startTime);
    if (!Number.isNaN(startMs) && now >= startMs) {
      return 'Not attempted';
    }
  }
  return 'Assigned';
}

export interface StudentProgressExamInput {
  examId: string;
  examTitle: string;
  subject: string;
  attemptId?: string | null;
  attemptStatus?: 'in_progress' | 'submitted' | 'evaluated' | null;
  startedAt?: string | null;
  submittedAt?: string | null;
  result?: {
    totalScore: number;
    totalMarks: number;
    percentage: number;
    passed: boolean;
    status: 'pending_evaluation' | 'evaluated';
  } | null;
  questionAnswers?: Array<{
    topic: string;
    marks: number;
    marksAwarded: number | null;
    isCorrect: boolean | null;
    studentAnswer: string;
  }>;
}

export interface StudentProgressPracticeInput {
  id: string;
  quizTitle: string;
  topic: string;
  score: number;
  totalMarks: number;
  percentage: number;
  completedAt: string;
}

export function computeStudentProgressOverview(input: {
  exams: StudentProgressExamInput[];
  practiceAttempts: StudentProgressPracticeInput[];
}): StudentProgressSummary {
  const attempted = input.exams.filter((e) => Boolean(e.attemptId));
  const completed = attempted.filter(
    (e) => e.attemptStatus === 'submitted' || e.attemptStatus === 'evaluated'
  );
  const evaluated = completed.filter((e) => e.result?.status === 'evaluated');

  const evaluatedPercentages = evaluated.map((e) => Number(e.result!.percentage));
  const averageScore =
    evaluatedPercentages.length > 0
      ? Math.round((evaluatedPercentages.reduce((a, b) => a + b, 0) / evaluatedPercentages.length) * 10) / 10
      : null;
  const highestScore =
    evaluatedPercentages.length > 0 ? Math.max(...evaluatedPercentages) : null;
  const passCount = evaluated.filter((e) => Boolean(e.result?.passed)).length;
  const passRate =
    evaluated.length > 0 ? Math.round((passCount / evaluated.length) * 1000) / 10 : null;

  let totalCorrect = 0;
  let totalIncorrect = 0;
  let totalUnanswered = 0;

  const subjectMap = new Map<string, { subject: string; percentages: number[] }>();
  const topicMap = new Map<
    string,
    {
      topic: string;
      subject: string;
      attemptedQuestions: number;
      correctQuestions: number;
      marksEarned: number;
      marksPossible: number;
    }
  >();

  for (const ex of completed) {
    if (ex.result?.status === 'evaluated') {
      const subKey = ex.subject || 'General';
      const entry = subjectMap.get(subKey) || { subject: subKey, percentages: [] };
      entry.percentages.push(Number(ex.result.percentage));
      subjectMap.set(subKey, entry);
    }

    for (const q of ex.questionAnswers || []) {
      const answered = q.studentAnswer.trim().length > 0;
      if (!answered) {
        totalUnanswered += 1;
      } else if (q.isCorrect === true || (q.marksAwarded !== null && q.marksAwarded >= q.marks * 0.5)) {
        totalCorrect += 1;
      } else if (q.marksAwarded !== null) {
        totalIncorrect += 1;
      }

      const topicLabel = (q.topic || ex.subject || 'General').trim();
      if (q.marksAwarded !== null && topicLabel) {
        const key = topicLabel.toLowerCase();
        const t = topicMap.get(key) || {
          topic: topicLabel,
          subject: ex.subject || 'General',
          attemptedQuestions: 0,
          correctQuestions: 0,
          marksEarned: 0,
          marksPossible: 0,
        };
        t.attemptedQuestions += 1;
        t.marksPossible += Number(q.marks || 0);
        t.marksEarned += Number(q.marksAwarded || 0);
        if (q.isCorrect === true || Number(q.marksAwarded || 0) >= Number(q.marks || 1) * 0.5) {
          t.correctQuestions += 1;
        }
        topicMap.set(key, t);
      }
    }
  }

  // Also include practice quizzes in topic breakdown if topic is present
  for (const pa of input.practiceAttempts) {
    const topicLabel = (pa.topic || '').trim();
    if (topicLabel) {
      const key = topicLabel.toLowerCase();
      const t = topicMap.get(key) || {
        topic: topicLabel,
        subject: 'Practice Study',
        attemptedQuestions: 0,
        correctQuestions: 0,
        marksEarned: 0,
        marksPossible: 0,
      };
      t.attemptedQuestions += 1;
      t.marksPossible += Number(pa.totalMarks || 0);
      t.marksEarned += Number(pa.score || 0);
      if (pa.percentage >= 70) {
        t.correctQuestions += 1;
      }
      topicMap.set(key, t);
    }
  }

  const practicePercentages = input.practiceAttempts.map((p) => Number(p.percentage));
  const practiceAverage =
    practicePercentages.length > 0
      ? Math.round((practicePercentages.reduce((a, b) => a + b, 0) / practicePercentages.length) * 10) / 10
      : null;

  const subjectBreakdown = Array.from(subjectMap.values()).map((s) => ({
    subject: s.subject,
    attempts: s.percentages.length,
    averagePercentage:
      Math.round((s.percentages.reduce((a, b) => a + b, 0) / s.percentages.length) * 10) / 10,
    highestPercentage: Math.max(...s.percentages),
  }));

  const topicBreakdown = Array.from(topicMap.values())
    .filter((t) => t.marksPossible > 0)
    .map((t) => ({
      ...t,
      marksEarned: Math.round(t.marksEarned * 100) / 100,
      accuracyPercent: Math.round((t.marksEarned / t.marksPossible) * 1000) / 10,
    }))
    .sort((a, b) => a.accuracyPercent - b.accuracyPercent);

  const strongTopics = topicBreakdown
    .filter((t) => t.accuracyPercent >= 75)
    .sort((a, b) => b.accuracyPercent - a.accuracyPercent)
    .slice(0, 5)
    .map((t) => ({
      topic: t.topic,
      accuracyPercent: t.accuracyPercent,
      attemptedQuestions: t.attemptedQuestions,
    }));

  const weakTopics = topicBreakdown
    .filter((t) => t.accuracyPercent < 65)
    .slice(0, 5)
    .map((t) => ({
      topic: t.topic,
      accuracyPercent: t.accuracyPercent,
      attemptedQuestions: t.attemptedQuestions,
    }));

  const scoreTrend = [
    ...evaluated.map((e) => ({
      id: e.attemptId || e.examId,
      label: e.examTitle,
      subject: e.subject,
      percentage: Number(e.result!.percentage),
      kind: 'official' as const,
      date: e.submittedAt || e.startedAt || new Date().toISOString(),
    })),
    ...input.practiceAttempts.map((p) => ({
      id: p.id,
      label: p.quizTitle,
      subject: p.topic || 'Practice',
      percentage: Number(p.percentage),
      kind: 'practice' as const,
      date: p.completedAt,
    })),
  ].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const hasSufficientData = evaluated.length > 0 || input.practiceAttempts.length > 0;
  const suggestions: string[] = [];

  if (!hasSufficientData) {
    suggestions.push(
      'Complete at least one evaluated exam or practice quiz to unlock personalized topic recommendations.'
    );
  } else {
    for (const w of weakTopics.slice(0, 3)) {
      suggestions.push(
        `Review "${w.topic}" (${w.accuracyPercent}% accuracy across ${w.attemptedQuestions} graded item${w.attemptedQuestions === 1 ? '' : 's'}). Generate a Medium practice quiz focused on this topic.`
      );
    }
    if (totalUnanswered > 0) {
      suggestions.push(
        `You left ${totalUnanswered} exam question${totalUnanswered === 1 ? '' : 's'} unanswered. Use timed practice sets to build pacing before official exams.`
      );
    }
    if (suggestions.length === 0 && averageScore !== null) {
      suggestions.push(
        averageScore >= 80
          ? 'Strong consistency across evaluated assessments. Challenge yourself with Hard-level practice questions to deepen mastery.'
          : 'Review explanations on missed questions in Exam History and drill weak sections with targeted practice quizzes.'
      );
    }
  }

  return {
    hasSufficientData,
    totalAttempted: attempted.length,
    totalCompleted: completed.length,
    evaluatedCount: evaluated.length,
    averageScore,
    highestScore,
    passRate,
    totalCorrect,
    totalIncorrect,
    totalUnanswered,
    practiceAttemptsCount: input.practiceAttempts.length,
    practiceAverage,
    subjectBreakdown,
    topicBreakdown,
    strongTopics,
    weakTopics,
    scoreTrend,
    suggestions,
  };
}

export interface ClassSubmissionMetric {
  studentId: string;
  studentName: string;
  studentEmail: string;
  percentage: number;
  passed: boolean;
  status: 'submitted' | 'evaluated';
}

export function computeTeacherClassAnalytics(params: {
  members: Array<{ studentId: string; studentName: string; studentEmail: string }>;
  submissions: ClassSubmissionMetric[];
  expectedTotalAssignments?: number;
}) {
  const memberIds = new Set(params.members.map((m) => m.studentId));
  const scoped = params.members.length > 0
    ? params.submissions.filter((s) => memberIds.has(s.studentId))
    : params.submissions;
  const evaluated = scoped.filter((s) => s.status === 'evaluated');
  const scores = evaluated.map((s) => Number(s.percentage));

  const classAverage =
    scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
  const highestScore = scores.length > 0 ? Math.max(...scores) : null;
  const lowestScore = scores.length > 0 ? Math.min(...scores) : null;

  const expected = Math.max(params.expectedTotalAssignments ?? params.members.length, 0);
  const uniqueSubmitters = new Set(scoped.map((s) => s.studentId)).size;
  const completionRate =
    expected > 0 ? Math.min(100, Math.round((uniqueSubmitters / expected) * 1000) / 10) : null;

  const distribution = [
    { label: '80–100%', count: scores.filter((x) => x >= 80).length },
    { label: '60–79%', count: scores.filter((x) => x >= 60 && x < 80).length },
    { label: '40–59%', count: scores.filter((x) => x >= 40 && x < 60).length },
    { label: '0–39%', count: scores.filter((x) => x < 40).length },
  ];

  const byStudent = new Map<string, { id: string; name: string; email: string; scores: number[]; attempts: number }>();
  for (const m of params.members) {
    byStudent.set(m.studentId, { id: m.studentId, name: m.studentName, email: m.studentEmail, scores: [], attempts: 0 });
  }
  for (const s of scoped) {
    const entry = byStudent.get(s.studentId) || {
      id: s.studentId,
      name: s.studentName,
      email: s.studentEmail,
      scores: [],
      attempts: 0,
    };
    entry.attempts += 1;
    if (s.status === 'evaluated') entry.scores.push(Number(s.percentage));
    byStudent.set(s.studentId, entry);
  }

  const ranking = Array.from(byStudent.values())
    .map((r) => ({
      studentId: r.id,
      studentName: r.name,
      studentEmail: r.email,
      attemptsCount: r.attempts,
      averagePercentage:
        r.scores.length > 0 ? Math.round((r.scores.reduce((a, b) => a + b, 0) / r.scores.length) * 10) / 10 : null,
    }))
    .sort((a, b) => (b.averagePercentage ?? -1) - (a.averagePercentage ?? -1));

  const studentsNeedingSupport = ranking.filter(
    (r) => (r.averagePercentage !== null && r.averagePercentage < 60) || r.attemptsCount === 0
  );

  return {
    classAverage,
    highestScore,
    lowestScore,
    completionRate,
    evaluatedCount: evaluated.length,
    distribution,
    ranking,
    studentsNeedingSupport,
  };
}
