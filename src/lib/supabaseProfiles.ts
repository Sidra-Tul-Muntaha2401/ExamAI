import type { SupabaseClient, User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { UserRole } from '../types/index';

export interface SupabaseProfileSyncInput {
  supabase: SupabaseClient;
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken: string;
  authUser: SupabaseAuthUser;
  fullName?: string;
  role?: UserRole;
  institution?: string;
  avatarUrl?: string;
}

export interface SupabaseProfileRow {
  id?: string;
  fullName?: string;
  email?: string;
  role?: UserRole;
  institution?: string;
  avatarUrl?: string;
}

const discoveredProfileColumns = new Map<string, Set<string>>();

export function formatSupabaseAuthError(
  error: { message?: string; code?: string; status?: number } | null | undefined,
  context: 'login' | 'register' | 'general' = 'general'
): string {
  const msg = (error?.message || '').trim();
  const code = (error?.code || '').toLowerCase();
  const lower = msg.toLowerCase();

  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    lower.includes('already registered') ||
    lower.includes('already exists') ||
    lower.includes('duplicate')
  ) {
    return 'An account with this email already exists. Please sign in or reset your password.';
  }

  if (
    code === 'email_not_confirmed' ||
    lower.includes('email not confirmed') ||
    lower.includes('confirm your email')
  ) {
    return 'Please confirm your email address using the verification link sent to your inbox before signing in.';
  }

  if (
    code === 'invalid_credentials' ||
    lower.includes('invalid login credentials') ||
    lower.includes('invalid password')
  ) {
    return 'Incorrect email or password. Please verify your credentials and try again.';
  }

  if (
    code === 'validation_failed' ||
    code === 'email_address_invalid' ||
    lower.includes('invalid format') ||
    lower.includes('invalid email') ||
    lower.includes('unable to validate email')
  ) {
    return 'Please enter a valid email address.';
  }

  if (code === 'weak_password' || lower.includes('password should be at least')) {
    return msg || 'Password must be at least 8 characters long.';
  }

  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    error?.status === 429 ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return 'Too many attempts. Please wait a moment before trying again.';
  }

  if (code === 'signup_disabled' || lower.includes('signups not allowed')) {
    return 'New registrations are currently disabled in Supabase Auth settings.';
  }

  if (msg) return msg;
  return context === 'register'
    ? 'Registration failed. Please try again.'
    : context === 'login'
      ? 'Unable to sign in. Please try again.'
      : 'Authentication request failed.';
}

async function inspectProfilesColumns(
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string
): Promise<Set<string> | null> {
  const cached = discoveredProfileColumns.get(supabaseUrl);
  if (cached && cached.size > 0) {
    return cached;
  }

  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/openapi+json, application/json',
      },
    });
    if (!res.ok) return null;
    const spec = (await res.json()) as {
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
      components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
    };
    const props =
      spec.definitions?.profiles?.properties ||
      spec.components?.schemas?.profiles?.properties ||
      null;
    if (!props) return null;
    const cols = new Set(Object.keys(props));
    if (cols.size > 0) {
      discoveredProfileColumns.set(supabaseUrl, cols);
      return cols;
    }
    return null;
  } catch {
    return null;
  }
}

function mapRawProfileRow(row: Record<string, unknown> | null): SupabaseProfileRow | null {
  if (!row) return null;
  const rawRole = typeof row.role === 'string' ? row.role.toLowerCase() : '';
  const role: UserRole | undefined =
    rawRole === 'admin' || rawRole === 'teacher' || rawRole === 'student' ? rawRole : undefined;

  return {
    id: row.id ? String(row.id) : undefined,
    fullName:
      typeof row.full_name === 'string' && row.full_name.trim()
        ? row.full_name.trim()
        : typeof row.name === 'string' && row.name.trim()
          ? row.name.trim()
          : undefined,
    email: typeof row.email === 'string' ? row.email.trim().toLowerCase() : undefined,
    role,
    institution: typeof row.institution === 'string' ? row.institution : undefined,
    avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : undefined,
  };
}

