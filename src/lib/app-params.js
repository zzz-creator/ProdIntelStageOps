// Replaced during Base44 → Supabase migration by staticbot.
// The base44 client (src/api/base44Client) is now backed by the Supabase-compatible shim.
// This module used to read VITE_BASE44_* env vars — those are no longer set. Any code that
// still imports `appParams` gets an inert object rather than silently-undefined fields.
//
// `token` is the signed-in user's Supabase access token (null when signed out), read live
// from the Supabase session in localStorage: Base44's AuthContext only checks the session
// when `appParams.token` is set, so a constant null would keep every user logged out.
const readSupabaseAccessToken = () => {
  try {
    // Inside the try: reading window.localStorage itself throws when the browser blocks storage.
    const storage = typeof window === 'undefined' ? null : window.localStorage;
    if (!storage) return null;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const session = JSON.parse(storage.getItem(key) || 'null');
      if (session && typeof session.access_token === 'string') return session.access_token;
    }
  } catch {
    // Storage blocked or unparseable: treat as signed out.
  }
  return null;
};

export const appParams = {
  appId: null,
  get token() {
    return readSupabaseAccessToken();
  },
  functionsVersion: null,
  appBaseUrl: null,
  fromUrl: typeof window === 'undefined' ? null : window.location.href,
};

// Base44's TanStack Start scaffold reads the same values through getAppParams().
export function getAppParams() {
  return { appId: null, token: appParams.token, functionsVersion: null, appBaseUrl: null };
}
