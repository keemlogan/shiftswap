// The application shell: header (store name, demo clock, bell with the unread count, user menu), the navigation of the
// role (left on desktop, tab bar on phones), the route guard (spec §19 RBAC) and the refresh cycle (NFR-15): every
// 10 s and when the window regains focus — unless a sheet or a form is open — the System Clock runs and the header and
// the open screen read again. Screens read their own data when they open (context.ts: useScreen).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { rpc, runSystemClock } from './api';
import { Icon, Sheet, type IconName } from './components/ui';
import { ShellContext, type Loader, type ShellValue } from './context';
import { useI18n, useSetLang, type TextKey } from './i18n';
import { loadUser, MENU, ROUTES, saveUser } from './store';
import type { Notifications, SessionUser, Settings } from './types';

const NAV_ICONS: Record<string, IconName> = {
  home: 'home', schedule: 'calendar', swaps: 'swap', me: 'user', staff: 'users', pay: 'pay', settings: 'settings',
};

const REFRESH_MS = 10000;

export function Shell() {
  const i18n = useI18n();
  const setLang = useSetLang();
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(loadUser);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<{ id: number; message: string; kind: 'ok' | 'alert' } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const userRef = useRef(user);
  userRef.current = user;
  const loaders = useRef(new Set<Loader>());
  const holds = useRef(0);
  const cycling = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const loadHeader = useCallback(async () => {
    const u = userRef.current;
    try {
      const [s, n] = await Promise.all([
        rpc<Settings>('get_settings'),
        u ? rpc<Notifications>('notifications', { p_worker_id: u.id }) : Promise.resolve(null),
      ]);
      setSettings(s);
      if (n) setUnread(n.unread);
    } catch {
      // The header keeps its last values; the screen shows the problem.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await runSystemClock();
    } catch {
      // The reads below report the problem.
    }
    await Promise.all([loadHeader(), ...Array.from(loaders.current).map((load) => load())]);
  }, [loadHeader]);

  const register = useCallback((loader: Loader) => {
    loaders.current.add(loader);
    return () => { loaders.current.delete(loader); };
  }, []);

  const hold = useCallback(() => {
    holds.current += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        holds.current -= 1;
      }
    };
  }, []);

  const toastSeq = useRef(0);
  const showToast = useCallback((message: string, kind: 'ok' | 'alert' = 'ok') => {
    window.clearTimeout(toastTimer.current);
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, message, kind });
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  const signIn = useCallback((next: SessionUser, to: string) => {
    saveUser(next);
    setUser(next);
    setUnread(0);
    setToast(null);
    navigate(to);
  }, [navigate]);

  const signOut = useCallback(() => {
    saveUser(null);
    setUser(null);
    setUnread(0);
    setToast(null);
    navigate('/login');
  }, [navigate]);

  // The header on start and after signing in as someone else.
  useEffect(() => { void loadHeader(); }, [user, loadHeader]);

  // NFR-15: refresh every 10 s and when the window regains focus, while nothing is open.
  useEffect(() => {
    const tick = async () => {
      if (holds.current > 0 || document.hidden || cycling.current) return;
      cycling.current = true;
      try {
        await refresh();
      } finally {
        cycling.current = false;
      }
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    const onFocus = () => { void tick(); };
    const onVisible = () => { if (!document.hidden) void tick(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const value: ShellValue = useMemo(() => ({
    user, settings, unread, now: settings?.now ?? null, signIn, signOut, refresh, register, hold, toast: showToast, setUnread,
  }), [user, settings, unread, signIn, signOut, refresh, register, hold, showToast]);

  const parts = location.pathname.split('/').filter(Boolean);
  const route = parts[0] || '';
  const inFlow = route === 'swaps' && parts[1] === 'new';
  const signedIn = !!user && route !== 'login';

  useEffect(() => {
    document.body.classList.toggle('signed-in', signedIn);
    document.body.classList.toggle('in-flow', inFlow);
  }, [signedIn, inFlow]);

  useEffect(() => {
    document.title = Object.keys(NAV_ICONS).concat('notifications').includes(route)
      ? `${i18n.t(`nav.${route}` as TextKey)} · ShiftSwap` : 'ShiftSwap';
  }, [route, i18n]);

  let guard: JSX.Element | null = null;
  if (!user && route !== 'login') guard = <Navigate to="/login" replace />;
  else if (user && route !== 'login' && !ROUTES[user.role].includes(route)) guard = <Navigate to="/home" replace />;

  const store = settings ? i18n.name(settings.workplace.name) : '';
  const clockText = settings ? i18n.clock(settings.now) : '';
  const clockLabel = settings
    ? i18n.t(settings.workplace.demo_clock ? 'header.clock' : 'header.realClock', { when: clockText }) : '';
  const toggleLang = () => setLang(i18n.lang === 'ko' ? 'en' : 'ko');

  return (
    <ShellContext.Provider value={value}>
      <header className="topbar">
        <Link className="brand" to={user ? '/home' : '/login'}>{store || 'ShiftSwap'}</Link>
        <div className="top-actions">
          {settings && (
            <span className="clock-chip" role="img" aria-label={clockLabel} data-clock={settings.now}>
              <Icon name="clock" /><span className="num">{clockText}</span>
            </span>
          )}
          {signedIn && user ? (
            <>
              <Link className="icon-btn bell" to="/notifications"
                aria-label={unread ? i18n.t('header.bellCount', { n: unread }) : i18n.t('header.bell')}
                aria-current={route === 'notifications' ? 'page' : undefined}>
                <Icon name="bell" />
                {unread > 0 && <span className="badge num" aria-hidden="true" data-unread={unread}>{unread}</span>}
              </Link>
              <button type="button" className="person-btn" id="user-menu" onClick={() => setMenuOpen(true)}
                aria-label={i18n.t('header.menu', { name: i18n.name(user.name) })} aria-haspopup="dialog">
                <span className="avatar" aria-hidden="true">{i18n.initial(user.name)}</span>
                <span className="person-name">{i18n.name(user.name)}</span>
              </button>
            </>
          ) : (
            <button type="button" className="lang-btn" id="lang-switch" onClick={toggleLang}
              aria-label={i18n.t('header.languageLabel')}>
              <Icon name="globe" /><span>{i18n.t('header.languageShort')}</span>
            </button>
          )}
        </div>
      </header>
      <div className={`layout ${signedIn && !inFlow ? 'with-nav' : ''}`}>
        {signedIn && !inFlow && user && (
          <nav className="nav" aria-label={i18n.t('nav.label')}>
            <ul>
              {MENU[user.role].map((key) => (
                <li key={key}>
                  <NavLink to={`/${key}`} data-nav={key}>
                    <Icon name={NAV_ICONS[key]} />
                    <span>{i18n.t(`nav.${key}` as TextKey)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <main id="main" className={`content content-${route}`}>
          <div className={`view view-${route}`}>{guard ?? <Outlet />}</div>
        </main>
      </div>
      {menuOpen && user && (
        <Sheet title={i18n.t('header.menuTitle')} variant="popover" onClose={() => setMenuOpen(false)}>
          <div className="menu-list">
            <button type="button" className="menu-item" id="menu-lang" onClick={() => { setMenuOpen(false); toggleLang(); }}>
              <Icon name="globe" /><span>{i18n.t('header.language')}</span>
            </button>
            <button type="button" className="menu-item" id="menu-signout" onClick={() => { setMenuOpen(false); signOut(); }}>
              <Icon name="logout" /><span>{i18n.t('header.signOut')}</span>
            </button>
          </div>
        </Sheet>
      )}
      <ToastHost toast={toast} />
    </ShellContext.Provider>
  );
}

function ToastHost({ toast }: { toast: { id: number; message: string; kind: 'ok' | 'alert' } | null }) {
  const host = document.getElementById('toast-root');
  if (!host) return null;
  return createPortal(
    toast ? (
      <div key={toast.id} className={`toast toast-${toast.kind}`} data-kind={toast.kind} data-toast-id={toast.id}>
        <Icon name={toast.kind === 'ok' ? 'check' : 'alert'} />
        <span>{toast.message}</span>
      </div>
    ) : null,
    host,
  );
}
