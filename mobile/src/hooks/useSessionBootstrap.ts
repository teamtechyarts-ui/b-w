import {useEffect, useRef, useState} from 'react';
import {getMyProfile} from '../services/authApi';
import {accountRoleFromProfile} from '../services/driverProfileApi';

type Options = {
  hydrating: boolean;
  authenticated: boolean;
  accessToken: string;
  profile: unknown;
  setProfile: (profile: unknown) => Promise<void>;
  loadServices: (token: string) => Promise<void>;
  loadAddresses: () => Promise<void>;
};

export function useSessionBootstrap(options: Options) {
  const {hydrating, authenticated, accessToken} = options;
  const [resolved, setResolved] = useState(false);
  const bootstrappedRef = useRef(false);

  // Profile persistence and address selection change these callbacks/state.
  // They must not cancel the bootstrap for the same authenticated session.
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (!authenticated) {
      bootstrappedRef.current = false;
      setResolved(true);
      return;
    }

    if (!accessToken) {
      // Authenticated but token is refreshing or being read: do not clear bootstrapped state
      if (!bootstrappedRef.current) {
        setResolved(false);
      }
      return;
    }

    let active = true;
    const session = latest.current;

    // Only set resolved to false on initial cold boot before first resolution.
    // Subsequent token refreshes must NEVER unmount NavigationContainer.
    if (!bootstrappedRef.current) {
      setResolved(false);
    }

    async function restore() {
      let role = accountRoleFromProfile(session.profile);
      try {
        const account = await getMyProfile(accessToken);
        if (!active) return;
        role = accountRoleFromProfile(account);
        await session.setProfile(account);
      } catch {
        // The request layer refreshes expired sessions. A stored profile also
        // lets an offline customer reach the catalogue's explicit retry state.
      }
      if (!active) return;
      const loads =
        role === 'customer'
          ? Promise.all([
              session.loadServices(accessToken).catch(() => {}),
              session.loadAddresses().catch(() => {}),
            ])
          : Promise.resolve();
      bootstrappedRef.current = true;
      setResolved(true);
      await loads;
    }

    // Safety fallback: if network hangs indefinitely, resolve within 7 seconds so app shell displays retry state
    const safetyTimer = setTimeout(() => {
      if (active && !bootstrappedRef.current) {
        bootstrappedRef.current = true;
        setResolved(true);
      }
    }, 7000);

    restore().finally(() => {
      clearTimeout(safetyTimer);
    });

    return () => {
      active = false;
      clearTimeout(safetyTimer);
    };
  }, [accessToken, authenticated, hydrating]);

  return resolved;
}
