import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Lock,
  Maximize2,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../lib/api';
import type { ExamAttemptSession } from '../types/index';

interface ExamRoomProps {
  examId: string;
  onNavigate: (path: string) => void;
}

function formatTimer(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function ExamRoom({ examId, onNavigate }: ExamRoomProps) {
  const [session, setSession] = useState<ExamAttemptSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  const [showInstructions, setShowInstructions] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [lockdownEntered, setLockdownEntered] = useState(false);
  const [fullscreenUnavailable, setFullscreenUnavailable] = useState(false);
  const [lockdownPausedReason, setLockdownPausedReason] = useState<string | null>(null);
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);
  const [acknowledgingWarning, setAcknowledgingWarning] = useState(false);
  const [tabWarning, setTabWarning] = useState<string | null>(null);
  const [tabSwitches, setTabSwitches] = useState(0);

  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autoSubmittedRef = useRef(false);
  const suppressFocusEventsUntilRef = useRef(0);
  const lastThrottleRef = useRef<Record<string, number>>({});
  const answersRef = useRef<Record<string, string>>({});
  answersRef.current = answers;

  const exitFullscreenSafely = useCallback(() => {
    try {
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    } catch {
      // Ignore fullscreen exit errors
    }
  }, []);

  useEffect(() => {
    let active = true;
    const initExam = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<{
          alreadySubmitted?: boolean;
          attemptId?: string;
          session?: ExamAttemptSession;
        }>(`/api/exams/${examId}/take`);

        if (!active) return;

        if (res.alreadySubmitted && res.attemptId) {
          onNavigate(`/results/${res.attemptId}`);
          return;
        }

        if (res.session) {
          setSession(res.session);
          setAnswers(res.session.savedAnswers || {});
          setRemainingSeconds(res.session.remainingSeconds);
          setTabSwitches(res.session.tabSwitchCount);
          if (!res.session.exam.requireFullscreen) {
            setLockdownEntered(true);
          }
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to start exam.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void initExam();
    return () => {
      active = false;
      Object.values(saveTimersRef.current).forEach(clearTimeout);
    };
  }, [examId, onNavigate]);

  const submitExam = useCallback(async () => {
    if (!session || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; attemptId: string }>(
        `/api/exams/attempts/${session.attemptId}/submit`,
        { answers: answersRef.current }
      );
      exitFullscreenSafely();
      onNavigate(`/results/${res.attemptId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit exam.');
      setSubmitting(false);
    }
  }, [session, submitting, onNavigate, exitFullscreenSafely]);

  const recordSecurityEvent = useCallback(
    async (
      eventType:
        | 'tab_hidden'
        | 'tab_visible'
        | 'window_blur'
        | 'fullscreen_exited'
        | 'copy_attempt_blocked'
        | 'paste_attempt_blocked'
        | 'context_menu_blocked'
        | 'shortcut_blocked'
        | 'warning_acknowledged',
      details: string
    ) => {
      if (!session || autoSubmittedRef.current) return;
      const now = Date.now();
      const last = lastThrottleRef.current[eventType] || 0;
      if (
        eventType !== 'tab_hidden' &&
        eventType !== 'tab_visible' &&
        eventType !== 'warning_acknowledged' &&
        now - last < 500
      ) {
        return;
      }
      lastThrottleRef.current[eventType] = now;

      try {
        const res = await api.post<{
          ok?: boolean;
          tabSwitchCount?: number;
          focusLossCount?: number;
          autoSubmitted?: boolean;
          attemptId?: string;
        }>(`/api/exams/attempts/${session.attemptId}/activity`, { eventType, details });

        if (typeof res.tabSwitchCount === 'number') {
          setTabSwitches(res.tabSwitchCount);
        }
        if (res.autoSubmitted) {
          autoSubmittedRef.current = true;
          setLockdownPausedReason(null);
          exitFullscreenSafely();
          onNavigate(`/results/${res.attemptId || session.attemptId}`);
        }
      } catch {
        // Non-blocking integrity log
      }
    },
    [session, onNavigate, exitFullscreenSafely]
  );

  const handleEnterExamLockdown = useCallback(async () => {
    suppressFocusEventsUntilRef.current = Date.now() + 600;
    if (session?.exam.requireFullscreen && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
        setFullscreenUnavailable(false);
      } catch {
        setFullscreenUnavailable(true);
      }
    } else if (session?.exam.requireFullscreen) {
      setFullscreenUnavailable(true);
    }
    setLockdownEntered(true);
    setLockdownPausedReason(null);
  }, [session]);

  const handleResumeFromLockout = useCallback(async () => {
    if (!warningAcknowledged || acknowledgingWarning) return;
    setAcknowledgingWarning(true);
    suppressFocusEventsUntilRef.current = Date.now() + 600;
    try {
      await recordSecurityEvent(
        'warning_acknowledged',
        'Student acknowledged tab-switch / security warning before resuming'
      );
      if (session?.exam.requireFullscreen && !fullscreenUnavailable && !document.fullscreenElement) {
        try {
          await document.documentElement.requestFullscreen?.();
        } catch {
          setFullscreenUnavailable(true);
        }
      }
      setLockdownPausedReason(null);
      setWarningAcknowledged(false);
    } finally {
      setAcknowledgingWarning(false);
    }
  }, [session, fullscreenUnavailable, warningAcknowledged, acknowledgingWarning, recordSecurityEvent]);

  // Countdown timer synced to initial server remainingSeconds
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (!autoSubmittedRef.current) {
            autoSubmittedRef.current = true;
            void submitExam();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [session, submitExam]);

  // Anti-cheat tab visibility, focus-loss, and fullscreen enforcement
  useEffect(() => {
    if (!session || !lockdownEntered || (!session.exam.trackTabSwitches && !session.exam.warnOnTabLeave)) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void recordSecurityEvent('tab_hidden', 'Student switched away from exam tab');
        setWarningAcknowledged(false);
        setLockdownPausedReason(
          'Tab switch detected. Exam questions are hidden and this event has been recorded. Acknowledge the warning below to resume.'
        );
        if (session.exam.warnOnTabLeave) {
          setTabWarning(
            'Tab leave detected and recorded in your exam integrity log. Stay on this screen until submission.'
          );
        }
      } else {
        void recordSecurityEvent('tab_visible', 'Student returned to exam tab');
      }
    };

    const handleBlur = () => {
      if (Date.now() < suppressFocusEventsUntilRef.current || submitting || autoSubmittedRef.current) {
        return;
      }
      void recordSecurityEvent('window_blur', 'Exam window lost focus');
      setWarningAcknowledged(false);
      setLockdownPausedReason(
        'Window focus lost. Exam questions are concealed until you acknowledge this warning and return focus to the exam screen.'
      );
      if (session.exam.warnOnTabLeave) {
        setTabWarning('Focus loss detected and logged. External windows and AI tools are prohibited.');
      }
    };

    const handleFullscreenChange = () => {
      if (
        !session.exam.requireFullscreen ||
        fullscreenUnavailable ||
        document.visibilityState === 'hidden' ||
        Date.now() < suppressFocusEventsUntilRef.current ||
        submitting ||
        autoSubmittedRef.current
      ) {
        return;
      }
      if (!document.fullscreenElement) {
        void recordSecurityEvent('fullscreen_exited', 'Student exited fullscreen exam mode');
        setWarningAcknowledged(false);
        setLockdownPausedReason(
          'Fullscreen mode was exited. Acknowledge this warning and re-enter fullscreen mode to continue.'
        );
        if (session.exam.warnOnTabLeave) {
          setTabWarning('Exiting fullscreen during an active exam is recorded as a lockdown violation.');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [session, lockdownEntered, fullscreenUnavailable, submitting, recordSecurityEvent]);

  // Clipboard, right-click, drag, and shortcut blocking
  useEffect(() => {
    if (!session || !lockdownEntered || !session.exam.blockCopyPaste) return;

    const handleCopyOrCut = (e: ClipboardEvent) => {
      e.preventDefault();
      setTabWarning('Copying or cutting exam content is disabled during the examination.');
      void recordSecurityEvent('copy_attempt_blocked', `Blocked ${e.type} attempt`);
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      setTabWarning('Pasting external text is disabled during the examination.');
      void recordSecurityEvent('paste_attempt_blocked', 'Blocked paste attempt');
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setTabWarning('Right-click context menu is disabled during the examination.');
      void recordSecurityEvent('context_menu_blocked', 'Blocked context menu');
    };

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      const blockedDevTools =
        e.key === 'F12' || (ctrlOrMeta && e.shiftKey && (key === 'i' || key === 'j' || key === 'c'));
      const blockedShortcut =
        ctrlOrMeta && ['c', 'v', 'x', 'u', 'f', 'p', 's', 't', 'n', 'w'].includes(key);

      if (blockedDevTools || blockedShortcut) {
        e.preventDefault();
        setTabWarning(`Keyboard shortcut (${e.key.toUpperCase()}) is disabled during the examination.`);
        void recordSecurityEvent('shortcut_blocked', `Blocked shortcut: ${ctrlOrMeta ? 'Mod+' : ''}${e.key}`);
      }
    };

    document.addEventListener('copy', handleCopyOrCut);
    document.addEventListener('cut', handleCopyOrCut);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('dragstart', handleDragStart);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener('copy', handleCopyOrCut);
      document.removeEventListener('cut', handleCopyOrCut);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('dragstart', handleDragStart);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [session, lockdownEntered, recordSecurityEvent]);

  const persistAnswer = useCallback(
    async (questionId: string, value: string) => {
      if (!session) return;
      setSavingState('saving');
      setSaveErrorMsg(null);
      try {
        await api.patch(`/api/exams/attempts/${session.attemptId}/answer`, {
          questionId,
          answer: value,
        });
        setSavingState('saved');
      } catch (err) {
        setSavingState('error');
        setSaveErrorMsg(err instanceof Error ? err.message : 'Unable to save answer.');
      }
    },
    [session]
  );

  const handleAnswerChange = (questionId: string, value: string, immediate: boolean) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    if (saveTimersRef.current[questionId]) {
      clearTimeout(saveTimersRef.current[questionId]);
    }
    if (immediate) {
      void persistAnswer(questionId, value);
    } else {
      setSavingState('saving');
      saveTimersRef.current[questionId] = setTimeout(() => {
        void persistAnswer(questionId, value);
      }, 450);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F1E8] flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-7 h-7 text-[#66543A] animate-spin" />
        <p className="text-sm text-[#77736C]">Preparing secured examination environment...</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-[#F5F1E8] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-[#E3DED3] rounded-2xl p-6 space-y-4">
          <div className="flex items-start gap-2.5 text-[#C64B4B] font-semibold text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{error || 'Unable to load examination.'}</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/student')}
            className="px-4 py-2 rounded-lg bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold transition-colors"
          >
            Return to Student Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Pre-Exam Lockdown Gate (shown before revealing questions when requireFullscreen is active)
  if (!lockdownEntered) {
    return (
      <div className="min-h-screen bg-[#F5F1E8] text-[#252525] flex items-center justify-center p-6">
        <div className="max-w-xl w-full bg-white border border-[#E3DED3] rounded-2xl p-8 space-y-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EFEBE2] text-[#66543A] flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-[#252525]">{session.exam.title}</h1>
              <p className="text-xs text-[#77736C] mt-0.5 tabular-nums">
                {session.exam.subject} · {session.exam.durationMinutes} min · {session.questions.length} questions ·{' '}
                {session.exam.totalMarks} marks
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#EFEBE2]/65 border border-[#E3DED3] space-y-2.5 text-sm text-[#252525]">
            <div className="font-semibold text-[#252525]">Exam Security Rules</div>
            <ul className="space-y-1.5 text-xs text-[#77736C] list-disc pl-5">
              <li>ExamAI Study Mode, AI question generation, and uploaded notes are locked on the server until you submit.</li>
              {session.exam.requireFullscreen && (
                <li>Fullscreen exam mode is required. Exiting fullscreen hides questions and logs a violation.</li>
              )}
              {session.exam.trackTabSwitches && (
                <li>
                  Switching browser tabs or losing window focus immediately conceals questions and records an event
                  {session.exam.maxTabSwitches > 0
                    ? ` (auto-submits after ${session.exam.maxTabSwitches} violations).`
                    : '.'}
                </li>
              )}
              {session.exam.blockCopyPaste && (
                <li>Copy, cut, paste, right-click, and browser shortcuts are disabled during the exam.</li>
              )}
              <li>Browser monitoring logs visibility and focus events without accessing cameras or microphones.</li>
            </ul>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('/student')}
              className="px-4 py-2.5 rounded-lg border border-[#E3DED3] text-xs font-semibold text-[#77736C] hover:text-[#252525] hover:bg-[#EFEBE2]/60"
            >
              Return to Dashboard
            </button>
            <button
              type="button"
              onClick={handleEnterExamLockdown}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors"
            >
              <Maximize2 className="w-4 h-4" />
              Enter Fullscreen &amp; Start Exam
            </button>
          </div>
        </div>
      </div>
    );
  }

  const questions = session.questions;
  const activeQ = questions[currentIdx];
  const answeredCount = questions.filter((q) => (answers[q.id] || '').trim().length > 0).length;
  const isLowTime = remainingSeconds <= 120;
  const isPausedByLockout = Boolean(lockdownPausedReason);

  return (
    <div className="min-h-screen bg-[#F5F1E8] text-[#252525] flex flex-col">
      {/* Calm, Focused Exam Top Bar */}
      <header className="sticky top-0 z-20 bg-white border-b border-[#E3DED3]">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base font-display font-bold text-[#252525] truncate">{session.exam.title}</h1>
            <div className="text-xs text-[#77736C] truncate tabular-nums">
              {session.exam.subject} · {answeredCount} of {questions.length} answered · AI &amp; Notes Locked
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-[#77736C]">
              {savingState === 'saving' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4476A8]" />
                  <span>Saving...</span>
                </>
              )}
              {savingState === 'saved' && (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#25845D]" />
                  <span>Saved</span>
                </>
              )}
              {savingState === 'error' && (
                <span className="text-[#C64B4B]">{saveErrorMsg || 'Save failed'}</span>
              )}
            </div>

            <div
              data-testid="exam-timer"
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border font-mono text-sm font-bold tabular-nums ${
                isLowTime
                  ? 'bg-[#C64B4B]/10 border-[#C64B4B] text-[#982E2E]'
                  : 'bg-[#EFEBE2]/70 border-[#E3DED3] text-[#252525]'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>{formatTimer(remainingSeconds)}</span>
            </div>

            <button
              type="button"
              onClick={() => setShowInstructions((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E3DED3] text-xs font-semibold text-[#77736C] hover:text-[#252525] hover:bg-[#EFEBE2]/60"
            >
              <Info className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Instructions</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSubmitConfirm(true)}
              className="px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold transition-colors whitespace-nowrap"
            >
              Submit Exam
            </button>
          </div>
        </div>
      </header>

      {/* Optional Instructions Drawer */}
      {showInstructions && (
        <div className="bg-[#EFEBE2] border-b border-[#E3DED3]">
          <div className="max-w-[1200px] mx-auto px-6 py-4 text-sm text-[#252525] space-y-1">
            <div className="font-semibold text-[#252525]">Examination Instructions</div>
            <p>{session.exam.instructions}</p>
            <p className="text-xs text-[#77736C] tabular-nums">
              Total Marks: {session.exam.totalMarks} · Passing Marks: {session.exam.passingMarks} · Duration:{' '}
              {session.exam.durationMinutes} minutes.
              {session.exam.trackTabSwitches &&
                ' Tab switches, window focus changes, and blocked shortcuts are logged without camera or microphone access.'}
            </p>
          </div>
        </div>
      )}

      {/* Tab Leave / Security Warning Banner */}
      {tabWarning && (
        <div className="bg-[#B77B25]/15 border-b border-[#B77B25]">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between gap-4 text-xs font-medium text-[#7A4F12]">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-[#B77B25]" />
              <span>
                {tabWarning} (Violations:{' '}
                <strong className="tabular-nums">
                  {tabSwitches}
                  {session.exam.maxTabSwitches > 0 ? ` / ${session.exam.maxTabSwitches}` : ''}
                </strong>
                )
              </span>
            </div>
            <button
              type="button"
              onClick={() => setTabWarning(null)}
              className="font-semibold underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Calm Question Area (blurred & disabled while security lockout overlay is active) */}
      <main
        aria-hidden={isPausedByLockout}
        className={`flex-1 max-w-[1200px] w-full mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start transition-all ${
          isPausedByLockout ? 'blur-md pointer-events-none select-none' : ''
        }`}
      >
        <div className="lg:col-span-8 bg-white border border-[#E3DED3] rounded-2xl p-6 lg:p-10 space-y-6">
          <div className="flex items-center justify-between text-xs text-[#77736C]">
            <span className="font-mono font-semibold text-[#66543A]">
              Question {currentIdx + 1} of {questions.length}
            </span>
            <span className="tabular-nums">
              {activeQ.questionType.replace('_', ' ').toUpperCase()} · {activeQ.marks} marks
            </span>
          </div>

          <div className="w-full h-1.5 bg-[#EFEBE2] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#C9A45C] transition-all duration-200"
              style={{ width: `${Math.round(((currentIdx + 1) / questions.length) * 100)}%` }}
            />
          </div>

          <h2
            className={`text-xl font-display font-semibold text-[#252525] leading-relaxed ${
              session.exam.blockCopyPaste ? 'select-none' : ''
            }`}
          >
            {activeQ.prompt}
          </h2>

          {activeQ.questionType === 'mcq' || activeQ.questionType === 'true_false' ? (
            <div className={`space-y-3 pt-2 ${session.exam.blockCopyPaste ? 'select-none' : ''}`}>
              {activeQ.options.map((opt) => {
                const selected = answers[activeQ.id] === opt;
                return (
                  <label
                    key={opt}
                    className={`flex items-center gap-3.5 p-4 rounded-xl border cursor-pointer transition-colors ${
                      selected
                        ? 'bg-[#EFEBE2] border-[#66543A] text-[#252525]'
                        : 'bg-white border-[#E3DED3] hover:bg-[#F5F1E8]/60'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`exam-q-${activeQ.id}`}
                      checked={selected}
                      onChange={() => handleAnswerChange(activeQ.id, opt, true)}
                      className="accent-[#66543A] w-4 h-4 shrink-0"
                    />
                    <span className="text-sm font-medium leading-snug">{opt}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="pt-2 space-y-2">
              <label htmlFor={`ans-${activeQ.id}`} className="block text-xs font-semibold text-[#77736C]">
                {activeQ.questionType === 'long_answer' ? 'Detailed Written Response' : 'Short Written Response'}
              </label>
              <textarea
                id={`ans-${activeQ.id}`}
                rows={activeQ.questionType === 'long_answer' ? 9 : 4}
                value={answers[activeQ.id] || ''}
                onChange={(e) => handleAnswerChange(activeQ.id, e.target.value, false)}
                onBlur={(e) => void persistAnswer(activeQ.id, e.target.value)}
                placeholder="Type your response here. Your draft saves automatically."
                className="w-full p-4 text-sm bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-xl text-[#252525] focus:bg-white focus:border-[#66543A] outline-none leading-relaxed"
              />
            </div>
          )}

          <div className="flex items-center justify-between pt-6 border-t border-[#E3DED3]">
            <button
              type="button"
              disabled={currentIdx === 0}
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E3DED3] text-sm font-semibold text-[#252525] disabled:opacity-40 hover:bg-[#EFEBE2]/70"
            >
              <ArrowLeft className="w-4 h-4" />
              Previous
            </button>

            {currentIdx < questions.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold transition-colors"
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(true)}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors"
              >
                Review &amp; Submit Exam
              </button>
            )}
          </div>
        </div>

        {/* Question Palette Sidebar */}
        <aside className="lg:col-span-4 bg-white border border-[#E3DED3] rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="text-sm font-bold text-[#252525]">Question Navigation</h3>
            <p className="text-xs text-[#77736C] mt-0.5 tabular-nums">
              {answeredCount} answered · {questions.length - answeredCount} remaining
            </p>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {questions.map((q, idx) => {
              const answered = (answers[q.id] || '').trim().length > 0;
              const active = idx === currentIdx;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setCurrentIdx(idx)}
                  aria-label={`Go to question ${idx + 1}`}
                  className={`h-10 rounded-lg font-mono text-xs font-semibold border transition-colors ${
                    active
                      ? 'bg-[#C9A45C] border-[#C9A45C] text-[#171717]'
                      : answered
                        ? 'bg-[#EFEBE2] border-[#66543A]/40 text-[#252525]'
                        : 'bg-[#F5F1E8]/60 border-[#E3DED3] text-[#77736C] hover:border-[#66543A]'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          <div className="pt-4 border-t border-[#E3DED3] space-y-2 text-xs text-[#77736C]">
            <div className="flex items-center justify-between">
              <span>Total Marks</span>
              <span className="font-mono font-semibold text-[#252525] tabular-nums">{session.exam.totalMarks}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Passing Marks</span>
              <span className="font-mono font-semibold text-[#252525] tabular-nums">{session.exam.passingMarks}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>AI &amp; Study Notes</span>
              <span className="font-mono font-semibold text-[#252525]">Locked</span>
            </div>
            {session.exam.blockCopyPaste && (
              <div className="flex items-center justify-between">
                <span>Clipboard &amp; Shortcuts</span>
                <span className="font-mono font-semibold text-[#252525]">Blocked</span>
              </div>
            )}
            {session.exam.trackTabSwitches && (
              <div className="flex items-center justify-between">
                <span>Tab / Focus Violations</span>
                <span
                  data-testid="exam-violation-counter"
                  className={`font-mono font-semibold tabular-nums ${
                    tabSwitches > 0 ? 'text-[#B77B25]' : 'text-[#252525]'
                  }`}
                >
                  {tabSwitches}
                  {session.exam.maxTabSwitches > 0 ? ` / ${session.exam.maxTabSwitches}` : ''}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowSubmitConfirm(true)}
            className="w-full py-2.5 rounded-xl bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold transition-colors"
          >
            Submit Exam
          </button>
        </aside>
      </main>

      {/* Immediate Tab-Switch & Exam Security Warning Modal */}
      {lockdownPausedReason && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lockout-title"
          className="fixed inset-0 z-50 bg-[#171717]/85 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div className="bg-white border border-[#E3DED3] rounded-2xl max-w-md w-full p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#C64B4B]/10 text-[#C64B4B] flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h2 id="lockout-title" className="text-lg font-display font-bold text-[#252525]">
                  Tab Switch &amp; Security Warning
                </h2>
                <p className="text-sm text-[#77736C] mt-1 leading-relaxed">{lockdownPausedReason}</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#EFEBE2]/70 border border-[#E3DED3] text-xs text-[#77736C] flex items-center justify-between tabular-nums">
              <span>Recorded tab/fullscreen violations</span>
              <strong className="font-mono text-[#252525]">
                {tabSwitches}
                {session.exam.maxTabSwitches > 0 ? ` / ${session.exam.maxTabSwitches}` : ''}
              </strong>
            </div>

            <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#EFEBE2] border border-[#E3DED3] text-xs text-[#252525] cursor-pointer">
              <input
                type="checkbox"
                checked={warningAcknowledged}
                onChange={(e) => setWarningAcknowledged(e.target.checked)}
                className="mt-0.5 accent-[#66543A] w-4 h-4 shrink-0"
              />
              <span className="leading-snug">
                I acknowledge this warning and understand that leaving the exam tab is recorded in the examination log.
              </span>
            </label>

            <button
              type="button"
              disabled={!warningAcknowledged || acknowledgingWarning}
              onClick={handleResumeFromLockout}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] disabled:opacity-45 disabled:cursor-not-allowed text-[#171717] text-sm font-semibold transition-colors"
            >
              {acknowledgingWarning && <Loader2 className="w-4 h-4 animate-spin" />}
              {session.exam.requireFullscreen && !fullscreenUnavailable
                ? 'Acknowledge Warning & Return to Fullscreen'
                : 'Acknowledge Warning & Resume Exam'}
            </button>
          </div>
        </div>
      )}

      {/* Submission Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-40 bg-[#171717]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED3] rounded-2xl max-w-md w-full p-6 space-y-5">
            <div>
              <h3 className="text-lg font-display font-bold text-[#252525]">Confirm Exam Submission</h3>
              <p className="text-sm text-[#77736C] mt-1">
                You have answered <strong className="tabular-nums text-[#252525]">{answeredCount}</strong> of{' '}
                <strong className="tabular-nums text-[#252525]">{questions.length}</strong> questions. Once submitted, you cannot modify your responses.
              </p>
            </div>

            {answeredCount < questions.length && (
              <div className="p-3 rounded-lg bg-[#B77B25]/15 border border-[#B77B25] text-xs text-[#7A4F12]">
                You still have {questions.length - answeredCount} unanswered question(s).
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowSubmitConfirm(false)}
                className="px-4 py-2 rounded-lg border border-[#E3DED3] text-sm font-semibold text-[#77736C] hover:text-[#252525]"
              >
                Continue Exam
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={submitExam}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold transition-colors"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm &amp; Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

