import React, { Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';

/**
 * Which page `/login` shows. Staticbot sets VITE_STATICBOT_SIGN_IN per deployment from the project's
 * sign-in choice: 'app' = the app's own sign-in page, anything else (or unset) = this page. The same
 * commit serves previews and live sites; only the build variable differs. Read defensively: a build
 * without Vite's import.meta.env (tests, other bundlers) gets this page.
 */
export function staticbotSignInChoice() {
  try {
    return import.meta.env.VITE_STATICBOT_SIGN_IN === 'app' ? 'app' : 'code';
  } catch {
    return 'code';
  }
}

function normalisedPath(pathname) {
  return (pathname || '/').replace(/\/+$/, '') || '/';
}

// The app's own page usually comes from React.lazy(); here it renders above the app's own
// Suspense boundary, so it needs one of its own.
function AppSignIn({ page }) {
  return <Suspense fallback={null}>{page}</Suspense>;
}

// Keep the entry point above the app's auth/business gates. Registering a Route inside an
// AuthenticatedApp that returns null for auth_required leaves /login unreachable (VineDay).
//
// Fixed paths, identical on every branch: /login-code is always this page; /login-password is always
// the app's own sign-in page (when the migration found one, passed in as `appSignIn`); /login shows
// the project's choice. Both render here, above the gates, for the same reason.
export function StaticbotLoginBoundary({ appSignIn, children }) {
  const path = normalisedPath(useLocation().pathname);
  if (path === '/login-code') {
    return <LoginPage />;
  }
  if (appSignIn && path === '/login-password') {
    return <AppSignIn page={appSignIn} />;
  }
  if (path === '/login') {
    return appSignIn && staticbotSignInChoice() === 'app' ? <AppSignIn page={appSignIn} /> : <LoginPage />;
  }
  return <>{children}</>;
}

/**
 * Self-hosted replacement for Base44's hosted /login page.
 *
 * Base44 apps redirect unauthenticated users to `/login?next=<path>` (see the shim's
 * `auth.redirectToLogin`). On base44.app that page was hosted by the platform; a migrated app has no
 * such route, so React Router falls through to "Page Not Found". This component is injected by the
 * migration and wired to `/login` (outside the app Layout, which would otherwise re-trigger the
 * redirect and loop).
 *
 * Auth path: passwordless email OTP via the shim (`auth.sendLoginOtp` / `auth.verifyLoginOtp`).
 * Imported Base44 users have no password and no OAuth identity, so email OTP is the login method that
 * works for them out of the box. The emailed message contains both a magic link (click → returns to
 * `next`, session auto-detected) and a 6-digit code (enter below — needs no redirect allowlist).
 *
 * Look: the app's own theme. Base44 apps are shadcn/Tailwind and define their palette as CSS custom
 * properties (`--background`, `--card`, `--primary`, …), as HSL triplets or full colors; this page
 * reads them at mount and falls back to a neutral palette when one is missing. Fonts are inherited,
 * and the heading uses `--font-heading` when the app defines it.
 *
 * Google OAuth credentials are configured on the self-hosted GoTrue service; list enabled providers
 * here to render their "Continue with …" buttons.
 */
const OAUTH_PROVIDERS = ['google'];

const PROVIDER_LABEL = { google: 'Google', azure: 'Microsoft', github: 'GitHub' };

function getNext() {
  if (typeof window === 'undefined') return '/';
  const params = new URLSearchParams(window.location.search);
  // `next` comes from the shim's redirectToLogin; `returnTo` / `from_url` from the login gates Base44's
  // TanStack Start scaffold ships (they send both).
  const raw = params.get('next') || params.get('returnTo') || params.get('from_url');
  if (!raw) return '/';
  // Open-redirect guard: resolve the value the way the browser will navigate to it and keep it only
  // when the RESULT is this origin. A prefix check on the raw string is not enough — `/\evil.com`,
  // tabs/newlines and other forms normalize to another origin.
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

// Base44 scaffolds ship `<title>Base44 APP</title>`; the switchover renames it when discovery knew
// the app's name. Anything still on the placeholder gets a generic heading, never "Base44 APP".
const PLACEHOLDER_TITLE = /^\s*base44(\s+app)?\s*$/i;

function appName() {
  const title = typeof document !== 'undefined' ? document.title : '';
  return title && !PLACEHOLDER_TITLE.test(title) ? title : null;
}

// The app's icon (the switchover moves it off media.base44.com), shown instead of the initial.
function appIcon() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
  const link = document.querySelector('link[rel~="icon"]');
  return link && link.href ? link.href : null;
}

// shadcn writes a color either as an HSL triplet ("37 46% 95%", used as hsl(var(--x))) or, on newer
// scaffolds, as a full color ("oklch(1 0 0)", "#fff"). Anything else is not a color we can use.
const HSL_TRIPLET = /^-?[\d.]+(deg|rad|turn)?\s+[\d.]+%\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/;
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\()/i;

const FALLBACK = {
  background: '#f7f8fa',
  card: '#ffffff',
  cardForeground: '#0f172a',
  mutedForeground: '#64748b',
  border: '#e5e7eb',
  input: '#e5e7eb',
  primary: '#0f172a',
  primaryForeground: '#ffffff',
  accent: '#eef2ff',
  destructive: '#dc2626',
};

const THEME_VARS = {
  background: '--background',
  card: '--card',
  cardForeground: '--card-foreground',
  mutedForeground: '--muted-foreground',
  border: '--border',
  input: '--input',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  accent: '--secondary',
  destructive: '--destructive',
};

function appPalette() {
  const palette = { ...FALLBACK };
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function'
      || typeof document === 'undefined' || !document.documentElement) {
    return palette;
  }
  const style = window.getComputedStyle(document.documentElement);
  for (const [key, name] of Object.entries(THEME_VARS)) {
    const raw = (style.getPropertyValue(name) || '').trim();
    if (HSL_TRIPLET.test(raw)) palette[key] = `hsl(${raw})`;
    else if (COLOR_VALUE.test(raw)) palette[key] = raw;
  }
  return palette;
}

