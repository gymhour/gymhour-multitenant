import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import apiClient from '../axiosConfig';
import { setAuthSnapshot } from '../authSession';
import CLIENT_SETUP from '../setup';

const AuthContext = createContext(null);

const darkenHex = (hex, amount = 0.16) => {
  const value = hex.slice(1);
  const channel = offset => Math.max(0, Math.round(parseInt(value.slice(offset, offset + 2), 16) * (1 - amount)))
    .toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
};

const applyBrandColor = color => {
  const root = document.documentElement.style;
  root.setProperty('--primary-color', color);
  root.setProperty('--primary-color-hover', darkenHex(color));
  root.setProperty('--background-hover-color', `${color}26`);
};

export const HOME_BY_ROLE = {
  ADMIN: '/admin/inicio',
  TRAINER: '/entrenador/inicio',
  STUDENT: '/alumno/inicio',
};

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('token')));

  const refresh = useCallback(async () => {
    if (!localStorage.getItem('token')) { setSession(null); setLoading(false); return null; }
    try {
      const { data } = await apiClient.get('/auth/me');
      setSession(data);
      setAuthSnapshot(data);
      return data;
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        localStorage.removeItem('token');
        setSession(null);
        setAuthSnapshot(null);
      }
      return null;
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!session || !localStorage.getItem('token')) return undefined;
    const onFocus = () => { refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('gymhour:subscription-required', onFocus);
    const interval = window.setInterval(refresh, 60_000);
    const dates = [session.tenant?.billing?.trialEndsAt, session.tenant?.billing?.paidUntil]
      .map(value => value ? new Date(value).getTime() : NaN)
      .filter(value => Number.isFinite(value) && value > Date.now());
    const nextBoundary = dates.length ? Math.min(...dates) : null;
    const timeout = nextBoundary === null ? null : window.setTimeout(refresh,
      Math.min(2_147_483_647, Math.max(0, nextBoundary - Date.now() + 100)));
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('gymhour:subscription-required', onFocus);
      window.clearInterval(interval);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [session, refresh]);

  useEffect(() => {
    const color = session?.tenant?.settings?.primaryColor;
    if (/^#[0-9A-Fa-f]{6}$/.test(color || '')) {
      applyBrandColor(color);
    } else {
      const fallback = CLIENT_SETUP.branding.theme;
      const root = document.documentElement.style;
      root.setProperty('--primary-color', fallback.primaryColor);
      root.setProperty('--primary-color-hover', fallback.primaryColorHover);
      root.setProperty('--background-hover-color', fallback.backgroundHoverColor);
    }
  }, [session?.tenant?.settings?.primaryColor]);

  const login = useCallback(async token => {
    localStorage.setItem('token', token);
    setLoading(true);
    return refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setSession(null);
    setAuthSnapshot(null);
  }, []);

  const value = useMemo(() => ({ session, user: session?.user, tenant: session?.tenant, loading, login, logout, refresh }),
    [session, loading, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return value;
};
