import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, FOCUS_KEYS, type UserSettings } from '../../shared/types';
import { supabase } from '../lib/supabase';

export function useSettings(userId: string | undefined) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('default_focuses, detail')
        .eq('user_id', userId)
        .maybeSingle();
      if (!active) return;
      if (data) {
        const raw = data as { default_focuses?: unknown; detail?: unknown };
        const focuses = Array.isArray(raw.default_focuses)
          ? FOCUS_KEYS.filter((k) => (raw.default_focuses as unknown[]).includes(k))
          : DEFAULT_SETTINGS.default_focuses;
        setSettings({ default_focuses: focuses, detail: raw.detail === 'detailed' ? 'detailed' : 'quick' });
      }
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const save = useCallback(
    async (next: UserSettings) => {
      if (!userId) throw new Error('Not signed in');
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: userId, ...next }, { onConflict: 'user_id' });
      if (error) throw new Error('Couldn’t save your settings. Check your connection and try again.');
      setSettings(next);
    },
    [userId],
  );

  return { settings, loaded, save };
}