export default function LoginPage() {
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [palette] = useState(appPalette);
  const [icon, setIcon] = useState(appIcon);
  const next = getNext();
  const name = appName();
  const S = styles(palette);

  // Already signed in (e.g. landed here after a magic-link redirect) → leave immediately.
  useEffect(() => {
    let cancelled = false;
    base44.auth.isAuthenticated().then((yes) => {
      if (yes && !cancelled) window.location.assign(next);
    });
    return () => { cancelled = true; };
  }, [next]);

  const sendCode = async (e) => {
    e?.preventDefault();
    setError(null);
    if (!email) { setError('Enter your email address.'); return; }
    setBusy(true);
    try {
      await base44.auth.sendLoginOtp(email, next);
      setStep('code');
      setNotice(`We emailed a sign-in link and a verification code to ${email}.`);
    } catch (err) {
      setError(err?.message || 'Could not send the code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e?.preventDefault();
    setError(null);
    if (!code) { setError('Enter the verification code from your email.'); return; }
    setBusy(true);
    try {
      await base44.auth.verifyLoginOtp(email, code.trim());
      window.location.assign(next); // full reload so AuthContext picks up the new session
    } catch (err) {
      setError(err?.message || 'That code is invalid or expired. Request a new one.');
    } finally {
      setBusy(false);
    }
  };

  const oauth = async (provider) => {
    setError(null);
    try {
      // Azure requires email explicitly; older shims only pass redirectTo. Use their public client.
      const { error } = await base44.supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin + next,
          scopes: provider === 'azure' ? 'email' : undefined,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err?.message || `Could not start ${PROVIDER_LABEL[provider] || provider} sign-in.`);
    }
  };

  const passwordLogin = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      await base44.auth.signIn({ email: email.trim(), password });
      // shim sets session; redirect to next
      const next = getNext();
      window.location.assign(next);
    } catch (err) {
      setError(err?.message || 'Invalid email or password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.avatar}>
          {icon
            ? <img src={icon} alt="" style={S.icon} onError={() => setIcon(null)} />
            : (name || '').trim().charAt(0).toUpperCase() || '•'}
        </div>
        <h1 style={S.title}>{name ? `Welcome to ${name}` : 'Welcome'}</h1>
        <p style={S.subtitle}>Sign in to continue</p>

        {OAUTH_PROVIDERS.length > 0 && (
          <>
            {OAUTH_PROVIDERS.map((p) => (
              <button key={p} type="button" style={S.oauthBtn} onClick={() => oauth(p)} disabled={busy}>
                Continue with {PROVIDER_LABEL[p] || p}
              </button>
            ))}
            <div style={S.divider}><span style={S.dividerText}>OR</span></div>
          </>
        )}

        {step === 'email' ? (
          <form onSubmit={sendCode}>
            <label style={S.label} htmlFor="sb-login-email">Email</label>
            <input
              id="sb-login-email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={S.input}
            />
            <button type="submit" style={S.primaryBtn} disabled={busy}>
              {busy ? 'Sending…' : 'Email me a sign-in code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <label style={S.label} htmlFor="sb-login-code">Verification code</label>
            <input
              id="sb-login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="Enter the code from your email"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ ...S.input, letterSpacing: '0.3em', textAlign: 'center' }}
            />
            <button type="submit" style={S.primaryBtn} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" style={S.linkBtn} onClick={() => { setStep('email'); setNotice(null); setCode(''); }}>
              Use a different email
            </button>
          </form>
        )}

        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border, #e5e7eb)' }}>
          <p style={{ ...S.subtitle, marginBottom: '8px' }}>Or sign in with password</p>
          <form onSubmit={passwordLogin}>
            <label style={S.label} htmlFor="sb-login-password-email">Email</label>
            <input
              id="sb-login-password-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={S.input}
            />
            <label style={S.label} htmlFor="sb-login-password">Password</label>
            <input
              id="sb-login-password"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={S.input}
            />
            <button type="submit" style={S.primaryBtn} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in with password'}
            </button>
          </form>
        </div>

        {notice && <p style={S.notice}>{notice}</p>}
        {error && <p style={S.error}>{error}</p>}
      </div>
    </div>
  );
}

// Radius and heading font come straight from the app's variables, with a fallback when undefined.
function styles(c) {
  const radius = 'var(--radius, 0.5rem)';
  return {
    page: {
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', background: c.background, fontFamily: 'inherit',
    },
    card: {
      width: '100%', maxWidth: '400px', background: c.card, color: c.cardForeground,
      border: `1px solid ${c.border}`, borderRadius: `calc(${radius} + 6px)`,
      padding: '40px 36px', boxShadow: '0 10px 40px rgba(0,0,0,0.06)', textAlign: 'center',
      boxSizing: 'border-box',
    },
    avatar: {
      width: '64px', height: '64px', borderRadius: '50%', margin: '0 auto 20px', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: c.accent, color: c.primary, fontSize: '24px', fontWeight: 700,
    },
    icon: { width: '40px', height: '40px', objectFit: 'contain' },
    title: {
      fontSize: '24px', fontWeight: 700, margin: '0 0 4px', color: c.cardForeground,
      fontFamily: 'var(--font-heading, inherit)',
    },
    subtitle: { fontSize: '14px', margin: '0 0 24px', color: c.mutedForeground },
    label: { display: 'block', textAlign: 'left', fontSize: '13px', fontWeight: 600, margin: '0 0 6px', color: c.cardForeground },
    input: {
      width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: '15px',
      border: `1px solid ${c.input}`, borderRadius: radius, marginBottom: '16px',
      background: c.card, color: c.cardForeground, outline: 'none', fontFamily: 'inherit',
    },
    primaryBtn: {
      width: '100%', padding: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
      border: 'none', borderRadius: radius, background: c.primary, color: c.primaryForeground,
      fontFamily: 'inherit',
    },
    oauthBtn: {
      width: '100%', padding: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${c.border}`, borderRadius: radius, marginBottom: '12px',
      background: c.card, color: c.cardForeground, fontFamily: 'inherit',
    },
    linkBtn: {
      background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', marginTop: '14px',
      color: c.mutedForeground, textDecoration: 'underline', fontFamily: 'inherit',
    },
    divider: { position: 'relative', textAlign: 'center', margin: '20px 0' },
    dividerText: {
      position: 'relative', background: c.card, padding: '0 12px', fontSize: '12px', color: c.mutedForeground,
    },
    notice: { fontSize: '13px', marginTop: '16px', color: c.mutedForeground },
    error: { fontSize: '13px', marginTop: '16px', color: c.destructive },
  };
}
