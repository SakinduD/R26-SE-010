import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, LayoutDashboard, Brain, Swords, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth/context'
import { cn } from '@/lib/utils'

const NAV_LINKS = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard'     },
  { to: '/training-plan', icon: Brain,            label: 'Training Plan' },
  { to: '/roleplay',      icon: Swords,           label: 'Role Play'     },
]

export default function RPELayout() {
  const { user, isAuthenticated, signOut } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()

  const handleSignOut = async () => {
    await signOut()
    toast.success('Signed out')
    navigate('/')
  }

  const isActive = (path) =>
    path === '/roleplay'
      ? location.pathname.startsWith('/roleplay')
      : location.pathname === path

  return (
    <>
      {/* REDESIGN: changed header from bg-background/80 + h-14 to .topbar (h-48 + bg-surface) */}
      <header
        className="topbar"
        style={{
          paddingLeft: 16,
          paddingRight: 16,
          background: 'oklch(0.185 0.018 264 / 0.85)',
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {/* REDESIGN: Logo replaced with EZ wordmark to match new sidebar identity */}
            <Link
              to={isAuthenticated ? '/dashboard' : '/'}
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              aria-label="EmpowerZ home"
            >
              <div className="sb-mark" style={{ width: 24, height: 24, fontSize: 12 }}>EZ</div>
              <span className="sb-brand-text">EmpowerZ</span>
            </Link>

            {/* REDESIGN: nav links restyled to match sidebar .sb-link visual idiom */}
            {NAV_LINKS.map(({ to, icon: Icon, label }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  'sb-link',
                  isActive(to) && 'sb-link-active',
                )}
                data-active={isActive(to) || undefined}
                style={{ padding: '5px 10px' }}
              >
                <Icon size={14} strokeWidth={1.6} />
                <span>{label}</span>
              </Link>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {isAuthenticated ? (
              <>
                <span className="t-cap" style={{ display: 'none' }} />
                <span
                  className="t-cap"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {user?.display_name || user?.email}
                </span>
                {/* REDESIGN: Sign out button now uses .icon-btn idiom */}
                <button
                  onClick={handleSignOut}
                  className="sb-link"
                  aria-label="Sign out"
                  style={{ padding: '5px 10px' }}
                >
                  <LogOut size={14} strokeWidth={1.6} />
                  <span>Sign out</span>
                </button>
              </>
            ) : (
              <Link
                to="/signin"
                className="sb-link"
                style={{ padding: '5px 10px', color: 'var(--accent)' }}
              >
                <LogIn size={14} strokeWidth={1.6} />
                <span>Sign in</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      <Outlet />
    </>
  )
}
