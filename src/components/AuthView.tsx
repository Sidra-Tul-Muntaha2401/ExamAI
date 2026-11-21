import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, BookOpen, GraduationCap, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/index';
import { BrandMark } from './BrandMark';

interface AuthViewProps {
  initialMode: 'login' | 'register';
  onNavigate: (path: string) => void;
}

export function AuthView({ initialMode, onNavigate }: AuthViewProps) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
  }, [initialMode]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('student');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const user =
        mode === 'login'
          ? await login(email, password)
          : await register(name, email, password, role);
      onNavigate(user.role === 'teacher' ? '/teacher' : '/student');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoLogin = async (demoEmail: string, demoPassword: string) => {
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(demoEmail, demoPassword);
      onNavigate(user.role === 'teacher' ? '/teacher' : '/student');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F1E8] flex flex-col justify-center px-6 py-12">
      <div className="max-w-md w-full mx-auto space-y-6">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#66543A] hover:text-[#252525] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to ExamAI Home
        </button>

        <div className="bg-white border border-[#E3DED3] rounded-2xl p-8 space-y-6">
          <div className="space-y-3">
            <BrandMark variant="light" size="sm" />
            <div>
              <h1 className="text-2xl font-display font-bold text-[#252525]">
                {mode === 'login' ? 'Sign in to ExamAI' : 'Create your ExamAI account'}
              </h1>
              <p className="text-sm text-[#77736C] mt-1">
                {mode === 'login'
                  ? 'Access your Study Mode quizzes or Teaching Mode exam studio.'
                  : 'Choose Student or Teacher mode to initialize your workspace.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 p-1 bg-[#EFEBE2] rounded-xl">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                mode === 'login' ? 'bg-white text-[#252525] shadow-xs' : 'text-[#77736C] hover:text-[#252525]'
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                mode === 'register' ? 'bg-white text-[#252525] shadow-xs' : 'text-[#77736C] hover:text-[#252525]'
              }`}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label htmlFor="auth-name" className="block text-xs font-semibold text-[#252525] mb-1.5">
                    Full Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none"
                  />
                </div>

                <div>
                  <span className="block text-xs font-semibold text-[#252525] mb-1.5">Account Role</span>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setRole('student')}
                      className={`p-3 rounded-xl border text-left transition-colors ${
                        role === 'student'
                          ? 'bg-[#EFEBE2] border-[#C9A45C] text-[#252525]'
                          : 'bg-white border-[#E3DED3] text-[#77736C] hover:bg-[#F5F1E8]/50'
                      }`}
                    >
                      <BookOpen className="w-4 h-4 text-[#4476A8] mb-1" />
                      <div className="text-xs font-bold text-[#252525]">Student</div>
                      <div className="text-[11px] text-[#77736C]">Study &amp; take exams</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('teacher')}
                      className={`p-3 rounded-xl border text-left transition-colors ${
                        role === 'teacher'
                          ? 'bg-[#EFEBE2] border-[#C9A45C] text-[#252525]'
                          : 'bg-white border-[#E3DED3] text-[#77736C] hover:bg-[#F5F1E8]/50'
                      }`}
                    >
                      <GraduationCap className="w-4 h-4 text-[#66543A] mb-1" />
                      <div className="text-xs font-bold text-[#252525]">Teacher</div>
                      <div className="text-[11px] text-[#77736C]">Create &amp; grade exams</div>
                    </button>
                  </div>
                </div>
              </>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-semibold text-[#252525] mb-1.5">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
                className="w-full px-3.5 py-2.5 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-semibold text-[#252525] mb-1.5">
                Password {mode === 'register' ? '(min. 8 characters)' : ''}
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={mode === 'register' ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[#C64B4B]/10 border border-[#C64B4B]/35 text-xs text-[#982E2E]">
                <AlertCircle className="w-4 h-4 shrink-0 text-[#C64B4B]" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] disabled:opacity-50 text-[#171717] text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* Seeded Demo Quick Access */}
          <div className="pt-5 border-t border-[#E3DED3] space-y-3">
            <div className="text-xs font-semibold text-[#77736C]">Quick Demo Access (Pre-seeded SQLite Accounts)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleDemoLogin('student@exampilot.edu', 'Student123!')}
                className="px-3 py-2.5 rounded-lg border border-[#E3DED3] bg-[#F5F1E8] hover:bg-[#EFEBE2] text-left transition-colors"
              >
                <div className="text-xs font-bold text-[#252525]">Demo Student</div>
                <div className="text-[11px] text-[#77736C]">Maya Lin · Study Mode</div>
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleDemoLogin('teacher@exampilot.edu', 'Teacher123!')}
                className="px-3 py-2.5 rounded-lg border border-[#E3DED3] bg-[#F5F1E8] hover:bg-[#EFEBE2] text-left transition-colors"
              >
                <div className="text-xs font-bold text-[#252525]">Demo Teacher</div>
                <div className="text-[11px] text-[#77736C]">Dr. Vance · Teaching Mode</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
