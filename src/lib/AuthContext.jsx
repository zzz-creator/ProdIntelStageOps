import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const AuthContext = createContext();
// Filled from the source app's visibility during migration. Explicit public routes still use
// the customer's router; protected routes rely on authError.type to redirect to /login.
const requiresAuthentication = true;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  useEffect(() => { checkAppState(); }, []);

  // Fetch the signed-in user. base44.auth.me() THROWS without a session, so this must only be
  // called once isAuthenticated() is known true (checkAppState gates it). Exposed on the context
  // because the newer stock scaffold's components call it directly after a login.
  const checkUserAuth = async () => {
    try {
      setIsLoadingAuth(true);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthError(null);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsAuthenticated(false);
      if (error?.status === 401 || error?.status === 403) {
        setAuthError({ type: 'auth_required', message: 'Authentication required' });
      }
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  const checkAppState = async () => {
    // Base44's hosted public-settings gate has no shim equivalent — auth flows through the
    // shim-backed base44.auth.* instead.
    try {
      setAuthError(null);
      // base44.auth.me() THROWS when there is no session; gate it behind the non-throwing
      // isAuthenticated() and preserve the stock router's auth_required redirect contract.
      if (await base44.auth.isAuthenticated()) {
        await checkUserAuth();
      } else {
        setUser(null);
        setIsAuthenticated(false);
        if (requiresAuthentication) {
          setAuthError({ type: 'auth_required', message: 'Authentication required' });
        }
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      if (error?.status === 401 || error?.status === 403) {
        setAuthError({ type: 'auth_required', message: 'Authentication required' });
      }
    }
  };

  // Base44's SDK exposed `auth.login(email, password)`; the shim's equivalent is
  // `auth.signIn({ email, password })`. Bridged here so a stock scaffold that destructures
  // `login` from the context keeps working unchanged after the swap.
  const login = async (email, password) => {
    await base44.auth.signIn({ email, password });
    await checkUserAuth();
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect) { base44.auth.logout(window.location.href); } else { base44.auth.logout(); }
  };

  const navigateToLogin = () => { base44.auth.redirectToLogin(window.location.href); };

  return (
    <AuthContext.Provider value={{
      user, isAuthenticated, isLoadingAuth, isLoadingPublicSettings,
      authError, authChecked, appPublicSettings, login, logout, navigateToLogin,
      checkUserAuth, checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) { throw new Error('useAuth must be used within an AuthProvider'); }
  return context;
};
