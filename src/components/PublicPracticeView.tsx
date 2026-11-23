import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { BrandMark } from './BrandMark';

interface SampleQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

interface SampleDeck {
  id: string;
  title: string;
  subject: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  questions: SampleQuestion[];
}

const SAMPLE_DECKS: SampleDeck[] = [
  {
    id: 'bio-respiration',
    title: 'Cellular Respiration & ATP Synthesis',
    subject: 'Biology',
    difficulty: 'Medium',
    questions: [
      {
        id: 'bio-1',
        prompt: 'Where does glycolysis occur in a eukaryotic cell?',
        options: ['Cytoplasm', 'Mitochondrial matrix', 'Inner mitochondrial membrane', 'Nucleus'],
        correctAnswer: 'Cytoplasm',
        explanation: 'Glycolysis breaks one glucose molecule into two pyruvate molecules inside the cytoplasm without requiring oxygen.',
      },
      {
        id: 'bio-2',
        prompt: 'Which molecule serves as the terminal electron acceptor in the Electron Transport Chain?',
        options: ['Oxygen', 'Carbon dioxide', 'Pyruvate', 'NAD+'],
        correctAnswer: 'Oxygen',
        explanation: 'Oxygen accepts electrons at the end of the ETC and combines with protons to form water.',
      },
      {
        id: 'bio-3',
        prompt: 'Across two turns of the Citric Acid Cycle per glucose molecule, how many NADH molecules are generated?',
        options: ['6 NADH', '2 NADH', '10 NADH', '32 NADH'],
        correctAnswer: '6 NADH',
        explanation: 'Each turn generates 3 NADH, so two turns per glucose molecule yield 6 NADH, 2 FADH2, and 2 ATP/GTP.',
      },
      {
        id: 'bio-4',
        prompt: 'What enzyme phosphorylates ADP into ATP using the electrochemical proton gradient?',
        options: ['ATP synthase', 'Hexokinase', 'Pyruvate dehydrogenase', 'Phosphofructokinase'],
        correctAnswer: 'ATP synthase',
        explanation: 'ATP synthase harnesses proton-motive force (chemiosmosis) across the inner mitochondrial membrane.',
      },
    ],
  },
  {
    id: 'db-normalization',
    title: 'Relational Database Normalization & SQL',
    subject: 'Computer Science',
    difficulty: 'Medium',
    questions: [
      {
        id: 'db-1',
        prompt: 'Which normal form eliminates partial dependencies on a composite primary key?',
        options: ['Second Normal Form (2NF)', 'First Normal Form (1NF)', 'Zero Normal Form', 'Referential Integrity'],
        correctAnswer: 'Second Normal Form (2NF)',
        explanation: '2NF requires 1NF and guarantees every non-key attribute depends on the entire composite primary key.',
      },
      {
        id: 'db-2',
        prompt: 'Third Normal Form (3NF) removes which specific type of dependency?',
        options: ['Transitive dependency', 'Atomic column dependency', 'Foreign key cascade', 'Primary index dependency'],
        correctAnswer: 'Transitive dependency',
        explanation: '3NF ensures no non-key attribute depends transitively on another non-key attribute.',
      },
      {
        id: 'db-3',
        prompt: 'Which constraint enforces that child rows always reference a valid parent record?',
        options: ['Foreign Key constraint', 'Unique Index', 'Check Null', 'Composite Alias'],
        correctAnswer: 'Foreign Key constraint',
        explanation: 'Foreign keys maintain referential integrity between related relational tables.',
      },
    ],
  },
];

