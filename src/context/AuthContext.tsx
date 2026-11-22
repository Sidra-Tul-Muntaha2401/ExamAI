import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { UserProfile, UserRole } from '../types/index';

const DEFAULT_STUDENT_PROFILE: UserProfile = {
  id: 'usr_student_demo',
  name: 'Maya Lin',
  email: 'student@exampilot.edu',
  role: 'student',
  createdAt: '',
};

const DEFAULT_TEACHER_PROFILE: UserProfile = {
  id: 'usr_teacher_demo',
  name: 'Dr. Elena Vance',
  email: 'teacher@exampilot.edu',
  role: 'teacher',
  createdAt: '',
};

function getFallbackProfile(role: UserRole): UserProfile {
  return role === 'teacher' ? DEFAULT_TEACHER_PROFILE : DEFAULT_STUDENT_PROFILE;
}

function detectInitialRole(): UserRole {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/teacher')) {
    return 'teacher';
  }
  return 'student';
}

interface AuthContextValue {
  user: UserProfile;
  activeRole: UserRole;
  loading: boolean;
  setWorkspaceRole: (role: UserRole) => void;
  refreshUser: (roleOverride?: UserRole) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [activeRole, setActiveRole] = useState<UserRole>(() => {
    const initial = detectInitialRole();
    api.setWorkspaceMode(initial);
    return initial;
  });
  const [user, setUser] = useState<UserProfile>(() => getFallbackProfile(detectInitialRole()));
  const [loading, setLoading] = useState(false);

  const refreshUser = useCallback(
    async (roleOverride?: UserRole) => {
      const targetRole = roleOverride ?? activeRole;
      api.setWorkspaceMode(targetRole);
      setLoading(true);
      try {
        const data = await api.get<{ user?: UserProfile | null }>(`/api/auth/me?mode=${targetRole}`);
        if (data && data.user && data.user.role) {
          setUser(data.user);
        } else {
          setUser(getFallbackProfile(targetRole));
        }
      } catch {
        setUser(getFallbackProfile(targetRole));
      } finally {
        setLoading(false);
      }
    },
    [activeRole]
  );

  const setWorkspaceRole = useCallback(
    (role: UserRole) => {
      api.setWorkspaceMode(role);
      setActiveRole(role);
      setUser(getFallbackProfile(role));
    },
    []
  );

  useEffect(() => {
    void refreshUser(activeRole);
  }, [activeRole, refreshUser]);

  return (
    <AuthContext.Provider value={{ user, activeRole, loading, setWorkspaceRole, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