function buildMatchingProfilePayload(
  cols: Set<string> | null,
  input: {
    authUserId: string;
    fullName: string;
    email: string;
    role: UserRole;
    institution: string;
    avatarUrl: string;
    now: string;
    isInsert: boolean;
  }
): Record<string, unknown> {
  if (cols && cols.size > 0) {
    const payload: Record<string, unknown> = {};
    if (input.isInsert && cols.has('id')) payload.id = input.authUserId;
    if (cols.has('auth_user_id')) payload.auth_user_id = input.authUserId;
    if (cols.has('user_id') && input.isInsert) payload.user_id = input.authUserId;
    if (cols.has('full_name')) payload.full_name = input.fullName;
    if (cols.has('name')) payload.name = input.fullName;
    if (cols.has('email')) payload.email = input.email;
    if (cols.has('role') && input.isInsert) payload.role = input.role;
    if (cols.has('institution') && input.institution) payload.institution = input.institution;
    if (cols.has('avatar_url') && input.avatarUrl) payload.avatar_url = input.avatarUrl;
    if (cols.has('account_status') && input.isInsert) payload.account_status = 'active';
    if (cols.has('created_at') && input.isInsert) payload.created_at = input.now;
    if (cols.has('updated_at')) payload.updated_at = input.now;
    if (cols.has('last_login_at')) payload.last_login_at = input.now;
    return payload;
  }

  // Fallback minimal schema when OpenAPI schema introspection is disabled
  if (input.isInsert) {
    return {
      id: input.authUserId,
      full_name: input.fullName,
      email: input.email,
      role: input.role,
    };
  }
  return {
    full_name: input.fullName,
  };
}

