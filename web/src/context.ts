// The shell's shared state and the hooks every screen uses:
//   useScreen   — load a screen's data: the System Clock first (run_system_clock), then the screen's read functions;
//                 the shell reloads it on every refresh cycle (every 10 s, on focus, after every action).
//   useHold     — a sheet or a form is open: the automatic refresh waits (NFR-15 refreshes only idle screens).
//   useAction   — run one database function for a user action, show the result as a toast, reload the screen.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList } from 'react';
import { runSystemClock } from './api';
import { useI18n } from './i18n';
import type { SessionUser, Settings } from './types';

export type Loader = () => Promise<void>;

export interface ShellValue {
  user: SessionUser | null;
  settings: Settings | null;
  unread: number;
  /** "Now" of the database (the demo clock while it is set), from get_settings. */
  now: string | null;
  signIn: (user: SessionUser, to: string) => void;
  signOut: () => void;
  /** One refresh cycle: run_system_clock, then the header and the open screen in parallel. */
  refresh: () => Promise<void>;
  register: (loader: Loader) => () => void;
  hold: () => () => void;
  toast: (message: string, kind?: 'ok' | 'alert') => void;
  setUnread: (n: number) => void;
}

export const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('ShellContext missing');
  return ctx;
}

export interface Screen<T> {
  data: T | null;
  error: unknown;
  reload: () => Promise<void>;
}

/**
 * The data of one screen. `deps` are the screen's own parameters (week, month, id): when they change, the System Clock
 * runs and the screen reads again. Answers that arrive after a newer request are dropped.
 */
export function useScreen<T>(load: () => Promise<T>, deps: DependencyList): Screen<T> {
  const { register, refresh } = useShell();
  const [state, setState] = useState<{ data: T | null; error: unknown }>({ data: null, error: null });
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const fetchData = useCallback(async () => {
    const id = ++seq.current;
    try {
      const data = await loadRef.current();
      if (id === seq.current) setState({ data, error: null });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ data: s.data, error }));
    }
  }, []);

  useEffect(() => register(fetchData), [register, fetchData]);

  useEffect(() => {
    setState({ data: null, error: null });
    let live = true;
    (async () => {
      try {
        await runSystemClock();
      } catch {
        // The screen's own read reports the problem.
      }
      if (live) await fetchData();
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data: state.data, error: state.error, reload: refresh };
}

/** Data a sheet reads when it opens (shift detail, worker list): one call, no System Clock run, no refresh cycle. */
export function useFetch<T>(load: () => Promise<T>, deps: DependencyList): Screen<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown }>({ data: null, error: null });
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  const fetchData = useCallback(async () => {
    const id = ++seq.current;
    try {
      const data = await loadRef.current();
      if (id === seq.current) setState({ data, error: null });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ data: s.data, error }));
    }
  }, []);
  useEffect(() => {
    setState({ data: null, error: null });
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data: state.data, error: state.error, reload: fetchData };
}

/** While `active`, the automatic refresh waits (an open sheet or form keeps what the person is doing). */
export function useHold(active = true) {
  const { hold } = useShell();
  useEffect(() => (active ? hold() : undefined), [active, hold]);
}

export interface ActionResult<R> {
  ok: boolean;
  value?: R;
  error?: unknown;
  message?: string;
}

/**
 * Run one user action: the database function, then a toast with the result (success sentence or the error code's
 * sentence) and a reload of the screen. `navigate: true` skips the reload because the caller opens another screen.
 */
export function useAction() {
  const { toast, refresh } = useShell();
  const i18n = useI18n();
  return useCallback(async <R>(fn: () => Promise<R>, success: string | ((value: R) => string),
    options: { reload?: boolean } = {}): Promise<ActionResult<R>> => {
    const reload = options.reload !== false;
    try {
      const value = await fn();
      toast(typeof success === 'function' ? success(value) : success, 'ok');
      if (reload) await refresh();
      return { ok: true, value };
    } catch (error) {
      const message = i18n.errorText(error);
      toast(message, 'alert');
      if (reload) await refresh();
      return { ok: false, error, message };
    }
  }, [toast, refresh, i18n]);
}
