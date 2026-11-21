import type { Difficulty, QuestionType, QuizQuestion } from '../types/index';

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

export function stripMarkdownCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
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
      : null;

  if (!rawList || rawList.length === 0) {
    throw new Error('AI response did not contain a non-empty questions array.');
  }

  const validated: QuizQuestion[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i] as Record<string, unknown>;
    if (!item || typeof item !== 'object') {
      continue;
    }

    const rawType = typeof item.questionType === 'string' ? item.questionType.trim().toLowerCase() : requestedType;
    const normalizedType: QuestionType =
      rawType === 'mcq' || rawType === 'multiple_choice'
        ? 'mcq'
        : rawType === 'true_false' || rawType === 'true/false'
          ? 'true_false'
          : rawType === 'long_answer' || rawType === 'long'
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
        : '';

    if (!prompt || prompt.length < 8) {
      continue;
    }

    const difficultyRaw = typeof item.difficulty === 'string' ? item.difficulty.trim() : requestedDifficulty;
    const difficulty: Difficulty =
      difficultyRaw === 'Easy' || difficultyRaw === 'Medium' || difficultyRaw === 'Hard'
        ? difficultyRaw
        : requestedDifficulty;

    if (normalizedType === 'mcq') {
      const rawOptions = Array.isArray(item.options)
        ? item.options.map((opt) => String(opt).trim()).filter((opt) => opt.length > 0)
        : [];
      const uniqueOptions = Array.from(new Set(rawOptions));
      if (uniqueOptions.length < 4) {
        continue;
      }
      const options = uniqueOptions.slice(0, 4);
      const rawCorrect = typeof item.correctAnswer === 'string' ? item.correctAnswer.trim() : '';
      const matchedOption =
        options.find((opt) => opt.toLowerCase() === rawCorrect.toLowerCase()) ||
        (rawCorrect.length === 1 && ['a', 'b', 'c', 'd'].includes(rawCorrect.toLowerCase())
          ? options['abcd'.indexOf(rawCorrect.toLowerCase())]
          : undefined);

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
      const rawCorrect = String(item.correctAnswer ?? '').trim().toLowerCase();
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
      const suggestedAnswer =
        typeof item.suggestedAnswer === 'string' && item.suggestedAnswer.trim()
          ? item.suggestedAnswer.trim()
          : typeof item.correctAnswer === 'string' && item.correctAnswer.trim()
            ? item.correctAnswer.trim()
            : '';
      if (!suggestedAnswer) {
        continue;
      }
      const markingGuidance =
        typeof item.markingGuidance === 'string' && item.markingGuidance.trim()
          ? item.markingGuidance.trim()
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
