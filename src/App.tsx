import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthView } from './components/AuthView';
import { BrandMark } from './components/BrandMark';
import { ExamRoom } from './components/ExamRoom';
import { LandingPage } from './components/LandingPage';
import { PracticeQuizRunner } from './components/PracticeQuizRunner';
import { ProfileView } from './components/ProfileView';
import { PublicPracticeView } from './components/PublicPracticeView';
import { ResultView } from './components/ResultView';
import { StudentDashboard } from './components/StudentDashboard';
import { TeacherDashboard } from './components/TeacherDashboard';
import type { UserRole } from './types/index';

function normalizePath(raw: string): string {
  if (!raw || raw === '/') return '/';
  const [pathOnly] = raw.split('?');
  const trimmed = pathOnly.replace(/\/+$/, '');
  return trimmed || '/';
}

function getWorkspacePath(role: UserRole): string {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  return '/student';
}

function AppRouter() {
  const { user, initialized } = useAuth();
  const [pathname, setPathname] = useState<string>(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => {
      setPathname(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    const fullTarget = nextPath.startsWith('/') ? nextPath : `/${nextPath}`;
    const normalized = normalizePath(fullTarget);
    if (window.location.pathname + window.location.search !== fullTarget) {
      window.history.pushState({}, '', fullTarget);
    }
    setPathname(normalized);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  // Wait for initial session check before guarding protected routes
  if (!initialized) {
    return (
      <div className="min-h-screen bg-[#F5F1E8] text-[#252525] flex flex-col items-center justify-center gap-4 p-6">
        <BrandMark variant="light" />
        <Loader2 className="w-6 h-6 text-[#66543A] animate-spin" />
      </div>
    );
  }

  // Public & Auth Routes
  if (pathname === '/') {
    return <LandingPage onNavigate={navigate} />;
  }
  if (pathname === '/practice') {
    return <PublicPracticeView onNavigate={navigate} />;
  }
  if (pathname === '/login') {
    return <AuthView mode="login" onNavigate={navigate} />;
  }
  if (pathname === '/register') {
    return <AuthView mode="register" onNavigate={navigate} />;
  }
  if (pathname === '/forgot-password') {
    return <AuthView mode="forgot-password" onNavigate={navigate} />;
  }
  if (pathname === '/reset-password') {
    return <AuthView mode="reset-password" onNavigate={navigate} />;
  }
  if (pathname === '/admin-setup') {
    return <AuthView mode="admin-setup" onNavigate={navigate} />;
  }

  // Protected Routes — Require Authenticated User
  if (!user) {
    return <AuthView mode="login" onNavigate={navigate} />;
  }

  if (pathname === '/profile') {
    return <ProfileView onNavigate={navigate} />;
  }

  if (pathname.startsWith('/results/')) {
    const attemptId = pathname.slice('/results/'.length);
    return <ResultView attemptId={attemptId} userRole={user.role} onNavigate={navigate} />;
  }

  // Student-only workspaces
  if (pathname === '/student' || pathname.startsWith('/practice/') || pathname.startsWith('/exam/')) {
    if (user.role !== 'student') {
      const home = getWorkspacePath(user.role);
      if (user.role === 'admin') return <AdminDashboard onNavigate={navigate} />;
      if (user.role === 'teacher') return <TeacherDashboard onNavigate={navigate} />;
      window.history.replaceState({}, '', home);
    }
    if (pathname.startsWith('/practice/')) {
      const quizId = pathname.slice('/practice/'.length);
      return <PracticeQuizRunner quizId={quizId} onNavigate={navigate} />;
    }
    if (pathname.startsWith('/exam/')) {
      const examId = pathname.slice('/exam/'.length);
      return <ExamRoom examId={examId} onNavigate={navigate} />;
    }
    return <StudentDashboard onNavigate={navigate} />;
  }

  // Teacher-only workspace
  if (pathname === '/teacher') {
    if (user.role !== 'teacher') {
      if (user.role === 'admin') return <AdminDashboard onNavigate={navigate} />;
      return <StudentDashboard onNavigate={navigate} />;
    }
    return <TeacherDashboard onNavigate={navigate} />;
  }

  // Admin-only console
  if (pathname === '/admin') {
    if (user.role !== 'admin') {
      if (user.role === 'teacher') return <TeacherDashboard onNavigate={navigate} />;
      return <StudentDashboard onNavigate={navigate} />;
    }
    return <AdminDashboard onNavigate={navigate} />;
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
