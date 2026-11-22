import React, { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { api } from './lib/api';
import type { UserRole } from './types/index';
import { ExamRoom } from './components/ExamRoom';
import { LandingPage } from './components/LandingPage';
import { PracticeQuizRunner } from './components/PracticeQuizRunner';
import { ResultView } from './components/ResultView';
import { StudentDashboard } from './components/StudentDashboard';
import { TeacherDashboard } from './components/TeacherDashboard';

function normalizePath(raw: string): string {
  if (!raw || raw === '/') return '/';
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed || '/';
}

function inferRoleFromPath(pathname: string, currentRole: UserRole): UserRole {
  if (pathname === '/teacher') return 'teacher';
  if (pathname === '/student' || pathname.startsWith('/practice/') || pathname.startsWith('/exam/')) {
    return 'student';
  }
  return currentRole;
}

function AppRouter() {
  const { activeRole, setWorkspaceRole } = useAuth();
  const [pathname, setPathname] = useState<string>(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => {
      const next = normalizePath(window.location.pathname);
      const nextRole = inferRoleFromPath(next, activeRole);
      api.setWorkspaceMode(nextRole);
      if (nextRole !== activeRole) {
        setWorkspaceRole(nextRole);
      }
      setPathname(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [activeRole, setWorkspaceRole]);

  const navigate = useCallback(
    (nextPath: string) => {
      const normalized = normalizePath(nextPath);
      const targetRole = inferRoleFromPath(normalized, activeRole);
      api.setWorkspaceMode(targetRole);
      if (targetRole !== activeRole) {
        setWorkspaceRole(targetRole);
      }
      if (normalizePath(window.location.pathname) !== normalized) {
        window.history.pushState({}, '', normalized);
      }
      setPathname(normalized);
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    [activeRole, setWorkspaceRole]
  );

  // Sync workspace API header immediately for direct URL loads
  const effectiveRole = inferRoleFromPath(pathname, activeRole);
  api.setWorkspaceMode(effectiveRole);

  if (pathname === '/' || pathname === '/login' || pathname === '/register') {
    return <LandingPage onNavigate={navigate} />;
  }

  if (pathname.startsWith('/practice/')) {
    const quizId = pathname.slice('/practice/'.length);
    return <PracticeQuizRunner quizId={quizId} onNavigate={navigate} />;
  }

  if (pathname.startsWith('/exam/')) {
    const examId = pathname.slice('/exam/'.length);
    return <ExamRoom examId={examId} onNavigate={navigate} />;
  }

  if (pathname.startsWith('/results/')) {
    const attemptId = pathname.slice('/results/'.length);
    return <ResultView attemptId={attemptId} userRole={effectiveRole} onNavigate={navigate} />;
  }

  if (pathname === '/teacher') {
    return <TeacherDashboard onNavigate={navigate} />;
  }

  if (pathname === '/student') {
    return <StudentDashboard onNavigate={navigate} />;
  }

  return <LandingPage onNavigate={navigate} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
