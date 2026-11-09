import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { cleanAuthCodeFromUrl } from '../lib/auth';
import { isTier, type Tier } from '../../shared/types';

interface AuthValue {
  session: Session | null;
  loading: boolean;
  credits: number | null;
  setCredits: (n: number) => void;
  tier: Tier;
  setTier: (t: Tier) => void;
  refreshCredits: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState<number | null>(null);
  const [tier, setTier] = useState<Tier>('Free');

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        if (data.session) cleanAuthCodeFromUrl();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) cleanAuthCodeFromUrl();
      if (!next) setCredits(null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id;

  const refreshCredits = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.from('profiles').select('credits, tier').eq('user_id', userId).maybeSingle();
    if (!error) {
      setCredits(Number(data?.credits ?? 0));
      setTier(isTier(data?.tier) ? data.tier : 'Free');
    }
  }, [userId]);

  useEffect(() => {
    void refreshCredits();
  }, [refreshCredits]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ session, loading, credits, setCredits, tier, setTier, refreshCredits, signOut }),
    [session, loading, credits, tier, refreshCredits, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
