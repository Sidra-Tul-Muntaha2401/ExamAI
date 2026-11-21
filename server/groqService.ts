import Groq from 'groq-sdk';
import { parseAndValidateGroqQuestions } from '../src/lib/examRules.ts';
import type { Difficulty, QuestionType, QuizQuestion } from '../src/types/index.ts';

export interface GenerateQuestionsInput {
  sourceText: string;
  questionType: QuestionType | 'mixed';
  difficulty: Difficulty;
  count: number;
  topic?: string;
}

export async function generateQuestionsWithGroq(
  input: GenerateQuestionsInput
): Promise<QuizQuestion[]> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not configured on the server. Add your Groq API key to .env (local) or Secrets to enable AI question generation.'
    );
  }

  const safeCount = Math.min(Math.max(1, Math.floor(input.count || 5)), 15);
  const excerpt = input.sourceText.slice(0, 14000);
  const model = process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile';

  const groq = new Groq({ apiKey });

  const typeInstruction =
    input.questionType === 'mixed'
      ? 'Generate a balanced mix of mcq, true_false, short_answer, and long_answer questions.'
      : `Generate ONLY questions of questionType "${input.questionType}".`;

  const topicLine = input.topic?.trim()
    ? `Focus specifically on the topic/chapter: "${input.topic.trim()}".`
    : 'Cover the core concepts present in the provided source text.';

  const systemPrompt = `You are an expert academic assessment author. You strictly generate exam questions grounded ONLY in the user's provided source material.
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

  try {
    const completion = await groq.chat.completions.create({
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
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
    const message = err instanceof Error ? err.message : 'Groq API request failed.';
    if (message.includes('401') || message.toLowerCase().includes('api key')) {
      throw new Error('Groq API authentication failed. Please verify your GROQ_API_KEY.');
    }
    throw new Error(`AI generation failed: ${message}`);
  }
}
