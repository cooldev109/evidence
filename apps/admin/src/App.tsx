import { useCallback, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { IntlProvider } from 'react-intl';
import { LOCALES, MESSAGES, resolveLocale, type Locale } from './i18n.ts';
import { clearToken, getToken } from './api.ts';
import { Layout } from './components/Layout.tsx';
import { Login } from './screens/Login.tsx';
import { Dashboard } from './screens/Dashboard.tsx';
import { Events } from './screens/Events.tsx';
import { EventDetail } from './screens/EventDetail.tsx';
import { Reports } from './screens/Reports.tsx';
import { ApiKeys } from './screens/ApiKeys.tsx';
import { Settings } from './screens/Settings.tsx';
import { Audit } from './screens/Audit.tsx';

const LOCALE_KEY = 'evidence_admin_locale';

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());
  const [locale, setLocaleState] = useState<Locale>(() =>
    resolveLocale(localStorage.getItem(LOCALE_KEY)),
  );

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(LOCALE_KEY, l);
    setLocaleState(l);
  }, []);

  // Keep auth state in sync if the token is cleared elsewhere (401 handler).
  useEffect(() => {
    const onStorage = () => setAuthed(!!getToken());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const onLogin = useCallback(
    (tenantLocale: string) => {
      if (!localStorage.getItem(LOCALE_KEY)) setLocale(resolveLocale(tenantLocale));
      setAuthed(true);
    },
    [setLocale],
  );

  const onLogout = useCallback(() => {
    clearToken();
    setAuthed(false);
  }, []);

  return (
    <IntlProvider locale={locale} messages={MESSAGES[locale]} defaultLocale="pt-BR">
      <HashRouter>
        <Routes>
          <Route
            path="/login"
            element={authed ? <Navigate to="/" replace /> : <Login onLogin={onLogin} />}
          />
          <Route
            element={
              authed ? (
                <Layout
                  locale={locale}
                  locales={LOCALES}
                  onLocale={setLocale}
                  onLogout={onLogout}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/keys" element={<ApiKeys />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/audit" element={<Audit />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </IntlProvider>
  );
}
