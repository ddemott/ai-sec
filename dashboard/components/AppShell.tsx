import { useEffect, useState } from 'react'

interface App {
  id: string
  name: string
  description: string
  url: string
  icon: string
}

const ICONS: Record<string, string> = {
  phone: '📞',
  calculator: '🧾',
  palette: '🎨',
  default: '⬡',
}

const THEME_API = 'http://localhost:7000'

interface Props {
  currentAppId: string
  userName?: string
  onSignOut?: () => void
}

export function AppShell({ currentAppId, userName, onSignOut }: Props) {
  const [apps, setApps] = useState<App[]>([])

  useEffect(() => {
    fetch(`${THEME_API}/api/apps`)
      .then((r) => r.json())
      .then(setApps)
      .catch(() => {})
  }, [])

  return (
    <div style={{
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
    }}>
      {/* Brand */}
      <span style={{
        fontWeight: 700,
        fontSize: '13px',
        color: 'var(--accent-soft, #60a5fa)',
        marginRight: '8px',
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}>
        My Apps
      </span>

      {/* Divider */}
      <div style={{ width: '1px', height: '20px', background: 'var(--border-soft, rgba(255,255,255,0.06))', flexShrink: 0 }} />

      {/* App tabs */}
      <nav style={{ display: 'flex', gap: '4px', flex: 1 }}>
        {apps.map((app) => {
          const active = app.id === currentAppId
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
                  (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-raised, rgba(255,255,255,0.05))'
                  ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-primary, #e2e8f0)'
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-secondary, #94a3b8)'
                }
              }}
            >
              <span style={{ fontSize: '14px' }}>{ICONS[app.icon] ?? ICONS.default}</span>
              {app.name}
            </a>
          )
        })}
      </nav>

      {/* User */}
      {(userName || onSignOut) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          {userName && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)' }}>{userName}</span>
          )}
          {onSignOut && (
            <button
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
  )
}