export async function ensureOwnSupabaseProfile(
  input: SupabaseProfileSyncInput
): Promise<SupabaseProfileRow | null> {
  const { supabase, supabaseUrl, supabaseAnonKey, accessToken, authUser } = input;
  const meta = (authUser.user_metadata || {}) as Record<string, unknown>;
  const cleanEmail = (authUser.email || '').trim().toLowerCase();
  const cleanName =
    (input.fullName || '').trim() ||
    (typeof meta.full_name === 'string' ? meta.full_name.trim() : '') ||
    (typeof meta.name === 'string' ? meta.name.trim() : '') ||
    (cleanEmail ? cleanEmail.split('@')[0] : 'Student');
  const rawRole = input.role || (typeof meta.role === 'string' ? meta.role.toLowerCase() : 'student');
  const safeRole: UserRole = rawRole === 'admin' ? 'admin' : rawRole === 'teacher' ? 'teacher' : 'student';
  const institution =
    (input.institution ?? (typeof meta.institution === 'string' ? meta.institution : '')).trim();
  const avatarUrl =
    (input.avatarUrl ?? (typeof meta.avatar_url === 'string' ? meta.avatar_url : '')).trim();
  const now = new Date().toISOString();

  const cols = await inspectProfilesColumns(supabaseUrl, supabaseAnonKey, accessToken);
  const keyColumn = cols && !cols.has('id') && cols.has('user_id') ? 'user_id' : 'id';

  // 1. Read only the authenticated user's own profile row (RLS-enforced)
  let existingRow: Record<string, unknown> | null = null;
  const firstLookup = await supabase
    .from('profiles')
    .select('*')
    .eq(keyColumn, authUser.id)
    .maybeSingle();

  if (!firstLookup.error && firstLookup.data) {
    existingRow = firstLookup.data as Record<string, unknown>;
  } else if (cols?.has('auth_user_id')) {
    const byAuthId = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    if (!byAuthId.error && byAuthId.data) {
      existingRow = byAuthId.data as Record<string, unknown>;
    }
  }

  if (existingRow) {
    const existingCols = cols || new Set(Object.keys(existingRow));
    const mapped = mapRawProfileRow(existingRow);
    const updatePayload: Record<string, unknown> = {};
    if (existingCols.has('full_name') && !mapped?.fullName && cleanName) updatePayload.full_name = cleanName;
    if (existingCols.has('name') && !existingRow.name && cleanName) updatePayload.name = cleanName;
    if (existingCols.has('email') && !mapped?.email && cleanEmail) updatePayload.email = cleanEmail;
    if (existingCols.has('updated_at')) updatePayload.updated_at = now;
    if (existingCols.has('last_login_at')) updatePayload.last_login_at = now;

    if (Object.keys(updatePayload).length > 0) {
      const targetCol = existingRow.id ? 'id' : keyColumn;
      const targetVal = existingRow.id ? String(existingRow.id) : authUser.id;
      await supabase.from('profiles').update(updatePayload).eq(targetCol, targetVal);
    }
    return mapped;
  }

  // 2. Insert the user's own profile record using the authenticated user ID
  const fullPayload = buildMatchingProfilePayload(cols, {
    authUserId: authUser.id,
    fullName: cleanName,
    email: cleanEmail,
    role: safeRole,
    institution,
    avatarUrl,
    now,
    isInsert: true,
  });

  const candidatePayloads: Array<Record<string, unknown>> = [fullPayload];
  if (!cols) {
    // Progressive column fallbacks only if OpenAPI schema introspection was unavailable
    candidatePayloads.push(
      { id: authUser.id, full_name: cleanName, email: cleanEmail },
      { id: authUser.id, full_name: cleanName },
      { id: authUser.id, name: cleanName, email: cleanEmail },
      { id: authUser.id }
    );
  }

  for (const candidate of candidatePayloads) {
    const { data: inserted, error } = await supabase
      .from('profiles')
      .upsert(candidate, { onConflict: keyColumn })
      .select('*')
      .maybeSingle();

    if (!error) {
      return mapRawProfileRow((inserted as Record<string, unknown> | null) ?? candidate);
    }

    // Stop retrying if the error is RLS/permission rather than missing column
    const msgLower = (error.message || '').toLowerCase();
    const isColumnMismatch =
      error.code === 'PGRST204' ||
      error.code === '42703' ||
      msgLower.includes('could not find') ||
      msgLower.includes('column');
    if (!isColumnMismatch) {
      console.warn('Supabase profiles upsert warning:', error.message);
      break;
    }
  }

  return null;
}

export async function updateOwnSupabaseProfile(
  input: SupabaseProfileSyncInput & {
    patch: { name?: string; institution?: string; avatarUrl?: string };
  }
): Promise<void> {
  const { supabase, supabaseUrl, supabaseAnonKey, accessToken, authUser, patch } = input;
  const cols = await inspectProfilesColumns(supabaseUrl, supabaseAnonKey, accessToken);
  const keyColumn = cols && !cols.has('id') && cols.has('user_id') ? 'user_id' : 'id';
  const now = new Date().toISOString();

  const updateData: Record<string, unknown> = {};
  if (typeof patch.name === 'string' && patch.name.trim()) {
    if (!cols || cols.has('full_name')) updateData.full_name = patch.name.trim();
    if (cols?.has('name')) updateData.name = patch.name.trim();
  }
  if (typeof patch.institution === 'string' && (!cols || cols.has('institution'))) {
    updateData.institution = patch.institution.trim();
  }
  if (typeof patch.avatarUrl === 'string' && (!cols || cols.has('avatar_url'))) {
    updateData.avatar_url = patch.avatarUrl.trim();
  }
  if (!cols || cols.has('updated_at')) {
    updateData.updated_at = now;
  }

  if (Object.keys(updateData).length === 0) return;
  const { error } = await supabase.from('profiles').update(updateData).eq(keyColumn, authUser.id);
  if (error) {
    console.warn('Supabase profiles update warning:', error.message);
  }
}
