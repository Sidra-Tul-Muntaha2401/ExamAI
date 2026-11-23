import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Database,
  FileText,
  GraduationCap,
  Home,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  User as UserIcon,
  Users,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type {
  AccountStatus,
  AdminAuditLogRecord,
  ClassRecord,
  OfficialExamSummary,
  PlatformSettings,
  RequestLogRecord,
  UserProfile,
  UserRole,
} from '../types/index';
import { BrandMark } from './BrandMark';

interface AdminOverviewData {
  dbProvider: 'sqlite' | 'supabase';
  summary: {
    totalUsers: number;
    totalStudents: number;
    totalTeachers: number;
    pendingTeachers: number;
    totalAdmins: number;
    totalClasses: number;
    totalExams: number;
    totalAttempts: number;
    totalResults: number;
    totalDocuments: number;
    totalAiGenerations: number;
    totalRequests: number;
    avgPlatformScore: number | null;
    platformPassRate: number | null;
  };
  settings: PlatformSettings;
  database: {
    provider: 'sqlite' | 'supabase';
    tables: Array<{ name: string; rows: number }>;
  };
  recentAuditLogs: AdminAuditLogRecord[];
  recentRequests: RequestLogRecord[];
}

interface AdminAttemptRow {
  id: string;
  examId: string;
  examTitle: string;
  subject: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  status: string;
  startedAt: string;
  submittedAt: string | null;
  tabSwitchCount: number;
}

interface AdminResultRow {
  id: string;
  attemptId: string;
  examId: string;
  examTitle: string;
  subject: string;
  studentName: string;
  studentEmail: string;
  totalScore: number;
  totalMarks: number;
  percentage: number;
  passed: boolean;
  status: string;
  publishedAt: string;
}

type AdminTab =
  | 'overview'
  | 'users'
  | 'approvals'
  | 'classes'
  | 'exams'
  | 'attempts'
  | 'database'
  | 'logs'
  | 'settings';

