import React, { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  GraduationCap,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { BrandMark } from './BrandMark';

interface LandingPageProps {
  onNavigate: (path: string) => void;
}

const FAQS = [
  {
    q: 'Which document formats can students and teachers upload?',
    a: 'ExamAI supports text-based PDF (.pdf) and Microsoft Word (.docx) files up to 10 MB. Text is extracted on the server and previewed before generating questions. Scanned image-only PDFs without embedded text are detected and reported clearly because ExamAI does not run OCR.',
  },
  {
    q: 'How does Groq AI generate questions from my notes?',
    a: 'Your extracted document text is sent securely from the backend server to the Groq API using your server-side GROQ_API_KEY. Questions are validated against a strict JSON schema for MCQs, True/False, Short Answer, and Long Answer formats before you review or save them.',
  },
  {
    q: 'How are official exams secured against cheating?',
    a: 'Teachers can enable question order randomization, MCQ option shuffling, server-side duration and deadline enforcement, and browser tab-visibility / focus-loss logging. ExamAI never secretly accesses your camera or microphone, and clearly explains that browser event tracking is an integrity aid rather than an absolute guarantee.',
  },
  {
    q: 'Are student practice quizzes separate from official teacher exams?',
    a: 'Yes. Student study documents and practice quizzes are private to each student account. Official examinations, question banks, grading rubrics, and submissions are managed strictly by teachers with server-side role verification.',
  },
];

const SAMPLE_TESTIMONIALS = [
  {
    name: 'Dr. Priya Nair',
    role: 'Associate Professor of Computer Science · Sample Persona',
    quote:
      'Before ExamAI, drafting randomized midterm variants and grading short-answer rubrics took two weekends. Uploading our lecture PDFs into the Question Bank cut preparation time from 6 hours to 40 minutes while keeping manual rubric control.',
  },
  {
    name: 'Daniel Okafor',
    role: 'Undergraduate Biology Student · Sample Persona',
    quote:
      'Uploading my cellular respiration DOCX notes and drilling Medium and Hard MCQs with immediate explanations helped raise my practice quiz accuracy from 68% to 91% before finals.',
  },
];

export function LandingPage({ onNavigate }: LandingPageProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [previewTab, setPreviewTab] = useState<'extract' | 'mcq' | 'rubric'>('mcq');

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#252525]">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#E3DED3]">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/');
            }}
            aria-label="ExamAI home"
            className="whitespace-nowrap shrink-0"
          >
            <BrandMark variant="light" />
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#77736C]">
            <a href="#features" className="hover:text-[#252525] transition-colors whitespace-nowrap shrink-0">
              Features
            </a>
            <a href="#modes" className="hover:text-[#252525] transition-colors whitespace-nowrap shrink-0">
              Study &amp; Teaching
            </a>
            <a href="#workflow" className="hover:text-[#252525] transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#showcase" className="hover:text-[#252525] transition-colors whitespace-nowrap shrink-0">
              AI Preview
            </a>
            <a href="#faq" className="hover:text-[#252525] transition-colors whitespace-nowrap shrink-0">
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('/student')}
              className="px-3.5 py-2 rounded-lg border border-[#E3DED3] hover:bg-[#F5F1E8] text-sm font-semibold text-[#252525] transition-colors whitespace-nowrap shrink-0"
            >
              Student Mode
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/teacher')}
              className="px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Teacher Mode
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-[#171717] text-white overflow-hidden">
        <div className="max-w-[1280px] mx-auto px-6 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <p className="text-sm font-semibold tracking-wide text-[#DFC58E]">
              Dual-Mode Assessment &amp; Study Platform
            </p>
            <h1 className="text-[clamp(2.35rem,4.2vw,3.75rem)] font-display font-bold leading-[1.08] tracking-tight text-balance">
              Turn lecture PDFs and study notes into graded exams in seconds.
            </h1>
            <p className="text-base lg:text-lg text-[#D6D0C4] leading-relaxed max-w-xl">
              ExamAI equips students with self-paced practice quizzes and equips teachers with official timed exams, randomized variants, tab-activity tracking, and descriptive rubric grading.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                type="button"
                onClick={() => onNavigate('/student')}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] font-semibold text-sm transition-colors whitespace-nowrap"
              >
                Open Student Mode
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/teacher')}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#303030] hover:bg-[#3D3D3D] border border-white/15 text-white font-semibold text-sm transition-colors whitespace-nowrap"
              >
                Open Teacher Mode
              </button>
            </div>
            <div className="pt-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-5 gap-y-1.5 text-xs text-[#B5B0A6]">
              <span>PDF &amp; DOCX Extraction</span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span>Groq JSON Question Engine</span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span>Server-Validated Timers</span>
            </div>
          </div>

          <div className="lg:col-span-6 flex items-stretch">
            <div className="w-full rounded-2xl overflow-hidden border border-[#303030] bg-[#303030] min-h-[300px] flex items-center justify-center relative">
              {!heroImgFailed ? (
                <img
                  src="/src/assets/images/hero_exampilot_desk_1795268295151.jpg"
                  alt="Student and educator preparing structured academic assessments on ExamAI"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="p-8 text-center space-y-3">
                  <GraduationCap className="w-12 h-12 text-[#C9A45C] mx-auto" />
                  <p className="font-display font-semibold text-lg text-white">ExamAI Assessment Studio</p>
                  <p className="text-sm text-[#D6D0C4]">
                    Upload PDF/DOCX materials, generate structured questions, and deliver timed exams.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Full-Width Key Capabilities Strip */}
        <div className="border-t border-[#303030] bg-[#303030]/55">
          <div className="max-w-[1280px] mx-auto px-6 py-6 grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <div className="font-mono text-2xl font-bold text-[#DFC58E] tabular-nums">4 Formats</div>
              <div className="text-xs text-[#D6D0C4] mt-1">MCQ, True/False, Short &amp; Long Answer</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold text-white tabular-nums">PDF + DOCX</div>
              <div className="text-xs text-[#D6D0C4] mt-1">Server-side text extraction up to 10 MB</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold text-[#C9A45C] tabular-nums">Auto + Manual</div>
              <div className="text-xs text-[#D6D0C4] mt-1">Instant MCQ grading &amp; descriptive rubrics</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold text-[#DFC58E] tabular-nums">Zero-Leak</div>
              <div className="text-xs text-[#D6D0C4] mt-1">Answer keys stripped during active exams</div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Feature Bento Grid */}
      <section id="features" className="max-w-[1280px] mx-auto px-6 py-20">
        <div className="max-w-2xl mb-12">
          <p className="text-sm font-semibold text-[#66543A] mb-2">Built for Real Academic Rigor</p>
          <h2 className="text-3xl lg:text-4xl font-display font-bold tracking-tight text-[#252525] text-balance">
            Everything needed from document upload to final gradebook feedback.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-7 bg-[#EFEBE2] border border-[#E3DED3] rounded-2xl p-8 flex flex-col justify-between">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#66543A] text-white flex items-center justify-center mb-5">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-display font-bold text-[#252525] mb-2">
                01. Grounded Document-to-Question Pipeline
              </h3>
              <p className="text-[#252525]/85 text-sm leading-relaxed">
                Upload lecture slides exported as PDF or course notes in DOCX. ExamAI extracts and previews the exact source text before sending it to Groq AI with strict JSON schema validation—never fabricating unseen content.
              </p>
            </div>
            <div className="mt-6 pt-5 border-t border-[#E3DED3] flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#66543A]">
              <span>Edit prompts inline</span>
              <span aria-hidden="true">·</span>
              <span>Adjust difficulty &amp; marks</span>
              <span aria-hidden="true">·</span>
              <span>Regenerate or add manually</span>
            </div>
          </div>

          <div className="md:col-span-5 bg-white border border-[#E3DED3] rounded-2xl p-8 flex flex-col justify-between">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#4476A8] text-white flex items-center justify-center mb-5">
                <Clock className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-display font-bold text-[#252525] mb-2">
                02. Distraction-Free Timed Exam Room
              </h3>
              <p className="text-[#77736C] text-sm leading-relaxed">
                Students take official exams inside a calm, clutter-free workspace with live server-verified countdowns, automatic answer persistence across refreshes, and explicit submission confirmation.
              </p>
            </div>
            <div className="mt-6 pt-5 border-t border-[#E3DED3] text-xs font-medium text-[#77736C]">
              Server blocks late answer edits after expiry
            </div>
          </div>

          <div className="md:col-span-5 bg-white border border-[#E3DED3] rounded-2xl p-8 flex flex-col justify-between">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#C64B4B] text-white flex items-center justify-center mb-5">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-display font-bold text-[#252525] mb-2">
                03. Practical Exam Integrity Controls
              </h3>
              <p className="text-[#77736C] text-sm leading-relaxed">
                Shuffle question sequences and MCQ options per attempt, strip answer keys from client payloads during active sessions, and log browser tab switches or focus-loss warnings without invasive camera access.
              </p>
            </div>
            <div className="mt-6 pt-5 border-t border-[#E3DED3] text-xs font-medium text-[#77736C]">
              Configurable per exam by the instructor
            </div>
          </div>

          <div className="md:col-span-7 bg-[#171717] text-white rounded-2xl p-8 flex flex-col justify-between">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#C9A45C] text-[#171717] flex items-center justify-center mb-5">
                <GraduationCap className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-display font-bold mb-2">
                04. Hybrid Objective Grading &amp; Descriptive Rubrics
              </h3>
              <p className="text-[#D6D0C4] text-sm leading-relaxed">
                Multiple-choice and True/False items grade instantaneously. Short and long descriptive responses enter the teacher evaluation queue alongside model answers and marking guidance for transparent feedback.
              </p>
            </div>
            <div className="mt-6 pt-5 border-t border-[#303030] flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#B5B0A6]">
              <span>Instant MCQ scoring</span>
              <span aria-hidden="true">·</span>
              <span>Per-question teacher marks</span>
              <span aria-hidden="true">·</span>
              <span>Pass/Fail analytics</span>
            </div>
          </div>
        </div>
      </section>

      {/* Dual Modes Section */}
      <section id="modes" className="bg-[#F5F1E8] border-y border-[#E3DED3] py-20">
        <div className="max-w-[1280px] mx-auto px-6">
          <div className="max-w-2xl mb-12">
            <p className="text-sm font-semibold text-[#66543A] mb-2">Two Dedicated Workspaces</p>
            <h2 className="text-3xl lg:text-4xl font-display font-bold tracking-tight text-[#252525] text-balance">
              Tailored experiences for self-study and classroom assessment.
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Student Study Mode */}
            <div className="bg-white border border-[#E3DED3] rounded-2xl p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#4476A8]/12 text-[#4476A8] flex items-center justify-center">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-[#252525]">Study Mode — Students</h3>
                    <p className="text-xs text-[#77736C]">Private study materials &amp; practice</p>
                  </div>
                </div>
              </div>

              <ul className="space-y-3 text-sm text-[#252525]/85">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#4476A8] shrink-0 mt-0.5" />
                  <span>Upload personal lecture PDFs and DOCX study guides</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#4476A8] shrink-0 mt-0.5" />
                  <span>Generate practice quizzes by topic and Easy, Medium, or Hard difficulty</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#4476A8] shrink-0 mt-0.5" />
                  <span>Attempt quizzes interactively and review explanations immediately</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#4476A8] shrink-0 mt-0.5" />
                  <span>Take official assigned exams and track score history over time</span>
                </li>
              </ul>

              <button
                type="button"
                onClick={() => onNavigate('/student')}
                className="w-full py-3 px-4 rounded-xl bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold transition-colors"
              >
                Start in Study Mode
              </button>
            </div>

            {/* Teacher Teaching Mode */}
            <div className="bg-white border border-[#E3DED3] rounded-2xl p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#C9A45C]/20 text-[#66543A] flex items-center justify-center">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-[#252525]">Teaching Mode — Teachers</h3>
                    <p className="text-xs text-[#77736C]">Question banks, official exams &amp; grading</p>
                  </div>
                </div>
              </div>

              <ul className="space-y-3 text-sm text-[#252525]/85">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#66543A] shrink-0 mt-0.5" />
                  <span>Build a reusable Question Bank from uploaded teaching materials</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#66543A] shrink-0 mt-0.5" />
                  <span>Compose official exams with custom durations, passing marks, and deadlines</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#66543A] shrink-0 mt-0.5" />
                  <span>Configure question/option randomization and tab-switch warnings</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#66543A] shrink-0 mt-0.5" />
                  <span>Evaluate descriptive answers with marks, rubrics, and written feedback</span>
                </li>
              </ul>

              <button
                type="button"
                onClick={() => onNavigate('/teacher')}
                className="w-full py-3 px-4 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors"
              >
                Start in Teaching Mode
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="workflow" className="max-w-[1280px] mx-auto px-6 py-20">
        <div className="max-w-2xl mb-12">
          <p className="text-sm font-semibold text-[#66543A] mb-2">How ExamAI Works</p>
          <h2 className="text-3xl lg:text-4xl font-display font-bold tracking-tight text-[#252525] text-balance">
            Three structured steps from raw syllabus to verified scores.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-7 rounded-2xl border border-[#E3DED3] bg-white space-y-3">
            <span className="font-mono text-sm font-bold text-[#66543A]">Step 01</span>
            <h3 className="text-lg font-display font-bold text-[#252525]">Upload PDF or DOCX</h3>
            <p className="text-sm text-[#77736C] leading-relaxed">
              The backend validates file size and format, extracts clean prose via PDF/Word parsers, and lets you inspect the extracted source text immediately.
            </p>
          </div>
          <div className="p-7 rounded-2xl border border-[#E3DED3] bg-white space-y-3">
            <span className="font-mono text-sm font-bold text-[#4476A8]">Step 02</span>
            <h3 className="text-lg font-display font-bold text-[#252525]">Generate &amp; Refine</h3>
            <p className="text-sm text-[#77736C] leading-relaxed">
              Choose difficulty, topic, and question type. Groq generates structured JSON questions that you can edit, delete, or supplement manually before saving.
            </p>
          </div>
          <div className="p-7 rounded-2xl border border-[#E3DED3] bg-white space-y-3">
            <span className="font-mono text-sm font-bold text-[#25845D]">Step 03</span>
            <h3 className="text-lg font-display font-bold text-[#252525]">Deliver &amp; Evaluate</h3>
            <p className="text-sm text-[#77736C] leading-relaxed">
              Students complete timed assessments with auto-saved progress. Objective items score immediately while descriptive essays route to teacher evaluation.
            </p>
          </div>
        </div>
      </section>

      {/* Interactive Document-to-Quiz Showcase */}
      <section id="showcase" className="bg-[#171717] text-white py-20">
        <div className="max-w-[1280px] mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5 space-y-5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#DFC58E]">
              <Sparkles className="w-4 h-4" />
              <span>AI Document-to-Quiz Showcase</span>
            </div>
            <h2 className="text-3xl font-display font-bold tracking-tight text-balance">
              Inspect every stage of the question generation pipeline.
            </h2>
            <p className="text-sm text-[#D6D0C4] leading-relaxed">
              Switch tabs to preview how a real uploaded database lecture transforms from extracted prose into a structured MCQ item or a teacher-ready marking rubric.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPreviewTab('extract')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  previewTab === 'extract'
                    ? 'bg-[#C9A45C] text-[#171717]'
                    : 'bg-[#303030] text-[#D6D0C4] hover:bg-[#3D3D3D]'
                }`}
              >
                01. Extracted Text
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab('mcq')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  previewTab === 'mcq'
                    ? 'bg-[#C9A45C] text-[#171717]'
                    : 'bg-[#303030] text-[#D6D0C4] hover:bg-[#3D3D3D]'
                }`}
              >
                02. Generated MCQ
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab('rubric')}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  previewTab === 'rubric'
                    ? 'bg-[#C9A45C] text-[#171717]'
                    : 'bg-[#303030] text-[#D6D0C4] hover:bg-[#3D3D3D]'
                }`}
              >
                03. Descriptive Rubric
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 bg-[#303030] border border-white/10 rounded-2xl p-6 lg:p-8 min-h-[280px]">
            {previewTab === 'extract' && (
              <div className="space-y-3">
                <div className="text-xs font-mono text-[#DFC58E]">
                  Database_Normalization_Lecture.pdf · 138 words extracted
                </div>
                <p className="text-sm text-[#F5F1E8] leading-relaxed">
                  &ldquo;Second Normal Form (2NF) requires 1NF plus the elimination of partial dependencies: every non-key attribute must be functionally dependent on the entire primary key. Third Normal Form (3NF) requires 2NF plus the elimination of transitive dependencies: no non-key attribute may depend on another non-key attribute.&rdquo;
                </p>
              </div>
            )}

            {previewTab === 'mcq' && (
              <div className="space-y-4">
                <div className="text-xs font-mono text-[#DFC58E]">MCQ · Medium · 2 Marks</div>
                <p className="text-base font-semibold text-white">
                  A table with composite primary key (StudentID, CourseID) stores CourseTitle, which depends solely on CourseID. Which normal form does this violate?
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm">
                  <div className="p-3 rounded-lg bg-[#C9A45C]/20 border border-[#C9A45C] text-white font-medium">
                    A. Second Normal Form (2NF) — Correct
                  </div>
                  <div className="p-3 rounded-lg bg-[#171717]/60 border border-white/10 text-[#D6D0C4]">
                    B. First Normal Form (1NF)
                  </div>
                  <div className="p-3 rounded-lg bg-[#171717]/60 border border-white/10 text-[#D6D0C4]">
                    C. Fourth Normal Form (4NF)
                  </div>
                  <div className="p-3 rounded-lg bg-[#171717]/60 border border-white/10 text-[#D6D0C4]">
                    D. Referential Integrity
                  </div>
                </div>
                <p className="text-xs text-[#B5B0A6]">
                  Explanation: CourseTitle partially depends on part of the composite key rather than the full key.
                </p>
              </div>
            )}

            {previewTab === 'rubric' && (
              <div className="space-y-4">
                <div className="text-xs font-mono text-[#DFC58E]">Short Answer · Hard · 5 Marks</div>
                <p className="text-base font-semibold text-white">
                  Briefly explain how unnormalized tables lead to update anomalies, using a short example.
                </p>
                <div className="p-4 rounded-xl bg-[#171717]/60 border border-white/10 space-y-2 text-xs text-[#D6D0C4]">
                  <p>
                    <strong className="text-white">Suggested Answer:</strong> Duplicating an instructor&apos;s office number across multiple enrollment rows creates inconsistent data if updated in one row only.
                  </p>
                  <p>
                    <strong className="text-white">Marking Guidance:</strong> Award 2 marks for defining partial/duplicated state inconsistency and 3 marks for a concrete example.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Clearly Labeled Sample Testimonials */}
      <section className="max-w-[1280px] mx-auto px-6 py-20">
        <div className="mb-10">
          <p className="text-sm font-semibold text-[#66543A] mb-2">Sample User Stories (Illustrative Demo Examples)</p>
          <h2 className="text-3xl font-display font-bold tracking-tight text-[#252525]">
            How students and instructors structure their workflows.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SAMPLE_TESTIMONIALS.map((t) => (
            <div key={t.name} className="p-7 rounded-2xl bg-[#F5F1E8] border border-[#E3DED3] space-y-4">
              <p className="text-sm text-[#252525] leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
              <div className="pt-3 border-t border-[#E3DED3]">
                <div className="text-sm font-bold text-[#252525]">{t.name}</div>
                <div className="text-xs text-[#77736C]">{t.role}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="bg-[#F5F1E8] border-t border-[#E3DED3] py-20">
        <div className="max-w-[900px] mx-auto px-6">
          <div className="mb-10">
            <p className="text-sm font-semibold text-[#66543A] mb-2">Frequently Asked Questions</p>
            <h2 className="text-3xl font-display font-bold tracking-tight text-[#252525]">Technical &amp; Academic Clarity</h2>
          </div>

          <div className="space-y-3">
            {FAQS.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q} className="bg-white border border-[#E3DED3] rounded-xl overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left font-semibold text-sm text-[#252525] hover:bg-[#EFEBE2]/50 transition-colors"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#77736C] shrink-0 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 text-sm text-[#77736C] leading-relaxed border-t border-[#E3DED3] pt-4">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="bg-[#171717] text-[#D6D0C4] py-12">
        <div className="max-w-[1280px] mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <BrandMark variant="dark" size="sm" />
            <p className="text-xs text-[#B5B0A6] mt-2">
              AI Study &amp; Examination Platform · Persistent Cloud &amp; Local Storage
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs font-medium">
            <button type="button" onClick={() => onNavigate('/student')} className="hover:text-white transition-colors">
              Student Mode
            </button>
            <button type="button" onClick={() => onNavigate('/teacher')} className="hover:text-white transition-colors">
              Teacher Mode
            </button>
            <a href="#features" className="hover:text-white transition-colors">
              Features
            </a>
            <a href="#faq" className="hover:text-white transition-colors">
              FAQ
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
