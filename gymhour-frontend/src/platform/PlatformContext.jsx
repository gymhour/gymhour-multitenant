import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import platformApi, { setPlatformCsrf } from './platformApi';

const PlatformContext = createContext(null);

export function PlatformProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await platformApi.get('/platform/auth/me');
      setPlatformCsrf(data.csrfToken); setUser(data.user); return data.user;
    } catch { setPlatformCsrf(''); setUser(null); return null; }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener('platform-session-expired', expired);
    return () => window.removeEventListener('platform-session-expired', expired);
  }, []);
  const completeLogin = useCallback(data => { setPlatformCsrf(data.csrfToken); setUser(data.user); }, []);
  const logout = useCallback(async () => {
    try { await platformApi.post('/platform/auth/logout'); } finally { setPlatformCsrf(''); setUser(null); }
  }, []);
  const value = useMemo(() => ({ user, loading, refresh, completeLogin, logout }), [user, loading, refresh, completeLogin, logout]);
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export const usePlatformAuth = () => useContext(PlatformContext);
