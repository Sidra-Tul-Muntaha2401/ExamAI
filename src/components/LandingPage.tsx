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
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/index';
import { BrandMark } from './BrandMark';

function getWorkspacePath(role: UserRole): string {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  return '/student';
}

interface LandingPageProps {
  onNavigate: (path: string) => void;
}

const FAQS = [
  {
    q: 'Which course document formats are supported?',
    a: 'Students and instructors can upload text-based PDF (.pdf) and Microsoft Word (.docx) files up to 10 MB. ExamAI previews the extracted text before question generation and clearly alerts you if a scanned image-only PDF has no selectable text.',
  },
  {
    q: 'How are questions generated from uploaded lecture notes?',
    a: 'ExamAI analyzes your extracted reading material and drafts structured Multiple Choice, True/False, Short Answer, and Long Answer items—alongside explanations and marking guidance—for you to edit or approve before saving.',
  },
  {
    q: 'What integrity safeguards are included for formal examinations?',
    a: 'Instructors can randomize question order and choice sequences per student, enforce strict exam durations and submission deadlines, keep answer keys hidden until grading, and log browser tab-leave events without requiring webcam or microphone access.',
  },
  {
    q: 'Are student practice sets separated from official course exams?',
    a: 'Yes. Personal study documents and practice quizzes remain private to each student account, while official course rosters, question banks, timed examinations, and grading rubrics are managed exclusively by verified faculty.',
  },
];

const INSTITUTIONAL_ROLES = [
  {
    title: 'For Students',
    subtitle: 'Independent study & course readiness',
    description:
      'Enroll in courses via class codes, convert personal lecture notes into targeted practice sets, review detailed explanations, and track assessment scores across terms.',
  },
  {
    title: 'For Faculty & Instructors',
    subtitle: 'Question banks & guided evaluation',
    description:
      'Organize class rosters, author exams directly from course readings, configure time limits and randomization rules, and grade written essays using structured rubrics.',
  },
  {
    title: 'For Academic Administrators',
    subtitle: 'Verification & institutional governance',
    description:
      'Review and approve instructor credentials before exam publishing, manage enrollment policies and integrity defaults, and oversee institutional activity logs.',
  },
];

