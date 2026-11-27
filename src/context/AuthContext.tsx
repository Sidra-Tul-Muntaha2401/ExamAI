import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { api } from '../lib/api';
import { getBrowserSupabaseClient } from '../lib/supabaseClient';
import {
  ensureOwnSupabaseProfile,
  formatSupabaseAuthError,
  updateOwnSupabaseProfile,
} from '../lib/supabaseProfiles';
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

export interface RegisterOutcome {
  user: UserProfile | null;
  confirmationRequired?: boolean;
  message?: string;
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
  isRecoveryMode: boolean;
  recoveryEmail: string | null;
  publicConfig: PublicAuthConfig;
  adminBootstrap: AdminBootstrapStatus;
  refreshUser: () => Promise<UserProfile | null>;
  refreshAdminBootstrap: () => Promise<AdminBootstrapStatus>;
  login: (email: string, password: string) => Promise<UserProfile>;
  demoLogin: (role: UserRole) => Promise<UserProfile>;
  register: (payload: RegisterPayload) => Promise<RegisterOutcome>;
  claimAdmin: (payload: ClaimAdminPayload) => Promise<RegisterOutcome>;
  resendConfirmation: (email: string) => Promise<string>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{ ok?: boolean; message: string; resetPreviewToken?: string }>;
  resetPassword: (token: string, newPassword: string) => Promise<{ ok?: boolean; message: string; email?: string }>;
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

function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const PENDING_CONFIRM_EMAIL_KEY = 'examai_pending_confirm_email';

function buildConfirmationRedirectUrl(email: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams({
    confirmed: '1',
    email: email.trim().toLowerCase(),
  });
  return `${window.location.origin}/login?${params.toString()}`;
}

function readConfirmationCallbackFromLocation(): {
  isConfirmationRedirect: boolean;
  isRecoveryRedirect: boolean;
  emailFromUrl: string;
  errorDescription: string;
} {
  if (typeof window === 'undefined') {
    return {
      isConfirmationRedirect: false,
      isRecoveryRedirect: false,
      emailFromUrl: '',
      errorDescription: '',
    };
  }
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const typeParam = (hashParams.get('type') || searchParams.get('type') || '').toLowerCase();
  const confirmedParam = searchParams.get('confirmed') === '1';
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const hasAuthExchangeParam = Boolean(
    searchParams.get('code') ||
      searchParams.get('token_hash') ||
      hashParams.get('access_token')
  );
  const isRecoveryRedirect =
    typeParam === 'recovery' || (pathname === '/reset-password' && hasAuthExchangeParam);
  const isConfirmationRedirect =
    !isRecoveryRedirect &&
    (confirmedParam || typeParam === 'signup' || typeParam === 'email');

  const emailFromUrl = (searchParams.get('email') || '').trim();
  const errorDescription = (
    searchParams.get('error_description') ||
    hashParams.get('error_description') ||
    ''
  ).trim();

  return {
    isConfirmationRedirect,
    isRecoveryRedirect,
    emailFromUrl,
    errorDescription,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicAuthConfig>(DEFAULT_PUBLIC_CONFIG);
  const [adminBootstrap, setAdminBootstrap] = useState<AdminBootstrapStatus>(DEFAULT_BOOTSTRAP_STATUS);

  const publicConfigRef = useRef<PublicAuthConfig>(DEFAULT_PUBLIC_CONFIG);
  const authActionInFlightRef = useRef(false);
  const isRecoveryModeRef = useRef(false);

  const setRecoveryState = useCallback((activeRecovery: boolean, email: string | null = null) => {
    isRecoveryModeRef.current = activeRecovery;
    setIsRecoveryMode(activeRecovery);
    setRecoveryEmail(activeRecovery ? email : null);
  }, []);

  const setResolvedPublicConfig = useCallback((cfg: PublicAuthConfig) => {
    publicConfigRef.current = cfg;
    setPublicConfig(cfg);
  }, []);

  const resolveSupabaseWithConfig = useCallback(async (): Promise<{
    sb: SupabaseClient | null;
    cfg: PublicAuthConfig;
  }> => {
    let cfg = publicConfigRef.current;
    let sb = getBrowserSupabaseClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    if (!sb && (!cfg.supabaseUrl || !cfg.supabaseAnonKey)) {
      try {
        cfg = await api.get<PublicAuthConfig>('/api/auth/public-config');
        setResolvedPublicConfig(cfg);
        sb = getBrowserSupabaseClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      } catch {
        // Fallback to env-only if backend unreachable
      }
    }
    return { sb, cfg };
  }, [setResolvedPublicConfig]);

  const syncSupabaseSession = useCallback(
    async (
      sb: SupabaseClient,
      cfg: PublicAuthConfig,
      session: Session,
      overrides?: {
        name?: string;
        role?: UserRole;
        institution?: string;
        subject?: string;
        bio?: string;
        setupSecret?: string;
      }
    ): Promise<UserProfile> => {
      const accessToken = session.access_token;
      const authUser = session.user;
      const sbUrl =
        cfg.supabaseUrl ||
        ((import.meta.env?.VITE_SUPABASE_URL as string | undefined) || '').trim();
      const sbAnonKey =
        cfg.supabaseAnonKey ||
        ((import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined) ||
          (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
          (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY as string | undefined) ||
          '').trim();

      let profileRow = null;
      if (sbUrl && sbAnonKey && authUser) {
        profileRow = await ensureOwnSupabaseProfile({
          supabase: sb,
          supabaseUrl: sbUrl,
          supabaseAnonKey: sbAnonKey,
          accessToken,
          authUser,
          fullName: overrides?.name,
          role: overrides?.role,
          institution: overrides?.institution,
        });
      }

      const synced = await api.post<{ user: UserProfile; token: string }>('/api/auth/sync-supabase', {
        accessToken,
        name: overrides?.name || profileRow?.fullName,
        role: overrides?.role || profileRow?.role,
        institution: overrides?.institution ?? profileRow?.institution,
        subject: overrides?.subject,
        bio: overrides?.bio,
        setupSecret: overrides?.setupSecret,
      });

      api.setToken(synced.token || accessToken);
      setUser(synced.user);
      return synced.user;
    },
    []
  );

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
    let subscription: { unsubscribe: () => void } | null = null;

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
        setResolvedPublicConfig(cfgRes);
        setAdminBootstrap(bootRes);

        const callbackInfo = readConfirmationCallbackFromLocation();

        const sb = getBrowserSupabaseClient(cfgRes.supabaseUrl, cfgRes.supabaseAnonKey);
        if (sb) {
          const { data: sessionData } = await sb.auth.getSession();
          if (!active) return;

          if (callbackInfo.isConfirmationRedirect) {
            let pendingEmail = '';
            try {
              pendingEmail = window.sessionStorage.getItem(PENDING_CONFIRM_EMAIL_KEY) || '';
              window.sessionStorage.removeItem(PENDING_CONFIRM_EMAIL_KEY);
            } catch {
              // Ignore storage access errors
            }

            const confirmedEmail = (
              sessionData.session?.user?.email ||
              callbackInfo.emailFromUrl ||
              pendingEmail
            )
              .trim()
              .toLowerCase();

            // Clear the temporary session created by clicking the confirmation link so the user lands on Login with email filled
            if (sessionData.session) {
              authActionInFlightRef.current = true;
              try {
                await sb.auth.signOut({ scope: 'local' }).catch(() => {});
              } finally {
                authActionInFlightRef.current = false;
              }
            }
            api.setToken(null);
            if (meRes.user) {
              await api.post('/api/auth/logout').catch(() => {});
            }
            if (active) setUser(null);

            if (typeof window !== 'undefined') {
              const nextParams = new URLSearchParams();
              nextParams.set('confirmed', '1');
              if (confirmedEmail) {
                nextParams.set('email', confirmedEmail);
              }
              if (callbackInfo.errorDescription) {
                nextParams.set('error_description', callbackInfo.errorDescription);
              }
              const nextUrl = `/login?${nextParams.toString()}`;
              window.history.replaceState({}, '', nextUrl);
              window.dispatchEvent(new PopStateEvent('popstate'));
            }
          } else if (
            callbackInfo.isRecoveryRedirect ||
            (typeof window !== 'undefined' &&
              window.location.pathname.replace(/\/+$/, '') === '/reset-password' &&
              Boolean(sessionData.session?.access_token))
          ) {
            const emailHint = (sessionData.session?.user?.email || callbackInfo.emailFromUrl || '').trim().toLowerCase() || null;
            setRecoveryState(Boolean(sessionData.session), emailHint);
            if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') !== '/reset-password') {
              window.history.replaceState({}, '', '/reset-password');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }
          } else if (sessionData.session?.access_token) {
            try {
              await syncSupabaseSession(sb, cfgRes, sessionData.session);
            } catch {
              await sb.auth.signOut().catch(() => {});
              api.setToken(null);
              if (active) setUser(meRes.user || null);
            }
          } else if (meRes.user) {
            setUser(meRes.user);
          }

          const { data: authListener } = sb.auth.onAuthStateChange((event, nextSession) => {
            if (!active) return;
            if (event === 'PASSWORD_RECOVERY') {
              const emailHint = (nextSession?.user?.email || '').trim().toLowerCase() || null;
              setRecoveryState(true, emailHint);
              if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') !== '/reset-password') {
                window.history.replaceState({}, '', '/reset-password');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }
              return;
            }
            if (event === 'SIGNED_OUT') {
              if (!authActionInFlightRef.current) {
                api.setToken(null);
                setUser(null);
                setRecoveryState(false, null);
              }
              return;
            }
            if (
              (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') &&
              nextSession?.access_token &&
              !authActionInFlightRef.current
            ) {
              const currentCallback = readConfirmationCallbackFromLocation();
              if (currentCallback.isConfirmationRedirect || currentCallback.isRecoveryRedirect || isRecoveryModeRef.current) {
                return;
              }
              void syncSupabaseSession(sb, publicConfigRef.current, nextSession)
                .then(() => {
                  void refreshAdminBootstrap();
                })
                .catch(() => {
                  // Leave existing state untouched if sync fails transiently
                });
            }
          });
          subscription = authListener.subscription;
        } else if (meRes.user) {
          setUser(meRes.user);
        }
      } finally {
        if (active) setInitialized(true);
      }
    };