export function PublicPracticeView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [selectedDeckId, setSelectedDeckId] = useState<string>(SAMPLE_DECKS[0].id);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const deck = SAMPLE_DECKS.find((d) => d.id === selectedDeckId) || SAMPLE_DECKS[0];
  const currentQuestion = deck.questions[currentIdx];

  const handleSelectDeck = (deckId: string) => {
    setSelectedDeckId(deckId);
    setCurrentIdx(0);
    setAnswers({});
    setSubmitted(false);
  };

  const correctCount = deck.questions.filter(
    (q) => (answers[q.id] || '').toLowerCase() === q.correctAnswer.toLowerCase()
  ).length;
  const percentage = Math.round((correctCount / deck.questions.length) * 100);

  return (
    <div className="min-h-screen bg-[#F5F1E8] text-[#252525] flex flex-col">
      <header className="bg-white border-b border-[#E3DED3]">
        <div className="max-w-[1160px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => onNavigate('/')} aria-label="ExamAI home">
              <BrandMark variant="light" size="sm" />
            </button>
            <span className="hidden sm:inline text-xs font-mono text-[#77736C]">Guest Practice Sandbox</span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('/login')}
              className="px-3.5 py-2 rounded-lg border border-[#E3DED3] bg-white hover:bg-[#EFEBE2] text-xs font-semibold text-[#252525] whitespace-nowrap"
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/register')}
              className="px-3.5 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold whitespace-nowrap"
            >
              Register Free
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1000px] w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="bg-[#171717] text-white rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#DFC58E] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Interactive Sample Practice
            </p>
            <h1 className="text-xl sm:text-2xl font-display font-bold">Try ExamAI Study Practice</h1>
            <p className="text-xs text-[#D6D0C4]">
              Guest practice runs locally in your browser. Create a Student account to upload your own PDF/DOCX notes and save progress.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/register')}
            className="px-4 py-2.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold shrink-0 whitespace-nowrap"
          >
            Create Student Account
          </button>
        </div>

        {/* Deck Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SAMPLE_DECKS.map((d) => {
            const active = d.id === deck.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => handleSelectDeck(d.id)}
                className={`p-4 rounded-xl border text-left transition-colors ${
                  active ? 'bg-white border-[#C9A45C]' : 'bg-white/70 border-[#E3DED3] hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-mono text-[#66543A]">
                    {d.subject} · {d.difficulty}
                  </span>
                  <span className="text-xs font-mono text-[#77736C]">{d.questions.length} Qs</span>
                </div>
                <div className="font-display font-bold text-sm text-[#252525] flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#66543A] shrink-0" />
                  {d.title}
                </div>
              </button>
            );
          })}
        </div>

        {!submitted ? (
          <div className="bg-white border border-[#E3DED3] rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between text-xs font-mono text-[#77736C]">
              <span>
                Question {currentIdx + 1} of {deck.questions.length}
              </span>
              <span>{Object.keys(answers).length} answered</span>
            </div>

            <h2 className="text-lg font-display font-semibold text-[#252525]">{currentQuestion.prompt}</h2>

            <div className="space-y-2.5">
              {currentQuestion.options.map((opt) => {
                const selected = answers[currentQuestion.id] === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAnswers((prev) => ({ ...prev, [currentQuestion.id]: opt }))}
                    className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm transition-colors ${
                      selected
                        ? 'bg-[#F5F1E8] border-[#C9A45C] font-semibold text-[#252525]'
                        : 'bg-white border-[#E3DED3] hover:bg-[#EFEBE2]/50 text-[#252525]'
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            <div className="pt-4 border-t border-[#E3DED3] flex items-center justify-between gap-4">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold disabled:opacity-40"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Previous
              </button>

              {currentIdx < deck.questions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setCurrentIdx((i) => i + 1)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-semibold"
                >
                  Next
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSubmitted(true)}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold"
                >
                  Score Sample Quiz
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-white border border-[#E3DED3] rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-[#66543A]">Guest Practice Score</p>
                <h2 className="text-2xl font-display font-bold font-mono tabular-nums mt-1">
                  {correctCount} / {deck.questions.length} ({percentage}%)
                </h2>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => handleSelectDeck(deck.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold hover:bg-[#EFEBE2]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/register')}
                  className="px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-semibold"
                >
                  Sign Up to Save Progress
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {deck.questions.map((q, idx) => {
                const chosen = answers[q.id] || '';
                const isCorrect = chosen.toLowerCase() === q.correctAnswer.toLowerCase();
                return (
                  <div key={q.id} className="bg-white border border-[#E3DED3] rounded-xl p-5 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-[#77736C]">Q{idx + 1}</span>
                      {isCorrect ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#25845D]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Correct
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#C64B4B]">
                          <XCircle className="w-3.5 h-3.5" /> Incorrect
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-sm text-[#252525]">{q.prompt}</p>
                    <p className="text-xs text-[#77736C]">
                      Your answer: <strong className="text-[#252525]">{chosen || 'Unanswered'}</strong> · Correct answer:{' '}
                      <strong className="text-[#25845D]">{q.correctAnswer}</strong>
                    </p>
                    <p className="text-xs text-[#66543A] bg-[#F5F1E8] px-3 py-2 rounded-lg">{q.explanation}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
