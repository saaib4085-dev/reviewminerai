import { useEffect, useState } from 'react';
import { configError } from './lib/supabase';
import { AuthProvider, useAuth } from './hooks/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import HomePage from './components/HomePage';
import Workspace from './components/Workspace';
import Logo from './components/Logo';
import { useSpotlight } from './lib/motion';
import PrivacyPage from './components/PrivacyPage';
import TermsPage from './components/TermsPage';
import AdminPage from './components/AdminPage';

function legalRoute(): 'privacy' | 'terms' | 'admin' | null {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/privacy' || window.location.hash === '#privacy') return 'privacy';
  if (path === '/terms' || window.location.hash === '#terms') return 'terms';
  if (path === '/admin' || window.location.hash === '#admin') return 'admin';
  return null;
}

function Gate({ admin = false }: { admin?: boolean }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Logo className="h-9 w-9 motion-safe:animate-pulse" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }
  if (!session) return <HomePage />;
  return admin ? <AdminPage /> : <Workspace />;
}

export default function App() {
  useSpotlight();
  const [legal, setLegal] = useState(legalRoute);

  useEffect(() => {
    const update = () => setLegal(legalRoute());
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
    };
  }, []);

  // Legal pages are public, so they show even before the app is configured.
  if (legal === 'privacy') return <PrivacyPage />;
  if (legal === 'terms') return <TermsPage />;

  if (configError) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md glass rounded-3xl p-6">
          <h1 className="font-display text-xl font-semibold">Almost there</h1>
          <p className="mt-2 text-muted">{configError} Add them in Cloudflare Pages, then redeploy.</p>
        </div>
      </div>
    );
  }
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Gate admin={legal === 'admin'} />
      </AuthProvider>
    </ErrorBoundary>
  );
}
