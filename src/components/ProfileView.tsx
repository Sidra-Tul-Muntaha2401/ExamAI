import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, LogOut, ShieldCheck, User as UserIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BrandMark } from './BrandMark';

export function ProfileView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, updateProfile, logout } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [institution, setInstitution] = useState(user?.institution || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [subject, setSubject] = useState(user?.teacherProfile?.subject || '');
  const [bio, setBio] = useState(user?.teacherProfile?.bio || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!user) return null;

  const backPath = user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/student';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      await updateProfile({
        name: name.trim(),
        institution: institution.trim(),
        avatarUrl: avatarUrl.trim(),
        ...(user.role === 'teacher' ? { subject: subject.trim(), bio: bio.trim() } : {}),
      });
      setMsg('Profile updated successfully.');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F1E8] text-[#252525]">
      <header className="bg-white border-b border-[#E3DED3]">
        <div className="max-w-[960px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => onNavigate('/')}>
              <BrandMark variant="light" size="sm" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate(backPath)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#66543A] hover:text-[#252525]"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Workspace
            </button>
          </div>
          <button
            type="button"
            onClick={async () => {
              await logout();
              onNavigate('/login');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E3DED3] text-xs font-semibold text-[#77736C] hover:text-[#252525]"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-[960px] mx-auto px-6 py-8 space-y-6">
        <div className="bg-white border border-[#E3DED3] rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#171717] text-[#DFC58E] flex items-center justify-center font-display font-bold text-lg">
              {user.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-[#252525]">{user.name}</h1>
              <p className="text-xs text-[#77736C] mt-0.5">
                {user.email} · Role: <span className="font-semibold uppercase text-[#66543A]">{user.role}</span> · Status:{' '}
                <span className="font-semibold text-[#25845D]">{user.accountStatus || 'active'}</span>
              </p>
            </div>
          </div>

          {user.role === 'teacher' && user.teacherProfile && (
            <div className="text-xs font-mono px-3 py-1.5 rounded-lg bg-[#F5F1E8] border border-[#E3DED3] text-[#66543A]">
              Verification: {user.teacherProfile.approvalStatus}
            </div>
          )}
        </div>

        <form onSubmit={handleSave} className="bg-white border border-[#E3DED3] rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-[#E3DED3]">
            <UserIcon className="w-4 h-4 text-[#66543A]" />
            <h2 className="font-display font-bold text-base">Account Details</h2>
          </div>

          {msg && (
            <div className="p-3 rounded-xl bg-[#25845D]/10 border border-[#25845D]/30 text-xs font-medium text-[#25845D] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {msg}
            </div>
          )}
          {err && (
            <div className="p-3 rounded-xl bg-[#C64B4B]/10 border border-[#C64B4B]/30 text-xs font-medium text-[#C64B4B]">
              {err}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#66543A] mb-1">Full Name</label>
              <input
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#66543A] mb-1">Institution</label>
              <input
                type="text"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="University or organization"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#66543A] mb-1">Avatar Image URL (Optional)</label>
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
            />
          </div>

          {user.role === 'teacher' && (
            <div className="space-y-4 pt-3 border-t border-[#E3DED3]">
              <div>
                <label className="block text-xs font-semibold text-[#66543A] mb-1">Subject Specialty</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#66543A] mb-1">Academic Bio</label>
                <textarea
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E3DED3] text-sm"
                />
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-between gap-4 text-xs text-[#77736C]">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#66543A]" />
              Role &amp; approval changes are governed by platform administrators.
            </span>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-[#C9A45C] hover:bg-[#DFC58E] text-[#171717] text-xs font-semibold flex items-center gap-2"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
