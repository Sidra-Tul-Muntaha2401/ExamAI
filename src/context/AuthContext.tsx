import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getBrowserSupabaseClient } from '../lib/supabaseClient';
import type { UserProfile, UserRole } from '../types/index';

export interface PublicAuthConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  allowTeacherRegistration: boolean;
  requireTeacherApproval: boolean;
  allowPublicPractice: boolean;
  allowDemoLogin: boolean;
}

export interface AdminBootstrapStatus {
  adminCount: number;
  canClaimFirstAdmin: boolean;
  secretConfigured: boolean;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  institution?: string;
  subject?: string;
  bio?: string;
  setupSecret?: string;
}

export interface ClaimAdminPayload {
  name: string;
  email: string;
  password: string;
  institution?: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  initialized: boolean;
  loading: boolean;
  publicConfig: PublicAuthConfig;
  adminBootstrap: AdminBootstrapStatus;
  refreshUser: () => Promise<UserProfile | null>;
  refreshAdminBootstrap: () => Promise<AdminBootstrapStatus>;
  login: (email: string, password: string) => Promise<UserProfile>;
  demoLogin: (role: UserRole) => Promise<UserProfile>;
  register: (payload: RegisterPayload) => Promise<UserProfile>;
  claimAdmin: (payload: ClaimAdminPayload) => Promise<UserProfile>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{ message: string; resetPreviewToken?: string }>;
  resetPassword: (token: string, newPassword: string) => Promise<{ message: string }>;
  updateProfile: (patch: {
    name?: string;
    institution?: string;
    avatarUrl?: string;
    subject?: string;
    bio?: string;
  }) => Promise<UserProfile>;
}

const DEFAULT_PUBLIC_CONFIG: PublicAuthConfig = {
  supabaseUrl: null,
  supabaseAnonKey: null,
  allowTeacherRegistration: true,
  requireTeacherApproval: true,
  allowPublicPractice: true,
  allowDemoLogin: true,
};

const DEFAULT_BOOTSTRAP_STATUS: AdminBootstrapStatus = {
  adminCount: 0,
  canClaimFirstAdmin: true,
  secretConfigured: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [publicConfig, setPublicConfig] = useState<PublicAuthConfig>(DEFAULT_PUBLIC_CONFIG);
  const [adminBootstrap, setAdminBootstrap] = useState<AdminBootstrapStatus>(DEFAULT_BOOTSTRAP_STATUS);

  const refreshAdminBootstrap = useCallback(async () => {
    try {
      const status = await api.get<AdminBootstrapStatus>('/api/auth/admin-bootstrap-status');
      setAdminBootstrap(status);
      return status;
    } catch {
      return DEFAULT_BOOTSTRAP_STATUS;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.get<{ user: UserProfile | null }>('/api/auth/me');
      setUser(data.user || null);
      return data.user || null;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    api.onUnauthorized(() => {
      setUser(null);
    });
    return () => api.onUnauthorized(null);
  }, []);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const [cfgRes, meRes, bootRes] = await Promise.all([
          api.get<PublicAuthConfig>('/api/auth/public-config').catch(() => DEFAULT_PUBLIC_CONFIG),
          api.get<{ user: UserProfile | null }>('/api/auth/me').catch(() => ({ user: null })),
          api
            .get<AdminBootstrapStatus>('/api/auth/admin-bootstrap-status')
            .catch(() => DEFAULT_BOOTSTRAP_STATUS),
        ]);

        if (!active) return;
        setPublicConfig(cfgRes);
        setAdminBootstrap(bootRes);

        if (meRes.user) {
          setUser(meRes.user);
        } else if (cfgRes.supabaseUrl && cfgRes.supabaseAnonKey) {
          const sb = getBrowserSupabaseClient(cfgRes.supabaseUrl, cfgRes.supabaseAnonKey);
          if (sb) {
            const { data } = await sb.auth.getSession();
            const accessToken = data.session?.access_token;
            if (accessToken) {
              try {
                const synced = await api.post<{ user: UserProfile; token: string }>('/api/auth/sync-supabase', {
                  accessToken,
                });
                if (!active) return;
                if (synced.token) api.setToken(synced.token);
                setUser(synced.user);
              } catch {
                // Ignore stale supabase session
              }
            }
          }
        }
      } finally {
        if (active) setInitialized(true);
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<UserProfile> => {
    setLoading(true);
    try {
      const res = await api.post<{ user: UserProfile; token: string }>('/api/auth/login', {
        email,
        password,
      });
      if (res.token) api.setToken(res.token);
      setUser(res.user);
      return res.user;
    } finally {
      setLoading(false);
    }
  }, []);

  const demoLogin = useCallback(
    async (role: UserRole): Promise<UserProfile> => {
      setLoading(true);
      try {
        const res = await api.post<{ user: UserProfile; token: string }>('/api/auth/demo-login', { role });
        if (res.token) api.setToken(res.token);
        setUser(res.user);
        void refreshAdminBootstrap();
        return res.user;
      } finally {
        setLoading(false);
      }
    },
    [refreshAdminBootstrap]
  );

  const register = useCallback(
    async (payload: RegisterPayload): Promise<UserProfile> => {
      setLoading(true);
      try {
        const res = await api.post<{ user: UserProfile; token: string }>('/api/auth/register', payload);
        if (res.token) api.setToken(res.token);
        setUser(res.user);
        void refreshAdminBootstrap();
        return res.user;
      } finally {
        setLoading(false);
      }
    },
    [refreshAdminBootstrap]
  );

  const claimAdmin = useCallback(
    async (payload: ClaimAdminPayload): Promise<UserProfile> => {
      setLoading(true);
      try {
        const res = await api.post<{ user: UserProfile; token: string }>('/api/auth/claim-admin', payload);
        if (res.token) api.setToken(res.token);
        setUser(res.user);
        void refreshAdminBootstrap();
        return res.user;
      } finally {
        setLoading(false);
      }
    },
    [refreshAdminBootstrap]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Clear local session regardless
    }
    const sb = getBrowserSupabaseClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey);
    if (sb) {
      await sb.auth.signOut().catch(() => {});
    }
    api.setToken(null);
    setUser(null);
  }, [publicConfig.supabaseAnonKey, publicConfig.supabaseUrl]);

  const forgotPassword = useCallback(async (email: string) => {
    return api.post<{ ok: boolean; message: string; resetPreviewToken?: string }>('/api/auth/forgot-password', {
      email,
    });
  }, []);

  const resetPassword = useCallback(async (token: string, newPassword: string) => {
    return api.post<{ ok: boolean; message: string }>('/api/auth/reset-password', {
      token,
      newPassword,
    });
  }, []);

  const updateProfile = useCallback(
    async (patch: {
      name?: string;
      institution?: string;
      avatarUrl?: string;
      subject?: string;
      bio?: string;
    }): Promise<UserProfile> => {
      const res = await api.patch<{ user: UserProfile }>('/api/profile', patch);
      setUser(res.user);
      return res.user;
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        initialized,
        loading,
        publicConfig,
        adminBootstrap,
        refreshUser,
        refreshAdminBootstrap,
        login,
        demoLogin,
        register,
        claimAdmin,
        logout,
        forgotPassword,
        resetPassword,
        updateProfile,
      }}
    >
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
