import Groq from 'groq-sdk';
import { buildSmartContextExcerpt, parseAndValidateGroqQuestions } from '../src/lib/examRules.ts';
import type { Difficulty, QuestionType, QuizQuestion } from '../src/types/index.ts';

export interface GenerateQuestionsInput {
  sourceText: string;
  questionType: QuestionType | 'mixed';
  difficulty: Difficulty;
  count: number;
  topic?: string;
}

export function getAiAvailability(): {
  groqConfigured: boolean;
  geminiConfigured: boolean;
  aiConfigured: boolean;
  groqModel: string;
} {
  const groqConfigured = Boolean(process.env.GROQ_API_KEY?.trim());
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const groqModel = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';
  return {
    groqConfigured,
    geminiConfigured,
    aiConfigured: groqConfigured || geminiConfigured,
    groqModel,
  };
}

function buildSystemPrompt(input: GenerateQuestionsInput, safeCount: number): string {
  const typeInstruction =
    input.questionType === 'mixed'
      ? 'Generate a balanced mix of mcq, true_false, short_answer, and long_answer questions.'
      : `Generate ONLY questions of questionType "${input.questionType}".`;

  const topicLine = input.topic?.trim()
    ? `Focus specifically on the topic/chapter: "${input.topic.trim()}".`
    : 'Cover the core concepts present in the provided source text.';

  return `You are an expert academic assessment author. You strictly generate exam questions grounded ONLY in the user's provided source material.
Return ONLY a valid JSON object with a single top-level key "questions" containing an array of exactly ${safeCount} question objects.
Schema per question:
- For "mcq": { "questionType": "mcq", "difficulty": "${input.difficulty}", "topic": "short topic", "prompt": "clear question", "options": ["opt1", "opt2", "opt3", "opt4"], "correctAnswer": "exact string matching one option", "explanation": "why it is correct based on source text" }
- For "true_false": { "questionType": "true_false", "difficulty": "${input.difficulty}", "topic": "short topic", "prompt": "clear declarative statement", "options": ["True", "False"], "correctAnswer": "True" or "False", "explanation": "why based on source text" }
- For "short_answer": { "questionType": "short_answer", "difficulty": "${input.difficulty}", "topic": "short topic", "prompt": "focused short-answer question", "suggestedAnswer": "concise model answer", "markingGuidance": "rubric points for awarding marks" }
- For "long_answer": { "questionType": "long_answer", "difficulty": "${input.difficulty}", "topic": "short topic", "prompt": "analytical essay question", "suggestedAnswer": "comprehensive model answer", "markingGuidance": "detailed rubric breakdown" }
Rules:
1. Never invent facts outside the provided document text.
2. Never output markdown or prose outside the JSON object.
3. ${typeInstruction}
4. Target difficulty: ${input.difficulty}. ${topicLine}`;
}

async function generateViaGroq(
  apiKey: string,
  systemPrompt: string,
  excerpt: string,
  input: GenerateQuestionsInput
): Promise<QuizQuestion[]> {
  const preferredModel = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';
  const candidateModels = Array.from(
    new Set([preferredModel, 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'])
  );

  const groq = new Groq({ apiKey });
  let lastError: unknown;

  for (const model of candidateModels) {
    for (const useJsonMode of [true, false]) {
      try {
        const completion = await groq.chat.completions.create({
          model,
          temperature: 0.3,
          ...(useJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `SOURCE STUDY/TEACHING MATERIAL:\n\n${excerpt}`,
            },
          ],
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error('Groq API returned an empty response.');
        }

        return parseAndValidateGroqQuestions(
          content,
          input.questionType,
          input.difficulty,
          input.topic
        );
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('401') || msg.toLowerCase().includes('invalid api key')) {
          throw new Error('Groq API authentication failed. Please verify your GROQ_API_KEY.');
        }
        // Only retry without json_object if json_validate / response_format caused a 400 error
        if (
          useJsonMode &&
          (msg.includes('response_format') || msg.includes('json_validate') || msg.includes('400'))
        ) {
          continue;
        }
        break;
      }
    }
  }

  const finalMsg = lastError instanceof Error ? lastError.message : 'Groq API request failed.';
  throw new Error(`AI generation failed: ${finalMsg}`);
}

async function generateViaGemini(
  apiKey: string,
  systemPrompt: string,
  excerpt: string,
  input: GenerateQuestionsInput
): Promise<QuizQuestion[]> {
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `${systemPrompt}\n\nSOURCE STUDY/TEACHING MATERIAL:\n\n${excerpt}`,
    config: {
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  });

  const content = response.text;
  if (!content) {
    throw new Error('Gemini API returned an empty response.');
  }

  return parseAndValidateGroqQuestions(
    content,
    input.questionType,
    input.difficulty,
    input.topic
  );
}

export async function generateQuestionsWithGroq(
  input: GenerateQuestionsInput
): Promise<QuizQuestion[]> {
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();

  if (!groqKey && !geminiKey) {
    throw new Error(
      'No AI API key is configured on the server. Add GROQ_API_KEY (or GEMINI_API_KEY) to your environment variables to generate questions from uploaded PDFs.'
    );
  }

  const safeCount = Math.min(Math.max(1, Math.floor(input.count || 5)), 15);
  const excerpt = buildSmartContextExcerpt(input.sourceText, 15000);
  const systemPrompt = buildSystemPrompt(input, safeCount);

  if (groqKey) {
    try {
      return await generateViaGroq(groqKey, systemPrompt, excerpt, input);
    } catch (groqErr) {
      if (geminiKey) {
        return await generateViaGemini(geminiKey, systemPrompt, excerpt, input);
      }
      throw groqErr;
    }
  }

  return await generateViaGemini(geminiKey!, systemPrompt, excerpt, input);
}
