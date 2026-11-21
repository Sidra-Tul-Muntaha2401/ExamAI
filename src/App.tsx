import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthView } from './components/AuthView';
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

function AppRouter() {
  const { user, loading } = useAuth();
  const [pathname, setPathname] = useState<string>(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => {
      setPathname(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    const normalized = normalizePath(nextPath);
    if (normalizePath(window.location.pathname) !== normalized) {
      window.history.pushState({}, '', normalized);
    }
    setPathname(normalized);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F1E8] flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-[#66543A] animate-spin" />
      </div>
    );
  }

  if (pathname === '/') {
    return <LandingPage onNavigate={navigate} userRole={user?.role ?? null} />;
  }

  if (pathname === '/login' || pathname === '/register') {
    if (user) {
      return user.role === 'teacher' ? (
        <TeacherDashboard onNavigate={navigate} />
      ) : (
        <StudentDashboard onNavigate={navigate} />
      );
    }
    return <AuthView initialMode={pathname === '/register' ? 'register' : 'login'} onNavigate={navigate} />;
  }

  // Protected Routes: redirect unauthenticated visitors cleanly to Login
  if (!user) {
    return <AuthView initialMode="login" onNavigate={navigate} />;
  }

  if (pathname.startsWith('/practice/')) {
    const quizId = pathname.slice('/practice/'.length);
    if (user.role !== 'student') {
      return <TeacherDashboard onNavigate={navigate} />;
    }
    return <PracticeQuizRunner quizId={quizId} onNavigate={navigate} />;
  }

  if (pathname.startsWith('/exam/')) {
    const examId = pathname.slice('/exam/'.length);
    if (user.role !== 'student') {
      return <TeacherDashboard onNavigate={navigate} />;
    }
    return <ExamRoom examId={examId} onNavigate={navigate} />;
  }

  if (pathname.startsWith('/results/')) {
    const attemptId = pathname.slice('/results/'.length);
    return <ResultView attemptId={attemptId} userRole={user.role} onNavigate={navigate} />;
  }

  if (pathname === '/teacher') {
    if (user.role !== 'teacher') {
      return <StudentDashboard onNavigate={navigate} />;
    }
    return <TeacherDashboard onNavigate={navigate} />;
  }

  if (pathname === '/student') {
    if (user.role !== 'student') {
      return <TeacherDashboard onNavigate={navigate} />;
    }
    return <StudentDashboard onNavigate={navigate} />;
  }

  return <LandingPage onNavigate={navigate} userRole={user.role} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
