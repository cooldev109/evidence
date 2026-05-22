import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { IntlProvider } from 'react-intl';
import { LOCALES, MESSAGES, resolveLocale, type Locale } from './i18n.ts';
import { clearToken, getToken } from './api.ts';
import { clearUserToken, getUserToken } from './user/userApi.ts';
import { Layout } from './components/Layout.tsx';
import { Login } from './screens/Login.tsx';
import { Dashboard } from './screens/Dashboard.tsx';
import { Events } from './screens/Events.tsx';
import { EventDetail } from './screens/EventDetail.tsx';
import { Reports } from './screens/Reports.tsx';
import { ApiKeys } from './screens/ApiKeys.tsx';
import { Settings } from './screens/Settings.tsx';
import { Audit } from './screens/Audit.tsx';
import { Users } from './screens/Users.tsx';
import { Captures } from './screens/Captures.tsx';
import { UserLayout } from './user/UserLayout.tsx';
import { UserLogin } from './user/UserLogin.tsx';
import { MinhasProvas } from './user/MinhasProvas.tsx';
import { Capture } from './user/Capture.tsx';
import { ProvaDetail } from './user/ProvaDetail.tsx';
import { AtaSign } from './user/AtaSign.tsx';

const LOCALE_KEY = 'evidence_locale';

export function App() {
  const [adminAuthed, setAdminAuthed] = useState<boolean>(() => !!getToken());
  const [userAuthed, setUserAuthed] = useState<boolean>(() => !!getUserToken());
  const [locale, setLocaleState] = useState<Locale>(() =>
    resolveLocale(localStorage.getItem(LOCALE_KEY)),
  );

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(LOCALE_KEY, l);
    setLocaleState(l);
  }, []);

  useEffect(() => {
    const onStorage = () => {
      setAdminAuthed(!!getToken());
      setUserAuthed(!!getUserToken());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const onAdminLogin = useCallback(
    (tenantLocale: string) => {
      if (!localStorage.getItem(LOCALE_KEY)) setLocale(resolveLocale(tenantLocale));
      setAdminAuthed(true);
    },
    [setLocale],
  );
  const onAdminLogout = useCallback(() => {
    clearToken();
    setAdminAuthed(false);
  }, []);

  const onUserLogin = useCallback(
    (tenantLocale: string) => {
      if (!localStorage.getItem(LOCALE_KEY)) setLocale(resolveLocale(tenantLocale));
      setUserAuthed(true);
    },
    [setLocale],
  );
  const onUserLogout = useCallback(() => {
    clearUserToken();
    setUserAuthed(false);
  }, []);

  return (
    <IntlProvider locale={locale} messages={MESSAGES[locale]} defaultLocale="pt-BR">
      <BrowserRouter>
        <Routes>
          {/* ---------- Admin panel (docas.ai/admin) ---------- */}
          <Route
            path="/admin/login"
            element={
              adminAuthed ? (
                <Navigate to="/admin" replace />
              ) : (
                <Login
                  onLogin={onAdminLogin}
                  locale={locale}
                  locales={LOCALES}
                  onLocale={setLocale}
                />
              )
            }
          />
          <Route
            path="/admin"
            element={
              adminAuthed ? (
                <Layout
                  locale={locale}
                  locales={LOCALES}
                  onLocale={setLocale}
                  onLogout={onAdminLogout}
                />
              ) : (
                <Navigate to="/admin/login" replace />
              )
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="events" element={<Events />} />
            <Route path="events/:id" element={<EventDetail />} />
            <Route path="users" element={<Users />} />
            <Route path="captures" element={<Captures />} />
            <Route path="reports" element={<Reports />} />
            <Route path="keys" element={<ApiKeys />} />
            <Route path="settings" element={<Settings />} />
            <Route path="audit" element={<Audit />} />
          </Route>

          {/* ---------- Public ATA signing (no auth, tokenized link) ---------- */}
          <Route
            path="/assinar/:token"
            element={<AtaSign locale={locale} locales={LOCALES} onLocale={setLocale} />}
          />

          {/* ---------- End-user capture app (docas.ai/) ---------- */}
          <Route
            path="/login"
            element={
              userAuthed ? (
                <Navigate to="/" replace />
              ) : (
                <UserLogin
                  onLogin={onUserLogin}
                  locale={locale}
                  locales={LOCALES}
                  onLocale={setLocale}
                />
              )
            }
          />
          <Route
            element={
              userAuthed ? (
                <UserLayout
                  locale={locale}
                  locales={LOCALES}
                  onLocale={setLocale}
                  onLogout={onUserLogout}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          >
            <Route path="/" element={<MinhasProvas />} />
            <Route path="/capturar" element={<Capture />} />
            <Route path="/prova/:id" element={<ProvaDetail />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </IntlProvider>
  );
}
