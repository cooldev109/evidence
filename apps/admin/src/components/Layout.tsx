import { NavLink, Outlet } from 'react-router-dom';
import { FormattedMessage } from 'react-intl';
import type { Locale } from '../i18n.ts';

interface Props {
  locale: Locale;
  locales: Locale[];
  onLocale: (l: Locale) => void;
  onLogout: () => void;
}

const NAV = [
  { to: '/', key: 'nav.dashboard', end: true },
  { to: '/events', key: 'nav.events', end: false },
  { to: '/reports', key: 'nav.reports', end: false },
  { to: '/keys', key: 'nav.keys', end: false },
  { to: '/settings', key: 'nav.settings', end: false },
  { to: '/audit', key: 'nav.audit', end: false },
];

export function Layout({ locale, locales, onLocale, onLogout }: Props) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">EVIDENCE</div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <FormattedMessage id={n.key} />
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <select value={locale} onChange={(e) => onLocale(e.target.value as Locale)}>
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button className="link" onClick={onLogout}>
            <FormattedMessage id="nav.logout" />
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
