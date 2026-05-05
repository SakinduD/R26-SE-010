import React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, LayoutDashboard, Brain, BarChart3, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import Logo from '@/components/ui/logo';
import { useAuth } from '@/lib/auth/context';
import { useProtectedRoute } from '@/lib/auth/useProtectedRoute';

function NavSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border h-14 animate-pulse bg-muted/30" />
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-4">
        <div className="h-8 w-48 rounded-lg bg-muted animate-pulse" />
        <div className="h-4 w-72 rounded bg-muted animate-pulse" />
      </div>
    </div>
  );
}

export default function AppLayout() {
  const { isLoading } = useProtectedRoute();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  if (isLoading) return <NavSkeleton />;

  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/dashboard">
              <Logo />
            </Link>
            <Link
              to="/dashboard"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LayoutDashboard className="size-3.5" />
              Dashboard
            </Link>
            <Link
              to="/training-plan"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Brain className="size-3.5" />
              Training plan
            </Link>
            <Link
              to="/analytics-dashboard"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <BarChart3 className="size-3.5" />
              Analytics
            </Link>
            <Link
              to="/analytics-feedback"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageSquare className="size-3.5" />
              Feedback
            </Link>
          </div>

          <div className="flex items-center gap-4">
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
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-5xl mx-auto px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
}
