import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { FormattedMessage } from 'react-intl';
import type { Locale } from '../i18n.ts';
import { api, type Tenant } from '../api.ts';
import {
  IconDashboard,
  IconEvents,
  IconReports,
  IconKeys,
  IconSettings,
  IconAudit,
  IconUsers,
  IconCamera,
} from '../icons.tsx';

interface Props {
  locale: Locale;
  locales: Locale[];
  onLocale: (l: Locale) => void;
  onLogout: () => void;
}

const NAV = [
  { to: '/admin', key: 'nav.dashboard', end: true, Icon: IconDashboard },
  { to: '/admin/users', key: 'nav.users', end: false, Icon: IconUsers },
  { to: '/admin/captures', key: 'nav.captures', end: false, Icon: IconCamera },
  { to: '/admin/events', key: 'nav.events', end: false, Icon: IconEvents },
  { to: '/admin/reports', key: 'nav.reports', end: false, Icon: IconReports },
  { to: '/admin/keys', key: 'nav.keys', end: false, Icon: IconKeys },
  { to: '/admin/settings', key: 'nav.settings', end: false, Icon: IconSettings },
  { to: '/admin/audit', key: 'nav.audit', end: false, Icon: IconAudit },
];

export function Layout({ locale, locales, onLocale, onLogout }: Props) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [email, setEmail] = useState('');
  useEffect(() => {
    api
      .me()
      .then((m) => {
        setTenant(m.tenant);
        setEmail(m.email);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-logo">E</div>
          <div className="brand-name">EVIDENCE</div>
        </div>
        <nav>
          {NAV.map(({ to, key, end, Icon }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon />
              <FormattedMessage id={key} />
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">Digital chain of custody</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="tenant">
            {tenant?.name ?? '…'}
            {tenant?.slug && <small>{tenant.slug}</small>}
          </div>
          <div className="right">
            {email && <span className="who">{email}</span>}
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
              <FormattedMessage id="nav.logout" />
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
