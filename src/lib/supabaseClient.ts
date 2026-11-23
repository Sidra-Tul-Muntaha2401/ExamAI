import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;
let cachedKey = '';

export function getBrowserSupabaseClient(url?: string | null, anonKey?: string | null): SupabaseClient | null {
  const envUrl = typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_SUPABASE_URL as string | undefined) : undefined;
  const envKey =
    typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined) : undefined;

  const finalUrl = (url || envUrl || '').trim();
  const finalKey = (anonKey || envKey || '').trim();

  if (!finalUrl || !finalKey || !finalUrl.startsWith('http')) {
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
    },
  });
  cachedKey = cacheIdentity;
  return cachedClient;
}
