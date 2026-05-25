import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FormattedMessage } from 'react-intl';
import type { Locale } from '../i18n.ts';
import { userApi } from './userApi.ts';
import { IconCamera, IconShield, IconSun, IconMoon } from '../icons.tsx';
import { useTheme } from '../lib/useTheme.ts';

interface Props {
  locale: Locale;
  locales: Locale[];
  onLocale: (l: Locale) => void;
  onLogout: () => void;
}

export function UserLayout({ locale, locales, onLocale, onLogout }: Props) {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  useEffect(() => {
    userApi
      .me()
      .then((m) => setName(m.name || m.email))
      .catch(() => {});
  }, []);

  return (
    <div className="u-shell">
      <header className="u-topbar">
        <div className="u-brand">
          <div className="brand-logo">E</div>
          <span>EVIDENCE</span>
        </div>
        <div className="u-top-right">
          {name && <span className="u-who">{name}</span>}
          <button
            type="button"
            className="u-theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <select
            className="locale-select"
            value={locale}
            onChange={(e) => onLocale(e.target.value as Locale)}
          >
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button className="link" onClick={onLogout}>
            <FormattedMessage id="u.nav.logout" />
          </button>
        </div>
      </header>

      <main className="u-content">
        <Outlet />
      </main>

      <nav className="u-bottomnav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <IconShield />
          <FormattedMessage id="u.nav.provas" />
        </NavLink>
        <button className="u-capture-fab" onClick={() => navigate('/capturar')} aria-label="capture">
          +
        </button>
        <NavLink to="/capturar" className={({ isActive }) => (isActive ? 'active' : '')}>
          <IconCamera />
          <FormattedMessage id="u.nav.capture" />
        </NavLink>
      </nav>
    </div>
  );
}
