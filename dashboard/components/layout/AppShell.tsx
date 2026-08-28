import { useEffect, useState } from 'react';

interface App {
  id: string;
  name: string;
  description: string;
  url: string;
  icon: string;
}

const ICONS: Record<string, string> = {
  phone: '📞',
  calculator: '🧾',
  palette: '🎨',
  default: '⬡',
};

// The cross-app launcher reads its app list from a sibling "apps" service
// (the multi-app portal — e.g. MyAccountant federation). Configured via env so
// there is NO hardcoded localhost: when NEXT_PUBLIC_APPS_API_URL is unset (the
// default today, incl. prod until the portal ships) the bar renders nothing
// instead of showing an empty "My Apps" strip from a failed fetch.
const THEME_API = process.env.NEXT_PUBLIC_APPS_API_URL;

interface Props {
  currentAppId: string;
  userName?: string;
  onSignOut?: () => void;
}

// Only http(s) and relative URLs may reach an href — the app list comes from a
// network response, so a compromised/misconfigured apps service must not be able
// to inject a `javascript:` (or `data:`) URL.
function isSafeHref(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    const scheme = new URL(url).protocol;
    return scheme === 'http:' || scheme === 'https:';
  } catch {
    return false;
  }
}

export function AppShell({ currentAppId, userName, onSignOut }: Props) {
  const [apps, setApps] = useState<App[]>([]);

  useEffect(() => {
    if (!THEME_API) return;
    void fetch(`${THEME_API}/api/apps`)
      .then((r) => r.json())
      .then((data) => setApps(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const safeApps = apps.filter((a) => isSafeHref(a.url));

  // Render nothing until a real apps service is configured AND returns apps —
  // no endpoint or no apps means no bar (keeps prod clean while the portal is WIP).
  if (!THEME_API || safeApps.length === 0) return null;

  return (
    <div
      style={{
        height: '48px',
        background: 'var(--bg-surface, #1e293b)',
        borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '16px',
        paddingRight: '16px',
        gap: '8px',
        fontFamily: 'var(--font-body, system-ui)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Brand */}
      <span
        style={{
          fontWeight: 700,
          fontSize: '13px',
          color: 'var(--accent-soft, #60a5fa)',
          marginRight: '8px',
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
        }}
      >
        My Apps
      </span>

      {/* Divider */}
      <div
        style={{
          width: '1px',
          height: '20px',
          background: 'var(--border-soft, rgba(255,255,255,0.06))',
          flexShrink: 0,
        }}
      />

      {/* App tabs */}
      <nav style={{ display: 'flex', gap: '4px', flex: 1 }}>
        {safeApps.map((app) => {
          const active = app.id === currentAppId;
          return (
            <a
              key={app.id}
              href={app.url}
              title={app.description}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent-soft, #60a5fa)' : 'var(--text-secondary, #94a3b8)',
                background: active ? 'var(--accent-muted, rgba(37,99,235,0.12))' : 'transparent',
                textDecoration: 'none',
                transition: 'background 0.15s, color 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'var(--bg-raised, rgba(255,255,255,0.05))';
                  e.currentTarget.style.color = 'var(--text-primary, #e2e8f0)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)';
                }
              }}
            >
              <span style={{ fontSize: '14px' }}>{ICONS[app.icon] ?? ICONS.default}</span>
              {app.name}
            </a>
          );
        })}
      </nav>

      {/* User */}
      {(userName || onSignOut) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          {userName && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)' }}>
              {userName}
            </span>
          )}
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              style={{
                fontSize: '12px',
                color: 'var(--text-muted, #64748b)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '4px',
              }}
            >
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
