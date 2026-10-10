// What the browser keeps (spec §9.7): the language in localStorage, the chosen demo account in sessionStorage, and the
// tour progress of the sign-in screen. No data of the store is kept in the browser.
import type { Lang } from './i18n';
import type { Role, SessionUser } from './types';

const LANG_KEY = 'shiftswap9.lang';
const USER_KEY = 'shiftswap9.user';
const TOUR_KEY = 'shiftswap9.tour';

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Storage blocked (private mode): the choice lasts until the page is reloaded.
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

export function loadLang(): Lang {
  return read(local, LANG_KEY) === 'en' ? 'en' : 'ko';
}

export function saveLang(lang: Lang) {
  write(local, LANG_KEY, lang);
}

export function loadUser(): SessionUser | null {
  try {
    const value = JSON.parse(read(session, USER_KEY) || 'null') as Partial<SessionUser> | null;
    if (value && typeof value.id === 'number' && (value.role === 'OWNER' || value.role === 'WORKER')) {
      return { id: value.id, role: value.role as Role, name: String(value.name || '') };
    }
  } catch {
    // An unreadable value counts as signed out.
  }
  return null;
}

export function saveUser(user: SessionUser | null) {
  write(session, USER_KEY, user ? JSON.stringify(user) : null);
}

export function loadTour(): number[] {
  try {
    const value = JSON.parse(read(local, TOUR_KEY) || '[]') as unknown;
    return Array.isArray(value) ? value.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

export function saveTour(steps: number[]) {
  write(local, TOUR_KEY, steps.length ? JSON.stringify(steps) : null);
}

/**
 * Weeks this page session already tried to generate for the owner (generate_week runs once per empty week, not on every
 * refresh); forgotten when the demo data are reset.
 */
export const generatedWeeks = new Set<string>();

/** After reset_demo_data: the tour starts again and empty weeks may be generated again. */
export function afterDemoReset() {
  saveTour([]);
  generatedWeeks.clear();
}

/** The pages of each role (spec §19 RBAC). */
export const ROUTES: Record<Role, string[]> = {
  WORKER: ['home', 'schedule', 'swaps', 'me', 'notifications'],
  OWNER: ['home', 'schedule', 'staff', 'pay', 'settings', 'notifications'],
};

/** The navigation of each role; Notifications is the bell in the header. */
export const MENU: Record<Role, string[]> = {
  WORKER: ['home', 'schedule', 'swaps', 'me'],
  OWNER: ['home', 'schedule', 'staff', 'pay', 'settings'],
};