    void bootstrap();
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [refreshAdminBootstrap, setRecoveryState, setResolvedPublicConfig, syncSupabaseSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<UserProfile> => {
      const cleanEmail = email.trim().toLowerCase();
      if (!isValidEmailFormat(cleanEmail)) {
        throw new Error('Please enter a valid email address.');
      }
      if (!password) {
        throw new Error('Please enter your password.');
      }

      setLoading(true);
      authActionInFlightRef.current = true;
      try {
        const { sb, cfg } = await resolveSupabaseWithConfig();
        if (sb) {
          const { data, error } = await sb.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });
          if (error) {
            throw new Error(formatSupabaseAuthError(error, 'login'));
          }
          if (!data.session || !data.user) {
            throw new Error('Unable to establish an authenticated Supabase session.');
          }
          const syncedUser = await syncSupabaseSession(sb, cfg, data.session);
          void refreshAdminBootstrap();
          return syncedUser;
        }

        const res = await api.post<{ user: UserProfile; token: string }>('/api/auth/login', {
          email: cleanEmail,
          password,
        });
        if (res.token) api.setToken(res.token);
        setUser(res.user);
        return res.user;
      } finally {
        authActionInFlightRef.current = false;
        setLoading(false);
      }
    },
    [refreshAdminBootstrap, resolveSupabaseWithConfig, syncSupabaseSession]
  );

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
    async (payload: RegisterPayload): Promise<RegisterOutcome> => {
      const cleanName = payload.name.trim();
      const cleanEmail = payload.email.trim().toLowerCase();
      if (cleanName.length < 2 || cleanName.length > 80) {
        throw new Error('Full name must be between 2 and 80 characters.');
      }
      if (!isValidEmailFormat(cleanEmail)) {
        throw new Error('Please enter a valid email address.');
      }
      if (payload.password.length < 8) {
        throw new Error('Password must be at least 8 characters long.');
      }

      setLoading(true);
      authActionInFlightRef.current = true;
      try {
        const { sb, cfg } = await resolveSupabaseWithConfig();
        if (sb) {
          // Verify role/teacher/admin eligibility on backend before creating Supabase Auth user
          await api.post('/api/auth/check-registration', {
            role: payload.role,
            setupSecret: payload.setupSecret,
          });

          const { data, error } = await sb.auth.signUp({
            email: cleanEmail,
            password: payload.password,
            options: {
              emailRedirectTo: buildConfirmationRedirectUrl(cleanEmail),
              data: {
                full_name: cleanName,
                name: cleanName,
                role: payload.role,
                institution: (payload.institution || '').trim(),
                ...(payload.role === 'teacher'
                  ? {
                      subject: (payload.subject || '').trim(),
                      bio: (payload.bio || '').trim(),
                    }
                  : {}),
              },
            },
          });

          if (error) {
            throw new Error(formatSupabaseAuthError(error, 'register'));
          }

          // Supabase returns an empty identities array when email enumeration protection hides duplicate signups
          if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            throw new Error('An account with this email already exists. Please sign in or reset your password.');
          }

          if (data.session && data.user) {
            const syncedUser = await syncSupabaseSession(sb, cfg, data.session, {
              name: cleanName,
              role: payload.role,
              institution: payload.institution,
              subject: payload.subject,
              bio: payload.bio,
              setupSecret: payload.setupSecret,
            });
            void refreshAdminBootstrap();
            return { user: syncedUser };
          }

          try {
            window.sessionStorage.setItem(PENDING_CONFIRM_EMAIL_KEY, cleanEmail);
          } catch {
            // Ignore storage access errors
          }

          void refreshAdminBootstrap();
          return {
            user: null,
            confirmationRequired: true,
            message: `Account created for ${cleanEmail}. Please check your email and click the confirmation link before signing in.`,
          };
        }

        const res = await api.post<{ user: UserProfile; token: string }>('/api/auth/register', {
          ...payload,
          name: cleanName,
          email: cleanEmail,
        });
        if (res.token) api.setToken(res.token);
        setUser(res.user);
        void refreshAdminBootstrap();
        return { user: res.user };
      } finally {
        authActionInFlightRef.current = false;
        setLoading(false);
      }
    },
    [refreshAdminBootstrap, resolveSupabaseWithConfig, syncSupabaseSession]
  );

  const claimAdmin = useCallback(
    async (payload: ClaimAdminPayload): Promise<RegisterOutcome> => {
      const { sb } = await resolveSupabaseWithConfig();
      if (sb) {
        return register({
          name: payload.name,
          email: payload.email,
          password: payload.password,
          role: 'admin',
          institution: payload.institution || 'ExamAI Administration',
        });
      }

      setLoading(true);
      try {
        const res = await api.post<{ user: UserProfile; token: string }>('/api/auth/claim-admin', payload);
        if (res.token) api.setToken(res.token);
        setUser(res.user);
        void refreshAdminBootstrap();
        return { user: res.user };
      } finally {
        setLoading(false);
      }
    },
    [refreshAdminBootstrap, register, resolveSupabaseWithConfig]
  );

  const resendConfirmation = useCallback(
    async (email: string): Promise<string> => {
      const cleanEmail = email.trim().toLowerCase();
      if (!isValidEmailFormat(cleanEmail)) {
        throw new Error('Enter your valid email address first.');
      }
      const { sb } = await resolveSupabaseWithConfig();
      if (!sb) {
        throw new Error('Email confirmation resend is only used with Supabase Auth.');
      }
      const { error } = await sb.auth.resend({
        type: 'signup',
        email: cleanEmail,
        options: {
          emailRedirectTo: buildConfirmationRedirectUrl(cleanEmail),
        },
      });
      if (error) {
        throw new Error(formatSupabaseAuthError(error, 'general'));
      }
      try {
        window.sessionStorage.setItem(PENDING_CONFIRM_EMAIL_KEY, cleanEmail);
      } catch {
        // Ignore storage access errors
      }
      return `Verification email resent to ${cleanEmail}. Check your inbox and spam folder.`;
    },
    [resolveSupabaseWithConfig]
  );

  const logout = useCallback(async () => {
    authActionInFlightRef.current = true;
    try {
      const { sb } = await resolveSupabaseWithConfig();
      if (sb) {
        await sb.auth.signOut().catch(() => {});
      }
      try {
        await api.post('/api/auth/logout');
      } catch {
        // Clear local session regardless
      }
      api.setToken(null);
      setUser(null);
    } finally {
      authActionInFlightRef.current = false;
    }
  }, [resolveSupabaseWithConfig]);

  const forgotPassword = useCallback(
    async (email: string) => {
      const cleanEmail = email.trim().toLowerCase();
      if (!isValidEmailFormat(cleanEmail)) {
        throw new Error('Please enter a valid email address.');
      }

      setLoading(true);
      try {
        const { sb } = await resolveSupabaseWithConfig();
        if (sb) {
          const redirectTo =
            typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
          const { error } = await sb.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
          if (error) {
            throw new Error(formatSupabaseAuthError(error, 'general'));
          }
          return {
            ok: true,
            message: `If an account exists for ${cleanEmail}, a password reset link has been sent. Please check your inbox and spam folder.`,
          };
        }

        return await api.post<{ ok: boolean; message: string; resetPreviewToken?: string }>(
          '/api/auth/forgot-password',
          { email: cleanEmail }
        );
      } finally {
        setLoading(false);
      }
    },
    [resolveSupabaseWithConfig]
  );

  const resetPassword = useCallback(
    async (token: string, newPassword: string) => {
      if (newPassword.length < 8) {
        throw new Error('New password must be at least 8 characters long.');
      }

      setLoading(true);
      authActionInFlightRef.current = true;
      try {
        const { sb } = await resolveSupabaseWithConfig();
        if (sb) {
          const { data: sessionData } = await sb.auth.getSession();
          if (sessionData.session || isRecoveryModeRef.current) {
            const userEmail = (sessionData.session?.user?.email || recoveryEmail || '').trim().toLowerCase();
            const { error } = await sb.auth.updateUser({ password: newPassword });
            if (error) {
              throw new Error(formatSupabaseAuthError(error, 'general'));
            }
            await sb.auth.signOut({ scope: 'local' }).catch(() => {});
            await api.post('/api/auth/logout').catch(() => {});
            api.setToken(null);
            setUser(null);
            setRecoveryState(false, null);
            return {
              ok: true,
              email: userEmail || undefined,
              message: 'Password updated successfully. You may now sign in with your new password.',
            };
          }
        }

        return await api.post<{ ok: boolean; message: string }>('/api/auth/reset-password', {
          token,
          newPassword,
        });
      } finally {
        authActionInFlightRef.current = false;
        setLoading(false);
      }
    },
    [recoveryEmail, resolveSupabaseWithConfig, setRecoveryState]
  );

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

      const { sb, cfg } = await resolveSupabaseWithConfig();
      if (sb && cfg.supabaseUrl && cfg.supabaseAnonKey) {
        const { data: sessionData } = await sb.auth.getSession();
        if (sessionData.session?.access_token && sessionData.session.user) {
          if (typeof patch.name === 'string' && patch.name.trim()) {
            await sb.auth
              .updateUser({ data: { full_name: patch.name.trim(), name: patch.name.trim() } })
              .catch(() => {});
          }
          await updateOwnSupabaseProfile({
            supabase: sb,
            supabaseUrl: cfg.supabaseUrl,
            supabaseAnonKey: cfg.supabaseAnonKey,
            accessToken: sessionData.session.access_token,
            authUser: sessionData.session.user,
            patch: {
              name: patch.name,
              institution: patch.institution,
              avatarUrl: patch.avatarUrl,
            },
          });
        }
      }

      return res.user;
    },
    [resolveSupabaseWithConfig]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        initialized,
        loading,
        isRecoveryMode,
        recoveryEmail,
        publicConfig,
        adminBootstrap,
        refreshUser,
        refreshAdminBootstrap,
        login,
        demoLogin,
        register,
        claimAdmin,
        resendConfirmation,
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
