import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import BackgroundGradient from '@/components/ui/background-gradient';
import Logo from '@/components/ui/logo';

export default function AuthLayout() {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-4">
      <BackgroundGradient />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-4">
        <Link to="/" aria-label="Home">
          <Logo />
        </Link>
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to home
        </Link>
      </div>

      {/* Centered card area */}
      <div className="w-full max-w-md mt-16">
        <Outlet />
      </div>
    </div>
  );
}
