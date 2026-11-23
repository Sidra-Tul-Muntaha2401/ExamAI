import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/index';
import { BrandMark } from './BrandMark';

export type AuthScreenMode = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'admin-setup';

interface AuthViewProps {
  mode: AuthScreenMode;
  onNavigate: (path: string) => void;
}

function getWorkspacePath(role: UserRole): string {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  return '/student';
}

export function AuthView({ mode, onNavigate }: AuthViewProps) {
  const {
    user,
    loading,
    publicConfig,
    adminBootstrap,
    refreshAdminBootstrap,
    login,
    demoLogin,
    register,
    claimAdmin,
    forgotPassword,
    resetPassword,
  } = useAuth();

  const [selectedRole, setSelectedRole] = useState<UserRole>('student');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [institution, setInstitution] = useState('');
  const [subject, setSubject] = useState('');
  const [bio, setBio] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [resetToken, setResetToken] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      return p.get('token') || '';
    }
    return '';
  });
  const [newPassword, setNewPassword] = useState('');
  const [previewResetToken, setPreviewResetToken] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setSuccessMsg(null);
  }, [mode]);

  useEffect(() => {
    if (mode === 'register' || mode === 'admin-setup') {
      void refreshAdminBootstrap();
    }
  }, [mode, refreshAdminBootstrap]);

  useEffect(() => {
    if (user && mode !== 'reset-password') {
      onNavigate(getWorkspacePath(user.role));
    }
  }, [user, mode, onNavigate]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const signedIn = await login(email.trim(), password);
      onNavigate(getWorkspacePath(signedIn.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    }
  };

  const handleDemoAccess = async (role: UserRole) => {
    setError(null);
    try {
      const signedIn = await demoLogin(role);
      onNavigate(getWorkspacePath(signedIn.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to open demo ${role} account.`);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (selectedRole === 'teacher' && !subject.trim()) {
      setError('Please enter your primary teaching subject.');
      return;
    }
    if (selectedRole === 'admin' && !adminBootstrap.canClaimFirstAdmin && !setupSecret.trim()) {
      setError('Enter the Admin Setup Secret provided by your organization.');
      return;
    }

    try {
      const created = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        role: selectedRole,
        institution: institution.trim(),
        subject: selectedRole === 'teacher' ? subject.trim() : undefined,
        bio: selectedRole === 'teacher' ? bio.trim() : undefined,
        setupSecret: selectedRole === 'admin' && !adminBootstrap.canClaimFirstAdmin ? setupSecret.trim() : undefined,
      });
      onNavigate(getWorkspacePath(created.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    }
  };

  const handleAdminClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    try {
      const created = await claimAdmin({
        name: name.trim(),
        email: email.trim(),
        password,
        institution: institution.trim() || 'ExamAI Administration',
      });
      onNavigate(getWorkspacePath(created.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim Admin account.');
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setPreviewResetToken(null);
    try {
      const res = await forgotPassword(email.trim());
      setSuccessMsg(res.message);
      if (res.resetPreviewToken) {
        setPreviewResetToken(res.resetPreviewToken);
        setResetToken(res.resetPreviewToken);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request password reset.');
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    try {
      const res = await resetPassword(resetToken.trim(), newPassword);
      setSuccessMsg(res.message);
      setNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    }
  };

  const roleCards: Array<{
    role: UserRole;
    title: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      role: 'student',
      title: 'Student',
      subtitle: 'Join classes, take exams & study',
      icon: BookOpen,
    },
    {
      role: 'teacher',
      title: 'Teacher',
      subtitle: 'Create exams & grade rubrics',
      icon: GraduationCap,
    },
    {
      role: 'admin',
      title: 'Admin',
      subtitle: adminBootstrap.canClaimFirstAdmin ? 'First-time claim open' : 'Via setup secret',
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="min-h-screen bg-[#F5F1E8] text-[#252525] flex flex-col">
      <header className="bg-white border-b border-[#E3DED3]">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            aria-label="ExamAI home"
            className="whitespace-nowrap shrink-0"
          >
            <BrandMark variant="light" />
          </button>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('/practice')}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold text-[#66543A] hover:bg-[#F5F1E8] transition-colors whitespace-nowrap"
            >
              Guest Practice
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E3DED3] bg-white hover:bg-[#EFEBE2] text-xs font-semibold text-[#252525] transition-colors whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Home
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-[1040px] bg-white border border-[#E3DED3] rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          {/* Left Obsidian Brand Panel */}
          <div className="lg:col-span-5 bg-[#171717] text-white p-8 lg:p-10 flex flex-col justify-between space-y-8">
            <div className="space-y-4">
              <p className="text-xs font-semibold tracking-wider uppercase text-[#DFC58E]">
                Role-Verified Academic Access
              </p>
              <h1 className="text-2xl lg:text-3xl font-display font-bold leading-tight text-balance">
                {mode === 'register'
                  ? 'Create your ExamAI account'
                  : mode === 'forgot-password'
                    ? 'Recover account access'
                    : mode === 'reset-password'
                      ? 'Set a new password'
                      : mode === 'admin-setup'
                        ? 'Administrator Setup'
                        : 'Sign in to your workspace'}
              </h1>
              <p className="text-sm text-[#D6D0C4] leading-relaxed">
                Students unlock assigned exams, class rosters, and topic progress analytics. Teachers compose timed evaluations and rubrics. Administrators oversee approvals and platform governance.
              </p>
            </div>

            <div className="space-y-3 pt-6 border-t border-[#303030] text-xs text-[#D6D0C4]">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#C9A45C] shrink-0 mt-0.5" />
                <span>Students register immediately and join classes with enrollment codes</span>
              </div>
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#C9A45C] shrink-0 mt-0.5" />
                <span>
                  Teachers undergo verification review ({publicConfig.requireTeacherApproval ? 'Admin approval required' : 'Instant access'})
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#C9A45C] shrink-0 mt-0.5" />
                <span>
                  {adminBootstrap.canClaimFirstAdmin
                    ? 'First-time Admin claim is open for initial setup'
                    : 'Additional Admins require Admin Setup Secret or invitation'}
                </span>
              </div>
            </div>
          </div>

          {/* Right Form Panel */}
          <div className="lg:col-span-7 p-6 sm:p-10 space-y-6">
            {/* Switch Tabs for Login / Register */}
            {(mode === 'login' || mode === 'register') && (
              <div className="flex items-center gap-2 border-b border-[#E3DED3] pb-4">
                <button
                  type="button"
                  onClick={() => onNavigate('/login')}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    mode === 'login'
                      ? 'bg-[#171717] text-white'
                      : 'text-[#77736C] hover:text-[#252525] hover:bg-[#F5F1E8]'
                  }`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/register')}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    mode === 'register'
                      ? 'bg-[#171717] text-white'
                      : 'text-[#77736C] hover:text-[#252525] hover:bg-[#F5F1E8]'
                  }`}
                >
                  Register
                </button>
              </div>
            )}

            {error && (
              <div className="p-3.5 rounded-xl bg-[#C64B4B]/10 border border-[#C64B4B]/30 text-xs font-medium text-[#C64B4B] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3.5 rounded-xl bg-[#25845D]/10 border border-[#25845D]/30 text-xs font-medium text-[#25845D] flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* LOGIN FORM */}
            {mode === 'login' && (
              <div className="space-y-6">
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#66543A] mb-1.5">Email Address</label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@university.edu"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] bg-white text-sm focus:outline-none focus:border-[#C9A45C]"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-[#66543A]">Password</label>
                      <button
                        type="button"
                        onClick={() => onNavigate('/forgot-password')}
                        className="text-xs font-semibold text-[#66543A] hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-[#E3DED3] bg-white text-sm focus:outline-none focus:border-[#C9A45C]"
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#77736C] hover:text-[#252525]"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] disabled:opacity-60 text-[#171717] text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Sign In
                  </button>
                </form>

                {publicConfig.allowDemoLogin && (
                  <div className="pt-5 border-t border-[#E3DED3] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#77736C]">
                        Quick Demo Access (Preview Testing)
                      </span>
                      <span className="text-[11px] font-mono text-[#77736C]">All 3 Roles</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void handleDemoAccess('student')}
                        className="px-3 py-2.5 rounded-xl border border-[#E3DED3] bg-[#F5F1E8] hover:bg-[#EFEBE2] text-xs font-semibold text-[#252525] transition-colors flex items-center justify-center gap-1.5"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-[#4476A8]" />
                        Demo Student
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void handleDemoAccess('teacher')}
                        className="px-3 py-2.5 rounded-xl border border-[#E3DED3] bg-[#F5F1E8] hover:bg-[#EFEBE2] text-xs font-semibold text-[#252525] transition-colors flex items-center justify-center gap-1.5"
                      >
                        <GraduationCap className="w-3.5 h-3.5 text-[#66543A]" />
                        Demo Teacher
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void handleDemoAccess('admin')}
                        className="px-3 py-2.5 rounded-xl border border-[#E3DED3] bg-[#171717] hover:bg-[#303030] text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-[#DFC58E]" />
                        Demo Admin
                      </button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-[#77736C] text-center">
                  Need a new account?{' '}
                  <button
                    type="button"
                    onClick={() => onNavigate('/register')}
                    className="font-semibold text-[#66543A] hover:underline"
                  >
                    Register as Student, Teacher, or Admin
                  </button>
                </p>
              </div>
            )}

            {/* REGISTER FORM (STUDENT, TEACHER, AND ADMIN) */}
            {mode === 'register' && (
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#66543A] mb-2">Select Account Role</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {roleCards.map((card) => {
                      const Icon = card.icon;
                      const active = selectedRole === card.role;
                      const teacherDisabled = card.role === 'teacher' && !publicConfig.allowTeacherRegistration;
                      return (
                        <button
                          key={card.role}
                          type="button"
                          disabled={teacherDisabled}
                          onClick={() => {
                            setSelectedRole(card.role);
                            setError(null);
                          }}
                          className={`p-3 rounded-xl border text-left transition-colors ${
                            active
                              ? 'border-[#C9A45C] bg-[#F5F1E8]'
                              : 'border-[#E3DED3] bg-white hover:bg-[#F5F1E8]/50'
                          } ${teacherDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Icon className={`w-4 h-4 ${active ? 'text-[#66543A]' : 'text-[#77736C]'}`} />
                            <span className="text-xs font-bold text-[#252525]">{card.title}</span>
                          </div>
                          <p className="text-[11px] text-[#77736C] leading-snug">
                            {teacherDisabled ? 'Disabled by admin' : card.subtitle}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedRole === 'teacher' && publicConfig.requireTeacherApproval && (
                  <div className="p-3 rounded-xl bg-[#F5F1E8] border border-[#E3DED3] text-xs text-[#66543A]">
                    Teacher accounts start with <strong>Pending Verification</strong> status until an Administrator approves your profile.
                  </div>
                )}

                {selectedRole === 'admin' && (
                  <div className="p-3 rounded-xl bg-[#F5F1E8] border border-[#E3DED3] text-xs text-[#66543A]">
                    {adminBootstrap.canClaimFirstAdmin ? (
                      <span>
                        <strong>First-Admin Claim Open:</strong> No administrator exists yet. Creating this account assigns you as the primary platform Admin.
                      </span>
                    ) : (
                      <span>
                        <strong>Admin Verification Required:</strong> An Admin already exists. Enter the server <code>ADMIN_BOOTSTRAP_SECRET</code> below to register another Admin.
                      </span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-[#66543A] mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Jordan Patel"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm focus:outline-none focus:border-[#C9A45C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#66543A] mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@university.edu"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm focus:outline-none focus:border-[#C9A45C]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#66543A] mb-1">
                    Institution / School (Optional)
                  </label>
                  <input
                    type="text"
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    placeholder="e.g. State University"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm focus:outline-none focus:border-[#C9A45C]"
                  />
                </div>

                {selectedRole === 'teacher' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-[#66543A] mb-1">
                        Primary Subject Specialty *
                      </label>
                      <input
                        type="text"
                        required
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="e.g. Computer Science"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm focus:outline-none focus:border-[#C9A45C]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#66543A] mb-1">
                        Short Bio / Credentials
                      </label>
                      <input
                        type="text"
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="e.g. Lecturer in Algorithms"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm focus:outline-none focus:border-[#C9A45C]"
                      />
                    </div>
                  </div>
                )}

                {selectedRole === 'admin' && !adminBootstrap.canClaimFirstAdmin && (
                  <div>
                    <label className="block text-xs font-semibold text-[#66543A] mb-1">
                      Admin Setup Secret *
                    </label>
                    <input
                      type="password"
                      required
                      value={setupSecret}
                      onChange={(e) => setSetupSecret(e.target.value)}
                      placeholder="Enter server ADMIN_BOOTSTRAP_SECRET"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm focus:outline-none focus:border-[#C9A45C]"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-[#66543A] mb-1">Password (8+ chars)</label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm focus:outline-none focus:border-[#C9A45C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#66543A] mb-1">Confirm Password</label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm focus:outline-none focus:border-[#C9A45C]"
                    />
                  </div>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-[#77736C] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                    className="rounded border-[#E3DED3]"
                  />
                  Show password
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] disabled:opacity-60 text-[#171717] text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {selectedRole === 'admin'
                    ? adminBootstrap.canClaimFirstAdmin
                      ? 'Claim First Admin & Enter Console'
                      : 'Create Admin Account'
                    : selectedRole === 'teacher'
                      ? 'Register Teacher Account'
                      : 'Register Student Account'}
                </button>
              </form>
            )}

            {/* FIRST-TIME ADMIN SETUP (/admin-setup) */}
            {mode === 'admin-setup' && (
              <div className="space-y-4">
                {!adminBootstrap.canClaimFirstAdmin ? (
                  <div className="p-5 rounded-xl bg-[#F5F1E8] border border-[#E3DED3] space-y-3">
                    <p className="text-sm font-semibold text-[#252525]">Administrator Already Configured</p>
                    <p className="text-xs text-[#77736C] leading-relaxed">
                      An Admin account is already active on this instance. Sign in as an Admin or register via the Register tab using your server Admin Setup Secret.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onNavigate('/login')}
                        className="px-4 py-2 rounded-lg bg-[#171717] text-white text-xs font-semibold"
                      >
                        Go to Login
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRole('admin');
                          onNavigate('/register');
                        }}
                        className="px-4 py-2 rounded-lg border border-[#E3DED3] bg-white text-xs font-semibold"
                      >
                        Register with Secret
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleAdminClaimSubmit} className="space-y-4">
                    <p className="text-xs text-[#77736C]">
                      Claim the initial Administrator account. Once claimed, this setup route locks automatically.
                    </p>
                    <div>
                      <label className="block text-xs font-semibold text-[#66543A] mb-1">Admin Full Name</label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Platform Administrator"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#66543A] mb-1">Admin Email</label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="admin@institution.edu"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-[#66543A] mb-1">Password</label>
                        <input
                          type="password"
                          required
                          minLength={8}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#66543A] mb-1">Confirm Password</label>
                        <input
                          type="password"
                          required
                          minLength={8}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 rounded-xl bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold flex items-center justify-center gap-2"
                    >
                      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                      Claim Initial Admin Account
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* FORGOT PASSWORD */}
            {mode === 'forgot-password' && (
              <div className="space-y-4">
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <p className="text-xs text-[#77736C] leading-relaxed">
                    Enter the email address associated with your account to generate a secure password reset token.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-[#66543A] mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@university.edu"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl bg-[#171717] hover:bg-[#303030] text-white text-sm font-semibold"
                  >
                    Request Reset Token
                  </button>
                </form>

                {previewResetToken && (
                  <div className="p-4 rounded-xl bg-[#F5F1E8] border border-[#E3DED3] space-y-2">
                    <div className="text-xs font-semibold text-[#66543A] flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5" />
                      Preview Reset Token Issued
                    </div>
                    <code className="block text-xs font-mono bg-white border border-[#E3DED3] px-3 py-2 rounded-lg break-all">
                      {previewResetToken}
                    </code>
                    <button
                      type="button"
                      onClick={() => onNavigate(`/reset-password?token=${encodeURIComponent(previewResetToken)}`)}
                      className="px-3.5 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold"
                    >
                      Continue to Set New Password
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 text-xs">
                  <button type="button" onClick={() => onNavigate('/login')} className="text-[#66543A] font-semibold hover:underline">
                    Back to Login
                  </button>
                  <button type="button" onClick={() => onNavigate('/reset-password')} className="text-[#77736C] hover:text-[#252525]">
                    Already have a token?
                  </button>
                </div>
              </div>
            )}

            {/* RESET PASSWORD */}
            {mode === 'reset-password' && (
              <div className="space-y-4">
                <form onSubmit={handleResetSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#66543A] mb-1">Reset Token</label>
                    <input
                      type="text"
                      required
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      placeholder="Paste reset token"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#66543A] mb-1">New Password (8+ chars)</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-3 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-sm font-semibold"
                  >
                    Update Password
                  </button>
                </form>
                <div className="text-xs text-center">
                  <button type="button" onClick={() => onNavigate('/login')} className="font-semibold text-[#66543A] hover:underline">
                    Back to Sign In
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