export function AdminDashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [exams, setExams] = useState<Array<OfficialExamSummary & { teacherEmail?: string }>>([]);
  const [attempts, setAttempts] = useState<AdminAttemptRow[]>([]);
  const [results, setResults] = useState<AdminResultRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogRecord[]>([]);
  const [requestLogs, setRequestLogs] = useState<RequestLogRecord[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);

  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | UserRole>('all');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | AccountStatus>('all');
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  // Create user modal state
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('student');
  const [newInstitution, setNewInstitution] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverviewAndUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, usr] = await Promise.all([
        api.get<AdminOverviewData>('/api/admin/overview'),
        api.get<{ users: UserProfile[] }>('/api/admin/users'),
      ]);
      setOverview(ov);
      setSettings(ov.settings);
      setUsers(usr.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin console.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTabSpecific = useCallback(async (activeTab: AdminTab) => {
    try {
      if (activeTab === 'classes') {
        const res = await api.get<{ classes: ClassRecord[] }>('/api/admin/classes');
        setClasses(res.classes);
      } else if (activeTab === 'exams') {
        const res = await api.get<{ exams: Array<OfficialExamSummary & { teacherEmail?: string }> }>('/api/admin/exams');
        setExams(res.exams);
      } else if (activeTab === 'attempts') {
        const [a, r] = await Promise.all([
          api.get<{ attempts: AdminAttemptRow[] }>('/api/admin/attempts'),
          api.get<{ results: AdminResultRow[] }>('/api/admin/results'),
        ]);
        setAttempts(a.attempts);
        setResults(r.results);
      } else if (activeTab === 'logs') {
        const res = await api.get<{ auditLogs: AdminAuditLogRecord[]; requestLogs: RequestLogRecord[] }>(
          '/api/admin/audit-logs'
        );
        setAuditLogs(res.auditLogs);
        setRequestLogs(res.requestLogs);
      } else if (activeTab === 'settings') {
        const res = await api.get<{ settings: PlatformSettings }>('/api/admin/settings');
        setSettings(res.settings);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin section data.');
    }
  }, []);

  useEffect(() => {
    void loadOverviewAndUsers();
  }, [loadOverviewAndUsers]);

  useEffect(() => {
    void loadTabSpecific(tab);
  }, [tab, loadTabSpecific]);

  const handleTeacherApproval = async (teacherId: string, approvalStatus: 'approved' | 'rejected') => {
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/api/admin/teachers/${teacherId}/approval`, {
        approvalStatus,
        rejectionReason: approvalStatus === 'rejected' ? rejectReasons[teacherId] || 'Verification declined' : '',
      });
      setNotice(`Teacher account ${approvalStatus}.`);
      await loadOverviewAndUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update teacher approval.');
    }
  };

  const handleUpdateUser = async (
    targetId: string,
    patch: { role?: UserRole; accountStatus?: AccountStatus }
  ) => {
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/api/admin/users/${targetId}`, patch);
      setNotice('User account updated.');
      await loadOverviewAndUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update user.');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingUser(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('/api/admin/users', {
        name: newName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
        institution: newInstitution.trim(),
        subject: newRole === 'teacher' ? newSubject.trim() : '',
        approvalStatus: 'approved',
      });
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewInstitution('');
      setNewSubject('');
      setShowCreateUser(false);
      setNotice(`Created ${newRole} account successfully.`);
      await loadOverviewAndUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleSaveSettings = async (next: PlatformSettings) => {
    setError(null);
    setNotice(null);
    try {
      const res = await api.patch<{ settings: PlatformSettings }>('/api/admin/settings', next);
      setSettings(res.settings);
      setNotice('Platform settings saved.');
      await loadOverviewAndUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings.');
    }
  };

  const handleSignOut = async () => {
    await logout();
    onNavigate('/login');
  };

  const pendingTeachers = users.filter(
    (u) => u.role === 'teacher' && u.teacherProfile?.approvalStatus !== 'approved'
  );

  const filteredUsers = users.filter((u) => {
    if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false;
    if (userStatusFilter !== 'all' && (u.accountStatus || 'active') !== userStatusFilter) return false;
    if (!userSearch.trim()) return true;
    const q = userSearch.trim().toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.institution || '').toLowerCase().includes(q)
    );
  });

  const navItems: Array<{ id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'users', label: 'Users Directory', icon: Users },
    { id: 'approvals', label: 'Teacher Approvals', icon: ShieldCheck },
    { id: 'classes', label: 'Classes', icon: BookOpen },
    { id: 'exams', label: 'Exams', icon: FileText },
    { id: 'attempts', label: 'Attempts & Results', icon: ClipboardList },
    { id: 'database', label: 'Database', icon: Database },
    { id: 'logs', label: 'Audit & Requests', icon: Activity },
    { id: 'settings', label: 'Platform Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#F5F1E8] text-[#252525] flex flex-col lg:flex-row">
      <aside className="lg:w-64 lg:sticky lg:top-0 lg:h-screen bg-[#171717] text-white shrink-0 flex flex-col justify-between overflow-y-auto">
        <div>
          <div className="px-6 h-16 flex items-center justify-between border-b border-[#303030]">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              aria-label="ExamAI home"
              className="whitespace-nowrap shrink-0"
            >
              <BrandMark variant="dark" size="sm" />
            </button>
            <span className="text-[11px] font-medium text-[#DFC58E]">Admin</span>
          </div>

          <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#C9A45C] text-[#171717] font-semibold'
                      : 'text-[#D6D0C4] hover:bg-[#303030] hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {item.id === 'approvals' && (overview?.summary.pendingTeachers || 0) > 0 && (
                    <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-[#B77B25] text-white tabular-nums">
                      {overview?.summary.pendingTeachers}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden lg:block p-4 border-t border-[#303030] space-y-2">
          <div className="pb-1">
            <div className="text-sm font-semibold text-white truncate">{user?.name || 'Admin'}</div>
            <div className="text-xs text-[#B5B0A6] truncate">{user?.email || 'Administrator'}</div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/profile')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[#303030] hover:bg-[#3D3D3D] text-xs font-semibold text-white transition-colors"
          >
            <UserIcon className="w-3.5 h-3.5 text-[#DFC58E]" />
            Account Profile
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-[#D6D0C4] hover:text-white hover:bg-[#303030]/60 transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            Home
          </button>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-[#E8A5A5] hover:text-white hover:bg-[#C64B4B]/25 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white border-b border-[#E3DED3] px-6 h-16 flex items-center justify-between gap-4">
          <h1 className="text-lg font-display font-bold text-[#252525] truncate">
            Administration Console · {user?.name || 'Admin'}
          </h1>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                void loadOverviewAndUsers();
                void loadTabSpecific(tab);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E3DED3] hover:bg-[#EFEBE2] text-xs font-semibold text-[#252525]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('users');
                setShowCreateUser(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              Add User
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              aria-label="Logout"
              className="lg:hidden inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-[#E3DED3] text-xs font-semibold text-[#C64B4B]"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-[1200px] w-full mx-auto space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 p-4 rounded-xl bg-[#C64B4B]/10 border border-[#C64B4B]/35 text-sm text-[#982E2E]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#C64B4B]" />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="flex items-center gap-2 p-3.5 rounded-xl bg-[#25845D]/10 border border-[#25845D]/30 text-xs font-medium text-[#19593E]">
              <CheckCircle2 className="w-4 h-4 text-[#25845D]" />
              <span>{notice}</span>
            </div>
          )}

          {loading && !overview ? (
            <div className="py-16 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-[#66543A] animate-spin" />
            </div>
          ) : overview ? (
            <>
              {tab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs text-[#77736C]">Total Registered Users</div>
                      <div className="font-mono text-2xl font-bold text-[#252525] tabular-nums mt-1">
                        {overview.summary.totalUsers}
                      </div>
                      <div className="text-[11px] text-[#77736C] mt-1 tabular-nums">
                        {overview.summary.totalStudents} students · {overview.summary.totalTeachers} teachers ·{' '}
                        {overview.summary.totalAdmins} admin
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs text-[#77736C]">Pending Teacher Approvals</div>
                      <div className="font-mono text-2xl font-bold text-[#B77B25] tabular-nums mt-1">
                        {overview.summary.pendingTeachers}
                      </div>
                      <button
                        type="button"
                        onClick={() => setTab('approvals')}
                        className="text-[11px] font-semibold text-[#66543A] hover:underline mt-1"
                      >
                        Review queue →
                      </button>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs text-[#77736C]">Classes &amp; Official Exams</div>
                      <div className="font-mono text-2xl font-bold text-[#4476A8] tabular-nums mt-1">
                        {overview.summary.totalClasses} / {overview.summary.totalExams}
                      </div>
                      <div className="text-[11px] text-[#77736C] mt-1 tabular-nums">
                        {overview.summary.totalAttempts} attempts recorded
                      </div>
                    </div>
                    <div className="bg-white border border-[#E3DED3] rounded-xl p-5">
                      <div className="text-xs text-[#77736C]">Platform Evaluated Avg</div>
                      <div className="font-mono text-2xl font-bold text-[#25845D] tabular-nums mt-1">
                        {overview.summary.avgPlatformScore !== null ? `${overview.summary.avgPlatformScore}%` : '—'}
                      </div>
                      <div className="text-[11px] text-[#77736C] mt-1 tabular-nums">
                        Pass rate: {overview.summary.platformPassRate !== null ? `${overview.summary.platformPassRate}%` : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-6 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-display font-bold text-[#252525]">Recent Admin Audit Trail</h2>
                        <button
                          type="button"
                          onClick={() => setTab('logs')}
                          className="text-xs font-semibold text-[#66543A] hover:underline"
                        >
                          View logs
                        </button>
                      </div>
                      {overview.recentAuditLogs.length === 0 ? (
                        <p className="text-sm text-[#77736C]">No administrative actions recorded yet.</p>
                      ) : (
                        <div className="divide-y divide-[#E3DED3]">
                          {overview.recentAuditLogs.slice(0, 8).map((log) => (
                            <div key={log.id} className="py-2.5 text-xs">
                              <div className="flex justify-between gap-2">
                                <span className="font-semibold text-[#252525]">{log.action}</span>
                                <span className="text-[#77736C] tabular-nums">
                                  {new Date(log.createdAt).toLocaleString()}
                                </span>
                              </div>
                              <div className="text-[#77736C] mt-0.5">{log.details}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="lg:col-span-6 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-display font-bold text-[#252525]">Storage &amp; Activity Summary</h2>
                        <span className="text-xs font-mono font-semibold text-[#66543A]">
                          {overview.dbProvider === 'supabase' ? 'Supabase PostgreSQL' : 'Local SQLite'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 border-y border-[#E3DED3] py-3 text-xs">
                        <div>
                          <div className="text-[#77736C]">Documents</div>
                          <div className="font-mono font-bold text-lg tabular-nums">{overview.summary.totalDocuments}</div>
                        </div>
                        <div>
                          <div className="text-[#77736C]">AI Runs</div>
                          <div className="font-mono font-bold text-lg tabular-nums">{overview.summary.totalAiGenerations}</div>
                        </div>
                        <div>
                          <div className="text-[#77736C]">API Requests</div>
                          <div className="font-mono font-bold text-lg tabular-nums">{overview.summary.totalRequests}</div>
                        </div>
                      </div>
                      <div className="space-y-1.5 text-xs">
                        {overview.database.tables.slice(0, 6).map((t) => (
                          <div key={t.name} className="flex justify-between py-1 border-b border-[#E3DED3] last:border-0">
                            <span className="font-mono text-[#252525]">{t.name}</span>
                            <span className="font-mono tabular-nums text-[#77736C]">{t.rows} rows</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'users' && (
                <div className="space-y-6">
                  {showCreateUser && (
                    <form
                      onSubmit={handleCreateUser}
                      className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-display font-bold text-[#252525]">Create New Account</h2>
                        <button
                          type="button"
                          onClick={() => setShowCreateUser(false)}
                          className="text-xs text-[#77736C] hover:text-[#252525]"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                        <input
                          type="text"
                          required
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="Full Name"
                          className="px-3.5 py-2 text-sm border border-[#E3DED3] rounded-lg"
                        />
                        <input
                          type="email"
                          required
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          placeholder="Email Address"
                          className="px-3.5 py-2 text-sm border border-[#E3DED3] rounded-lg"
                        />
                        <input
                          type="password"
                          required
                          minLength={8}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Password (8+ chars)"
                          className="px-3.5 py-2 text-sm border border-[#E3DED3] rounded-lg"
                        />
                        <select
                          value={newRole}
                          onChange={(e) => setNewRole(e.target.value as UserRole)}
                          aria-label="New user role"
                          className="px-3.5 py-2 text-sm border border-[#E3DED3] rounded-lg bg-white"
                        >
                          <option value="student">Student</option>
                          <option value="teacher">Teacher (Pre-approved)</option>
                          <option value="admin">Admin</option>
                        </select>
                        <input
                          type="text"
                          value={newInstitution}
                          onChange={(e) => setNewInstitution(e.target.value)}
                          placeholder="Institution (Optional)"
                          className="px-3.5 py-2 text-sm border border-[#E3DED3] rounded-lg"
                        />
                        {newRole === 'teacher' && (
                          <input
                            type="text"
                            value={newSubject}
                            onChange={(e) => setNewSubject(e.target.value)}
                            placeholder="Teaching Subject"
                            className="px-3.5 py-2 text-sm border border-[#E3DED3] rounded-lg"
                          />
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={creatingUser}
                        className="px-5 py-2.5 rounded-lg bg-[#171717] hover:bg-[#303030] text-white text-xs font-semibold"
                      >
                        {creatingUser ? 'Creating...' : 'Create User'}
                      </button>
                    </form>
                  )}

                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <h2 className="text-base font-display font-bold text-[#252525]">
                        Registered Users ({filteredUsers.length})
                      </h2>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-[#77736C] absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={userSearch}
                            onChange={(e) => setUserSearch(e.target.value)}
                            placeholder="Search name, email..."
                            className="pl-8 pr-3 py-1.5 text-xs bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg min-w-[200px]"
                          />
                        </div>
                        <select
                          value={userRoleFilter}
                          onChange={(e) => setUserRoleFilter(e.target.value as 'all' | UserRole)}
                          aria-label="Filter users by role"
                          className="px-3 py-1.5 text-xs bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg"
                        >
                          <option value="all">All Roles</option>
                          <option value="student">Students</option>
                          <option value="teacher">Teachers</option>
                          <option value="admin">Admins</option>
                        </select>
                        <select
                          value={userStatusFilter}
                          onChange={(e) => setUserStatusFilter(e.target.value as 'all' | AccountStatus)}
                          aria-label="Filter users by account status"
                          className="px-3 py-1.5 text-xs bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg"
                        >
                          <option value="all">All Statuses</option>
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                          <option value="deactivated">Deactivated</option>
                        </select>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[#E3DED3] text-[#77736C]">
                            <th className="py-2.5 pr-4 font-semibold">User</th>
                            <th className="py-2.5 pr-4 font-semibold">Role</th>
                            <th className="py-2.5 pr-4 font-semibold">Verification / Status</th>
                            <th className="py-2.5 pr-4 font-semibold">Joined</th>
                            <th className="py-2.5 font-semibold">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E3DED3]">
                          {filteredUsers.map((u) => {
                            const status = u.accountStatus || 'active';
                            const isSelf = u.id === user?.id;
                            return (
                              <tr key={u.id}>
                                <td className="py-3 pr-4">
                                  <div className="font-semibold text-[#252525]">{u.name}</div>
                                  <div className="text-[11px] text-[#77736C]">{u.email}</div>
                                </td>
                                <td className="py-3 pr-4">
                                  <select
                                    disabled={isSelf}
                                    value={u.role}
                                    onChange={(e) => void handleUpdateUser(u.id, { role: e.target.value as UserRole })}
                                    aria-label={`Role for ${u.name}`}
                                    className="px-2 py-1 text-xs border border-[#E3DED3] rounded bg-white disabled:opacity-60"
                                  >
                                    <option value="student">Student</option>
                                    <option value="teacher">Teacher</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                </td>
                                <td className="py-3 pr-4">
                                  <div
                                    className={`font-semibold uppercase text-[11px] ${
                                      status === 'active' ? 'text-[#25845D]' : 'text-[#C64B4B]'
                                    }`}
                                  >
                                    {status}
                                  </div>
                                  {u.role === 'teacher' && (
                                    <div className="text-[11px] text-[#77736C]">
                                      Teacher: {u.teacherProfile?.approvalStatus || 'approved'}
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 pr-4 text-[#77736C] tabular-nums">
                                  {new Date(u.createdAt).toLocaleDateString()}
                                </td>
                                <td className="py-3">
                                  {!isSelf && (
                                    <div className="flex flex-wrap gap-2">
                                      {status === 'active' ? (
                                        <button
                                          type="button"
                                          onClick={() => void handleUpdateUser(u.id, { accountStatus: 'suspended' })}
                                          className="px-2.5 py-1 rounded border border-[#C64B4B]/40 text-[#C64B4B] hover:bg-[#C64B4B]/10 font-semibold"
                                        >
                                          Suspend
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => void handleUpdateUser(u.id, { accountStatus: 'active' })}
                                          className="px-2.5 py-1 rounded border border-[#25845D]/40 text-[#25845D] hover:bg-[#25845D]/10 font-semibold"
                                        >
                                          Reactivate
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'approvals' && (
                <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-[#66543A]" />
                    <h2 className="text-lg font-display font-bold text-[#252525]">
                      Teacher Verification Queue ({pendingTeachers.length})
                    </h2>
                  </div>
                  {pendingTeachers.length === 0 ? (
                    <p className="text-sm text-[#77736C] py-4">
                      All registered teachers have been approved. New teacher sign-ups appear here for review.
                    </p>
                  ) : (
                    <div className="divide-y divide-[#E3DED3]">
                      {pendingTeachers.map((t) => (
                        <div key={t.id} className="py-4 space-y-3">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <div className="text-sm font-bold text-[#252525]">
                                {t.name} ({t.email})
                              </div>
                              <div className="text-xs text-[#77736C]">
                                Subject: {t.teacherProfile?.subject || 'Not specified'} · Institution:{' '}
                                {t.institution || 'Not specified'} · Current status:{' '}
                                <span className="font-semibold uppercase">
                                  {t.teacherProfile?.approvalStatus || 'pending'}
                                </span>
                              </div>
                              {t.teacherProfile?.bio && (
                                <p className="text-xs text-[#252525]">{t.teacherProfile.bio}</p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <input
                                type="text"
                                value={rejectReasons[t.id] || ''}
                                onChange={(e) =>
                                  setRejectReasons((prev) => ({ ...prev, [t.id]: e.target.value }))
                                }
                                placeholder="Optional rejection note"
                                className="px-3 py-1.5 text-xs border border-[#E3DED3] rounded-lg"
                              />
                              <button
                                type="button"
                                onClick={() => void handleTeacherApproval(t.id, 'approved')}
                                className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg bg-[#25845D] hover:bg-[#1E6E4D] text-white text-xs font-semibold"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleTeacherApproval(t.id, 'rejected')}
                                className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg border border-[#C64B4B]/40 text-[#C64B4B] hover:bg-[#C64B4B]/10 text-xs font-semibold"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Reject
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'classes' && (
                <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                  <h2 className="text-lg font-display font-bold text-[#252525]">All Classes ({classes.length})</h2>
                  {classes.length === 0 ? (
                    <p className="text-sm text-[#77736C]">No classes created yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[#E3DED3] text-[#77736C]">
                            <th className="py-2.5 pr-4 font-semibold">Class</th>
                            <th className="py-2.5 pr-4 font-semibold">Instructor</th>
                            <th className="py-2.5 pr-4 font-semibold">Code</th>
                            <th className="py-2.5 pr-4 font-semibold">Members</th>
                            <th className="py-2.5 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E3DED3]">
                          {classes.map((c) => (
                            <tr key={c.id}>
                              <td className="py-3 pr-4">
                                <div className="font-semibold text-[#252525]">{c.name}</div>
                                <div className="text-[11px] text-[#77736C]">{c.subject}</div>
                              </td>
                              <td className="py-3 pr-4 text-[#252525]">{c.teacherName || 'Teacher'}</td>
                              <td className="py-3 pr-4 font-mono font-semibold text-[#66543A]">{c.enrollmentCode}</td>
                              <td className="py-3 pr-4 font-mono tabular-nums">{c.memberCount}</td>
                              <td className="py-3 uppercase font-semibold">{c.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {tab === 'exams' && (
                <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                  <h2 className="text-lg font-display font-bold text-[#252525]">All Official Exams ({exams.length})</h2>
                  {exams.length === 0 ? (
                    <p className="text-sm text-[#77736C]">No exams created yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[#E3DED3] text-[#77736C]">
                            <th className="py-2.5 pr-4 font-semibold">Exam Title</th>
                            <th className="py-2.5 pr-4 font-semibold">Teacher</th>
                            <th className="py-2.5 pr-4 font-semibold">Questions</th>
                            <th className="py-2.5 pr-4 font-semibold">Submissions</th>
                            <th className="py-2.5 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E3DED3]">
                          {exams.map((ex) => (
                            <tr key={ex.id}>
                              <td className="py-3 pr-4">
                                <div className="font-semibold text-[#252525]">{ex.title}</div>
                                <div className="text-[11px] text-[#77736C]">{ex.subject}</div>
                              </td>
                              <td className="py-3 pr-4">{ex.teacherName || 'Teacher'}</td>
                              <td className="py-3 pr-4 font-mono tabular-nums">{ex.questionCount || 0}</td>
                              <td className="py-3 pr-4 font-mono tabular-nums">
                                {ex.submissionCount || 0} ({ex.pendingEvaluationCount || 0} pending)
                              </td>
                              <td className="py-3 uppercase font-semibold">{ex.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {tab === 'attempts' && (
                <div className="space-y-6">
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <h2 className="text-lg font-display font-bold text-[#252525]">
                      Published Results ({results.length})
                    </h2>
                    {results.length === 0 ? (
                      <p className="text-sm text-[#77736C]">No exam results recorded yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-[#E3DED3] text-[#77736C]">
                              <th className="py-2.5 pr-4 font-semibold">Student</th>
                              <th className="py-2.5 pr-4 font-semibold">Exam</th>
                              <th className="py-2.5 pr-4 font-semibold">Score</th>
                              <th className="py-2.5 pr-4 font-semibold">Status</th>
                              <th className="py-2.5 font-semibold">Report</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E3DED3]">
                            {results.map((r) => (
                              <tr key={r.id}>
                                <td className="py-3 pr-4">
                                  <div className="font-semibold text-[#252525]">{r.studentName}</div>
                                  <div className="text-[11px] text-[#77736C]">{r.studentEmail}</div>
                                </td>
                                <td className="py-3 pr-4">{r.examTitle}</td>
                                <td className="py-3 pr-4 font-mono tabular-nums">
                                  {r.totalScore}/{r.totalMarks} ({r.percentage}%)
                                </td>
                                <td className="py-3 pr-4 uppercase font-semibold">{r.status}</td>
                                <td className="py-3">
                                  <button
                                    type="button"
                                    onClick={() => onNavigate(`/results/${r.attemptId}`)}
                                    className="px-3 py-1 rounded border border-[#E3DED3] hover:bg-[#EFEBE2] font-semibold"
                                  >
                                    View Result
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <h2 className="text-lg font-display font-bold text-[#252525]">
                      Exam Attempts ({attempts.length})
                    </h2>
                    {attempts.length === 0 ? (
                      <p className="text-sm text-[#77736C]">No exam attempts started yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-[#E3DED3] text-[#77736C]">
                              <th className="py-2.5 pr-4 font-semibold">Student</th>
                              <th className="py-2.5 pr-4 font-semibold">Exam</th>
                              <th className="py-2.5 pr-4 font-semibold">Status</th>
                              <th className="py-2.5 pr-4 font-semibold">Tab Switches</th>
                              <th className="py-2.5 font-semibold">Started</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E3DED3]">
                            {attempts.map((a) => (
                              <tr key={a.id}>
                                <td className="py-2.5 pr-4 font-semibold text-[#252525]">{a.studentName}</td>
                                <td className="py-2.5 pr-4">{a.examTitle}</td>
                                <td className="py-2.5 pr-4 uppercase font-semibold">{a.status}</td>
                                <td className="py-2.5 pr-4 font-mono tabular-nums">{a.tabSwitchCount}</td>
                                <td className="py-2.5 text-[#77736C] tabular-nums">
                                  {new Date(a.startedAt).toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === 'database' && (
                <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-5 h-5 text-[#66543A]" />
                      <h2 className="text-lg font-display font-bold text-[#252525]">Database Storage Overview</h2>
                    </div>
                    <span className="text-xs font-mono font-semibold text-[#66543A]">
                      Active Provider: {overview.database.provider}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {overview.database.tables.map((t) => (
                      <div
                        key={t.name}
                        className="p-3.5 rounded-xl bg-[#F5F1E8]/70 border border-[#E3DED3] flex items-center justify-between"
                      >
                        <span className="font-mono text-xs font-semibold text-[#252525]">{t.name}</span>
                        <span className="font-mono text-sm font-bold text-[#66543A] tabular-nums">{t.rows}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'logs' && (
                <div className="space-y-6">
                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <h2 className="text-base font-display font-bold text-[#252525]">
                      Admin Audit Logs ({auditLogs.length})
                    </h2>
                    {auditLogs.length === 0 ? (
                      <p className="text-sm text-[#77736C]">No admin audit events logged yet.</p>
                    ) : (
                      <div className="divide-y divide-[#E3DED3]">
                        {auditLogs.map((log) => (
                          <div key={log.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                            <div>
                              <span className="font-semibold text-[#252525]">{log.action}</span> ·{' '}
                              <span className="text-[#77736C]">{log.details}</span>
                            </div>
                            <span className="font-mono text-[#77736C] tabular-nums">
                              {new Date(log.createdAt).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-4">
                    <h2 className="text-base font-display font-bold text-[#252525]">
                      API Request Logs ({requestLogs.length})
                    </h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[#E3DED3] text-[#77736C]">
                            <th className="py-2 pr-4 font-semibold">Time</th>
                            <th className="py-2 pr-4 font-semibold">User</th>
                            <th className="py-2 pr-4 font-semibold">Endpoint</th>
                            <th className="py-2 pr-4 font-semibold">Status</th>
                            <th className="py-2 font-semibold">Details</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E3DED3]">
                          {requestLogs.slice(0, 60).map((log) => (
                            <tr key={log.id}>
                              <td className="py-2 pr-4 text-[#77736C] tabular-nums whitespace-nowrap">
                                {new Date(log.createdAt).toLocaleString()}
                              </td>
                              <td className="py-2 pr-4">
                                <span className="font-semibold text-[#252525]">{log.userName}</span> ({log.userRole})
                              </td>
                              <td className="py-2 pr-4 font-mono">
                                {log.method} {log.endpoint}
                              </td>
                              <td className="py-2 pr-4 font-mono tabular-nums">{log.statusCode}</td>
                              <td className="py-2 text-[#77736C]">{log.details || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'settings' && settings && (
                <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-5 max-w-2xl">
                  <h2 className="text-lg font-display font-bold text-[#252525]">Platform Governance Settings</h2>
                  <div className="space-y-4 text-sm">
                    <label className="flex items-start justify-between gap-4 py-2 border-b border-[#E3DED3]">
                      <div>
                        <div className="font-semibold text-[#252525]">Allow Teacher Self-Registration</div>
                        <div className="text-xs text-[#77736C]">
                          Allow instructors to create accounts from the Register page.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.allowTeacherRegistration}
                        onChange={(e) =>
                          void handleSaveSettings({
                            ...settings,
                            allowTeacherRegistration: e.target.checked,
                          })
                        }
                        className="mt-1 accent-[#66543A]"
                      />
                    </label>

                    <label className="flex items-start justify-between gap-4 py-2 border-b border-[#E3DED3]">
                      <div>
                        <div className="font-semibold text-[#252525]">Require Admin Approval for New Teachers</div>
                        <div className="text-xs text-[#77736C]">
                          Newly registered teachers wait in Pending Verification until approved by an Admin.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.requireTeacherApproval}
                        onChange={(e) =>
                          void handleSaveSettings({
                            ...settings,
                            requireTeacherApproval: e.target.checked,
                          })
                        }
                        className="mt-1 accent-[#66543A]"
                      />
                    </label>

                    <label className="flex items-start justify-between gap-4 py-2 border-b border-[#E3DED3]">
                      <div>
                        <div className="font-semibold text-[#252525]">Allow Public Guest Practice</div>
                        <div className="text-xs text-[#77736C]">
                          Enable the /practice sample quiz workspace for visitors before registering.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.allowPublicPractice}
                        onChange={(e) =>
                          void handleSaveSettings({
                            ...settings,
                            allowPublicPractice: e.target.checked,
                          })
                        }
                        className="mt-1 accent-[#66543A]"
                      />
                    </label>

                    <div className="flex items-center justify-between gap-4 pt-1">
                      <div>
                        <div className="font-semibold text-[#252525]">Default Exam Tab-Switch Limit</div>
                        <div className="text-xs text-[#77736C]">
                          Default lockdown auto-submit threshold for newly composed exams.
                        </div>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={settings.defaultMaxTabSwitches}
                        onChange={(e) =>
                          void handleSaveSettings({
                            ...settings,
                            defaultMaxTabSwitches: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                          })
                        }
                        className="w-20 px-3 py-1.5 text-sm border border-[#E3DED3] rounded-lg tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
