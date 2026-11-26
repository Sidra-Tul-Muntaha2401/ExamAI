import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;
let cachedKey = '';

export function getBrowserSupabaseClient(url?: string | null, anonKey?: string | null): SupabaseClient | null {
  const env = typeof import.meta !== 'undefined' ? (import.meta.env as Record<string, string | undefined> | undefined) : undefined;
  const envUrl = env?.VITE_SUPABASE_URL;
  const envKey =
    env?.VITE_SUPABASE_ANON_KEY ||
    env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env?.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

  const finalUrl = (url || envUrl || '').trim();
  const finalKey = (anonKey || envKey || '').trim();

  if (!finalUrl || !finalKey || !/^https?:\/\//i.test(finalUrl)) {
    return null;
  }

  const cacheIdentity = `${finalUrl}::${finalKey}`;
  if (cachedClient && cachedKey === cacheIdentity) {
    return cachedClient;
  }

  cachedClient = createClient(finalUrl, finalKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  cachedKey = cacheIdentity;
  return cachedClient;
}