export function LandingPage({ onNavigate }: LandingPageProps) {
  const { user, logout } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [previewTab, setPreviewTab] = useState<'extract' | 'mcq' | 'rubric'>('mcq');
  const dashboardPath = user ? getWorkspacePath(user.role) : '/login';

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#252525]">
      {/* 3-Zone Top Bar */}
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
              Capabilities
            </a>
            <a href="#modes" className="hover:text-[#252525] transition-colors whitespace-nowrap shrink-0">
              Workspaces
            </a>
            <a href="#workflow" className="hover:text-[#252525] transition-colors whitespace-nowrap shrink-0">
              Workflow
            </a>
            <a href="#showcase" className="hover:text-[#252525] transition-colors whitespace-nowrap shrink-0">
              Preview
            </a>
            <a href="#faq" className="hover:text-[#252525] transition-colors whitespace-nowrap shrink-0">
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('/practice')}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-[#66543A] hover:bg-[#F5F1E8] transition-colors whitespace-nowrap shrink-0"
            >
              Practice
            </button>
            {user ? (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate(dashboardPath)}
                  className="px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await logout();
                    onNavigate('/login');
                  }}
                  className="px-3.5 py-2 rounded-lg border border-[#E3DED3] hover:bg-[#F5F1E8] text-sm font-semibold text-[#252525] transition-colors whitespace-nowrap shrink-0"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate('/login')}
                  className="px-3.5 py-2 rounded-lg border border-[#E3DED3] hover:bg-[#F5F1E8] text-sm font-semibold text-[#252525] transition-colors whitespace-nowrap shrink-0"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/register')}
                  className="px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
                >
                  Get Started
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-[#171717] text-white overflow-hidden">
        <div className="max-w-[1280px] mx-auto px-6 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <p className="text-sm font-semibold tracking-wide text-[#DFC58E]">
              Academic Study &amp; Examination Suite
            </p>
            <h1 className="text-[clamp(2.35rem,4.2vw,3.75rem)] font-display font-bold leading-[1.08] tracking-tight text-balance">
              Thoughtful assessments built from your own course materials.
            </h1>
            <p className="text-base lg:text-lg text-[#D6D0C4] leading-relaxed max-w-xl">
              Upload lecture notes, syllabi, or study guides to create structured practice sets and formal timed exams—with instant objective scoring and faculty grading rubrics.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {user ? (
                <button
                  type="button"
                  onClick={() => onNavigate(dashboardPath)}
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] font-semibold text-sm transition-colors whitespace-nowrap"
                >
                  Open {user.role === 'admin' ? 'Admin Console' : user.role === 'teacher' ? 'Faculty Workspace' : 'Student Workspace'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigate('/register')}
                    className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] font-semibold text-sm transition-colors whitespace-nowrap"
                  >
                    Create Account
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('/login')}
                    className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#303030] hover:bg-[#3D3D3D] border border-white/15 text-white font-semibold text-sm transition-colors whitespace-nowrap"
                  >
                    Sign In
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onNavigate('/practice')}
                className="inline-flex items-center gap-2 px-5 py-3.5 rounded-xl border border-white/15 hover:bg-white/10 text-[#DFC58E] font-semibold text-sm transition-colors whitespace-nowrap"
              >
                Try Guest Practice
              </button>
            </div>
            <div className="pt-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-5 gap-y-1.5 text-xs text-[#B5B0A6]">
              <span>Course Document Upload</span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span>Four Question Formats</span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span>Guided Faculty Grading</span>
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
                  <p className="font-display font-semibold text-lg text-white">ExamAI Academic Studio</p>
                  <p className="text-sm text-[#D6D0C4]">
                    Prepare course materials, author structured exams, and evaluate student responses in one workspace.
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
              <div className="text-xs text-[#D6D0C4] mt-1">Multiple Choice, True/False, Short &amp; Long Answer</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold text-white tabular-nums">PDF + Word</div>
              <div className="text-xs text-[#D6D0C4] mt-1">Direct import from syllabi, slides, and notes</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold text-[#C9A45C] tabular-nums">Hybrid Grading</div>
              <div className="text-xs text-[#D6D0C4] mt-1">Instant objective scoring with faculty essay review</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold text-[#DFC58E] tabular-nums">Protected Keys</div>
              <div className="text-xs text-[#D6D0C4] mt-1">Answer keys remain hidden throughout active exams</div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Feature Bento Grid */}
      <section id="features" className="max-w-[1280px] mx-auto px-6 py-20">
        <div className="max-w-2xl mb-12">
          <p className="text-sm font-semibold text-[#66543A] mb-2">Academic Rigor by Design</p>
          <h2 className="text-3xl lg:text-4xl font-display font-bold tracking-tight text-[#252525] text-balance">
            From course readings to verified gradebooks in one unified platform.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-7 bg-[#EFEBE2] border border-[#E3DED3] rounded-2xl p-8 flex flex-col justify-between">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#66543A] text-white flex items-center justify-center mb-5">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-display font-bold text-[#252525] mb-2">
                01. Material-Grounded Question Authoring
              </h3>
              <p className="text-[#252525]/85 text-sm leading-relaxed">
                Upload lecture slides in PDF or course notes in Word format. Inspect the extracted source text and generate draft questions strictly anchored to your curriculum before adding them to an exam or study set.
              </p>
            </div>
            <div className="mt-6 pt-5 border-t border-[#E3DED3] flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#66543A]">
              <span>Edit wording inline</span>
              <span aria-hidden="true">·</span>
              <span>Adjust marks &amp; difficulty</span>
              <span aria-hidden="true">·</span>
              <span>Add custom questions</span>
            </div>
          </div>

          <div className="md:col-span-5 bg-white border border-[#E3DED3] rounded-2xl p-8 flex flex-col justify-between">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#4476A8] text-white flex items-center justify-center mb-5">
                <Clock className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-display font-bold text-[#252525] mb-2">
                02. Focused, Timed Examination Rooms
              </h3>
              <p className="text-[#77736C] text-sm leading-relaxed">
                Students complete formal assessments inside a calm, distraction-free workspace with live countdown timers, automatic answer saving across page refreshes, and clear submission confirmation.
              </p>
            </div>
            <div className="mt-6 pt-5 border-t border-[#E3DED3] text-xs font-medium text-[#77736C]">
              Enforces time limits and closing deadlines automatically
            </div>
          </div>

          <div className="md:col-span-5 bg-white border border-[#E3DED3] rounded-2xl p-8 flex flex-col justify-between">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#C64B4B] text-white flex items-center justify-center mb-5">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-display font-bold text-[#252525] mb-2">
                03. Practical Assessment Integrity
              </h3>
              <p className="text-[#77736C] text-sm leading-relaxed">
                Randomize question order and multiple-choice options per student, keep answer keys strictly off student devices during active sessions, and record tab-leave notices without invasive camera access.
              </p>
            </div>
            <div className="mt-6 pt-5 border-t border-[#E3DED3] text-xs font-medium text-[#77736C]">
              Configured individually per exam by the instructor
            </div>
          </div>

          <div className="md:col-span-7 bg-[#171717] text-white rounded-2xl p-8 flex flex-col justify-between">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#C9A45C] text-[#171717] flex items-center justify-center mb-5">
                <GraduationCap className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-display font-bold mb-2">
                04. Instant Objective Scoring &amp; Written Rubrics
              </h3>
              <p className="text-[#D6D0C4] text-sm leading-relaxed">
                Multiple-choice and True/False items grade immediately upon submission. Short and long written responses route directly to the faculty grading queue alongside reference answers and marking guides.
              </p>
            </div>
            <div className="mt-6 pt-5 border-t border-[#303030] flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#B5B0A6]">
              <span>Instant MCQ scoring</span>
              <span aria-hidden="true">·</span>
              <span>Per-question faculty marks</span>
              <span aria-hidden="true">·</span>
              <span>Cohort score analytics</span>
            </div>
          </div>
        </div>
      </section>

      {/* Dual Modes Section */}
      <section id="modes" className="bg-[#F5F1E8] border-y border-[#E3DED3] py-20">
        <div className="max-w-[1280px] mx-auto px-6">
          <div className="max-w-2xl mb-12">
            <p className="text-sm font-semibold text-[#66543A] mb-2">Dedicated Workspaces</p>
            <h2 className="text-3xl lg:text-4xl font-display font-bold tracking-tight text-[#252525] text-balance">
              Purpose-built for independent study and formal instruction.
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Student Workspace */}
            <div className="bg-white border border-[#E3DED3] rounded-2xl p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#4476A8]/12 text-[#4476A8] flex items-center justify-center">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-[#252525]">Student Workspace</h3>
                    <p className="text-xs text-[#77736C]">Course enrollments, practice &amp; results</p>
                  </div>
                </div>
              </div>

              <ul className="space-y-3 text-sm text-[#252525]/85">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#4476A8] shrink-0 mt-0.5" />
                  <span>Join active courses using instructor enrollment codes</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#4476A8] shrink-0 mt-0.5" />
                  <span>Generate private practice quizzes by topic and difficulty level</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#4476A8] shrink-0 mt-0.5" />
                  <span>Review answer explanations immediately after each practice session</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#4476A8] shrink-0 mt-0.5" />
                  <span>Complete assigned exams and monitor score progression over time</span>
                </li>
              </ul>

              <button
                type="button"
                onClick={() => onNavigate(user?.role === 'student' ? '/student' : '/register')}
                className="w-full py-3 px-4 rounded-xl bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold transition-colors"
              >
                {user?.role === 'student' ? 'Open Student Workspace' : 'Register as Student'}
              </button>
            </div>

            {/* Faculty Workspace */}
            <div className="bg-white border border-[#E3DED3] rounded-2xl p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#C9A45C]/20 text-[#66543A] flex items-center justify-center">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-[#252525]">Faculty Workspace</h3>
                    <p className="text-xs text-[#77736C]">Question banks, timed exams &amp; rubrics</p>
                  </div>
                </div>
              </div>

              <ul className="space-y-3 text-sm text-[#252525]/85">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#66543A] shrink-0 mt-0.5" />
                  <span>Curate reusable Question Banks from course documents</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#66543A] shrink-0 mt-0.5" />
                  <span>Publish formal exams with durations, passing thresholds, and deadlines</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#66543A] shrink-0 mt-0.5" />
                  <span>Configure question shuffling, option order, and integrity notices</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#66543A] shrink-0 mt-0.5" />
                  <span>Evaluate descriptive essays with rubric guidance and written feedback</span>
                </li>
              </ul>

              <button
                type="button"
                onClick={() => onNavigate(user?.role === 'teacher' ? '/teacher' : '/register')}
                className="w-full py-3 px-4 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors"
              >
                {user?.role === 'teacher' ? 'Open Faculty Workspace' : 'Register as Instructor'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="workflow" className="max-w-[1280px] mx-auto px-6 py-20">
        <div className="max-w-2xl mb-12">
          <p className="text-sm font-semibold text-[#66543A] mb-2">Streamlined Workflow</p>
          <h2 className="text-3xl lg:text-4xl font-display font-bold tracking-tight text-[#252525] text-balance">
            Three steps from syllabus notes to finalized grades.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-7 rounded-2xl border border-[#E3DED3] bg-white space-y-3">
            <span className="font-mono text-sm font-bold text-[#66543A]">Step 01</span>
            <h3 className="text-lg font-display font-bold text-[#252525]">Import Course Materials</h3>
            <p className="text-sm text-[#77736C] leading-relaxed">
              Upload text-based PDF or Word documents and inspect the extracted syllabus prose directly before generating questions.
            </p>
          </div>
          <div className="p-7 rounded-2xl border border-[#E3DED3] bg-white space-y-3">
            <span className="font-mono text-sm font-bold text-[#4476A8]">Step 02</span>
            <h3 className="text-lg font-display font-bold text-[#252525]">Compose &amp; Refine</h3>
            <p className="text-sm text-[#77736C] leading-relaxed">
              Select topic focus, difficulty level, and question formats, then edit wording, point values, and marking guides as needed.
            </p>
          </div>
          <div className="p-7 rounded-2xl border border-[#E3DED3] bg-white space-y-3">
            <span className="font-mono text-sm font-bold text-[#25845D]">Step 03</span>
            <h3 className="text-lg font-display font-bold text-[#252525]">Deliver &amp; Evaluate</h3>
            <p className="text-sm text-[#77736C] leading-relaxed">
              Assign exams to classes with timed windows and auto-saved progress. Objective items grade instantly while essays enter faculty review.
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
              <span>Interactive Workflow Preview</span>
            </div>
            <h2 className="text-3xl font-display font-bold tracking-tight text-balance">
              See how lecture readings become ready-to-grade questions.
            </h2>
            <p className="text-sm text-[#D6D0C4] leading-relaxed">
              Switch tabs to inspect how an uploaded database systems lecture progresses from source prose into a structured multiple-choice item or a faculty grading rubric.
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
                01. Source Reading
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
                02. Multiple Choice
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
                03. Grading Rubric
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

      {/* Institutional Role Clarity */}
      <section className="max-w-[1280px] mx-auto px-6 py-20">
        <div className="max-w-2xl mb-10">
          <p className="text-sm font-semibold text-[#66543A] mb-2">Role-Based Academic Structure</p>
          <h2 className="text-3xl font-display font-bold tracking-tight text-[#252525] text-balance">
            Clear responsibilities for students, faculty, and administrators.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {INSTITUTIONAL_ROLES.map((item) => (
            <div key={item.title} className="p-7 rounded-2xl bg-[#F5F1E8] border border-[#E3DED3] flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-[#66543A]">{item.subtitle}</div>
                <h3 className="text-lg font-display font-bold text-[#252525]">{item.title}</h3>
                <p className="text-sm text-[#252525]/85 leading-relaxed">{item.description}</p>
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
            <h2 className="text-3xl font-display font-bold tracking-tight text-[#252525]">Academic &amp; Platform Clarity</h2>
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
              ExamAI · Academic Study &amp; Assessment Platform
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs font-medium">
            <button type="button" onClick={() => onNavigate('/practice')} className="hover:text-white transition-colors">
              Practice
            </button>
            <button type="button" onClick={() => onNavigate('/login')} className="hover:text-white transition-colors">
              Sign In
            </button>
            <button type="button" onClick={() => onNavigate('/register')} className="hover:text-white transition-colors">
              Register
            </button>
            <a href="#features" className="hover:text-white transition-colors">
              Capabilities
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
