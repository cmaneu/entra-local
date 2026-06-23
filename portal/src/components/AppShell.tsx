import { NavLink, Outlet } from 'react-router-dom';
import { originLabel, middleEllipsis } from '../lib/format';
import { useEmulator } from './EmulatorContext';
import { IdChip } from './IdChip';
import { StatusDot } from './StatusDot';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/users', label: 'Users', icon: '◔', end: false },
  { to: '/groups', label: 'Groups', icon: '◑', end: false },
  { to: '/apps', label: 'App registrations', icon: '▤', end: false },
];

/** Top bar: wordmark + persistent LOCAL EMULATOR badge + origin/tenant chips + health indicator. */
function TopBar(): JSX.Element {
  const { health, discovery, error } = useEmulator();
  const origin = discovery ? originLabel(discovery.issuer) : window.location.host;
  const reachable = !!health && !error;

  return (
    <header className="topbar">
      <span className="wordmark">Entra&nbsp;Local</span>
      <span className="badge" title="This is a local emulator, not Microsoft Entra ID">
        ▲ Local Emulator
      </span>
      <IdChip value={origin} title="Emulator origin" full />
      {health && (
        <IdChip
          value={health.tenantId}
          label={`tenant ${middleEllipsis(health.tenantId, 4, 4)}`}
          title="Tenant ID"
        />
      )}
      <span className="health">
        {reachable ? (
          <>
            <StatusDot tone="ok" /> Connected · {health!.tls ? 'TLS ok' : 'no TLS'} · v
            {health!.version}
          </>
        ) : (
          <>
            <StatusDot tone="bad" /> Unreachable
          </>
        )}
      </span>
    </header>
  );
}

function SideNav(): JSX.Element {
  return (
    <nav className="sidenav" aria-label="Primary">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}
        >
          <span className="ic" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The shared portal shell: top bar + side nav + routed content. */
export function AppShell(): JSX.Element {
  return (
    <div className="shell">
      <TopBar />
      <div className="body-row">
        <SideNav />
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
