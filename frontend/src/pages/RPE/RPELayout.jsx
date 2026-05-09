import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, LayoutDashboard, Brain, Swords, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import Logo from '@/components/ui/logo'
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
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">

          <div className="flex items-center gap-6">
            <Link to={isAuthenticated ? '/dashboard' : '/'}>
              <Logo />
            </Link>
            {NAV_LINKS.map(({ to, icon: Icon, label }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex items-center gap-1.5 text-sm transition-colors',
                  isActive(to)
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-4">
            {isAuthenticated ? (
              <>
                <span className="hidden sm:block text-sm text-muted-foreground">
                  {user?.display_name || user?.email}
                </span>
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Sign out"
                >
                  <LogOut className="size-3.5" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </>
            ) : (
              <Link
                to="/signin"
                className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                <LogIn className="size-3.5" />
                Sign in
              </Link>
            )}
          </div>

        </div>
      </header>

      <Outlet />
    </>
  )
}
