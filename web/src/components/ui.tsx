// Small building blocks shared by every page: line icons, buttons (a disabled button always shows its reason), the page
// head with the page's one primary action, cards, chips, notices, the request tracker, period navigation, segmented
// tabs and the sheet (bottom sheet on phones, side panel from 900 px).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useHold } from '../context';
import { useI18n } from '../i18n';
import type { RequestStatus } from '../types';

const PATHS = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  swap: '<path d="M7.5 4 4 7.5 7.5 11"/><path d="M4 7.5h13"/><path d="M16.5 13l3.5 3.5-3.5 3.5"/><path d="M20 16.5H7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.4-3.8 4.2-5.8 7.5-5.8s6.1 2 7.5 5.8"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c1.2-3.4 3.6-5.2 6.5-5.2s5.3 1.8 6.5 5.2"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6"/><path d="M17.5 14.9c2 .7 3.3 2.4 4 5.1"/>',
  pay: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chevronLeft: '<path d="M14.5 5 8 12l6.5 7"/>',
  chevronRight: '<path d="M9.5 5 16 12l-6.5 7"/>',
  chevronDown: '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.7M12 18.5v2.7M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M2.8 12h2.7M18.5 12h2.7M4.9 19.1l1.9-1.9M17.2 6.8l1.9-1.9"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.5 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.5-3.5-8.5s1.1-5.9 3.5-8.5z"/>',
  logout: '<path d="M14 4.5h4.5v15H14"/><path d="M10 8l-4 4 4 4M6 12h9.5"/>',
  alert: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.2M12 16.9v.1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** A 24 px line icon (1.75 px stroke, currentColor). */
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }} />
  );
}

export type ButtonKind = 'primary' | 'secondary' | 'text' | 'danger';

type DataAttrs = { [key: `data-${string}`]: string | number | undefined };

export interface ButtonProps extends DataAttrs {
  kind?: ButtonKind;
  block?: boolean;
  small?: boolean;
  icon?: IconName;
  /** A link button (react-router path) instead of an action. */
  to?: string;
  onClick?: () => unknown;
  disabled?: boolean;
  /** Required with `disabled`: the one-line reason shown beneath the button (NFR-13). */
  reason?: string;
  id?: string;
  className?: string;
  type?: 'button' | 'submit';
  'aria-label'?: string;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  children: ReactNode;
}

/** A button or link button. A disabled button always carries a visible reason (aria-describedby). */
export function Button({ kind = 'secondary', block, small, icon, to, onClick, disabled, reason, className, type = 'button',
  children, ...rest }: ButtonProps) {
  const reasonId = useId();
  const [busy, setBusy] = useState(false);
  const cls = ['btn', `btn-${kind}`, block ? 'btn-block' : '', small ? 'btn-small' : '', className || '']
    .filter(Boolean).join(' ');
  const inner = <>{icon && <Icon name={icon} />}<span>{children}</span></>;
  if (to && !disabled) return <Link className={cls} to={to} {...rest}>{inner}</Link>;
  if (disabled) {
    return (
      <span className={`btn-wrap ${block ? 'btn-wrap-block' : ''}`}>
        <button type="button" className={cls} disabled aria-describedby={reasonId} {...rest}>{inner}</button>
        <span className="btn-reason" id={reasonId}>{reason}</span>
      </span>
    );
  }
  const handle = async () => {
    if (busy || !onClick) return;
    const result = onClick();
    if (result instanceof Promise) {
      setBusy(true);
      try {
        await result;
      } finally {
        setBusy(false);
      }
    }
  };
  return (
    <button type={type} className={cls} onClick={type === 'submit' ? undefined : handle} aria-busy={busy || undefined} {...rest}>
      {inner}
    </button>
  );
}

/** Page title, one sentence on what the page is for, and the page's one primary action (fixed at the bottom on phones). */
export function PageHead({ title, sub, cta, back }: { title: string; sub?: string; cta?: ReactNode; back?: ReactNode }) {
  return (
    <>
      <header className="page-head">
        {back}
        <div className="page-title">
          <h1>{title}</h1>
          {sub && <p className="purpose">{sub}</p>}
        </div>
      </header>
      {cta && <div className="cta-bar">{cta}</div>}
    </>
  );
}

export function Hero({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <header className="hero">
      {kicker && <p className="hero-date">{kicker}</p>}
      <h1>{title}</h1>
      {sub && <p className="purpose">{sub}</p>}
    </header>
  );
}

export function Section({ title, count, children, id }: { title?: string; count?: number | null; children: ReactNode; id?: string }) {
  return (
    <section className="section" aria-labelledby={title ? id : undefined}>
      {title && (
        <h2 className="section-title" id={id}>
          {title}
          {count ? <span className="count num">{count}</span> : null}
        </h2>
      )}
      {children}
    </section>
  );
}

export type Tone = 'neutral' | 'ok' | 'alert' | 'primary' | 'handover' | 'ink';

export function Chip({ tone = 'neutral', children, className = '', ...rest }: { tone?: Tone; children: ReactNode; className?: string } & DataAttrs) {
  return <span className={`chip chip-${tone} ${className}`} {...rest}>{children}</span>;
}

export function Notice({ tone = 'neutral', icon, children, role }: { tone?: 'neutral' | 'ok' | 'alert' | 'warn'; icon?: IconName; children: ReactNode; role?: string }) {
  return (
    <div className={`notice notice-${tone}`} role={role}>
      {icon && <Icon name={icon} />}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p>{text}</p>
      {children}
    </div>
  );
}

const STEPS = ['REQUESTED', 'ACCEPTED', 'APPROVED'] as const;

/** Requested → Accepted → Approved, or a labelled end state (FAILED, REJECTED, EXPIRED, CANCELLED). */
export function Tracker({ status }: { status: RequestStatus }) {
  const i18n = useI18n();
  if (status === 'REJECTED' || status === 'EXPIRED' || status === 'CANCELLED' || status === 'FAILED') {
    return (
      <div className={`endstate endstate-${status.toLowerCase()}`} role="status">
        <Icon name={status === 'CANCELLED' ? 'x' : 'alert'} />
        <div>
          <strong>{i18n.t(`end.${status}`)}</strong>
          <span>{i18n.t(`end.${status}why`)}</span>
        </div>
      </div>
    );
  }
  const at = STEPS.indexOf(status);
  return (
    <ol className="tracker" aria-label={i18n.t('track.label')}>
      {STEPS.map((s, i) => {
        const state = i < at || status === 'APPROVED' ? 'done' : i === at ? 'current' : 'todo';
        return (
          <li key={s} className={`step ${state}`} aria-current={i === at ? 'step' : undefined}>
            <span className="step-dot">{state === 'done' ? <Icon name="check" /> : <span className="num">{i + 1}</span>}</span>
            <span className="step-label">{i18n.t(`track.${s}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** ‹ label › with an optional "this week"/"this month" link and a status chip. */
export function PeriodNav({ label, prevTo, nextTo, prevLabel, nextLabel, extra }: {
  label: string; prevTo: string | null; nextTo: string | null; prevLabel: string; nextLabel: string; extra?: ReactNode;
}) {
  return (
    <nav className="period-nav" aria-label={label}>
      {prevTo ? <Link className="icon-btn" to={prevTo} aria-label={prevLabel}><Icon name="chevronLeft" /></Link>
        : <span className="icon-btn-spacer" aria-hidden="true" />}
      <p className="period-label">{label}</p>
      {nextTo ? <Link className="icon-btn" to={nextTo} aria-label={nextLabel}><Icon name="chevronRight" /></Link>
        : <span className="icon-btn-spacer" aria-hidden="true" />}
      {extra}
    </nav>
  );
}

export function Segmented({ label, items }: { label: string; items: { to: string; label: string; active: boolean }[] }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {items.map((it) => (
        <Link key={it.to} role="tab" to={it.to} aria-selected={it.active} className={it.active ? 'is-active' : ''}>{it.label}</Link>
      ))}
    </div>
  );
}

/** Loading placeholder, or the error with a retry button, for a screen whose data is not there yet. */
export function ScreenState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const i18n = useI18n();
  if (error) {
    return (
      <div className="stack">
        <Notice tone="alert" icon="alert" role="alert"><p>{i18n.t('app.loadFailed')} {i18n.errorText(error)}</p></Notice>
        <div className="cta-bar"><Button kind="primary" block onClick={onRetry}>{i18n.t('app.retry')}</Button></div>
      </div>
    );
  }
  return <p className="loading muted" role="status">{i18n.t('app.loading')}</p>;
}

/**
 * A modal sheet: a bottom sheet on phones, a side panel (or a popover for menus) from 900 px. The rest of the app is
 * inert while it is open, Escape and the backdrop close it, focus returns afterwards, and the automatic refresh waits.
 */
export function Sheet({ title, onClose, children, variant = 'sheet' }: {
  title: string; onClose: () => void; children: ReactNode; variant?: 'sheet' | 'popover';
}) {
  const i18n = useI18n();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useHold(true);
  useEffect(() => {
    const root = document.getElementById('root');
    const previous = document.activeElement as HTMLElement | null;
    root?.setAttribute('inert', '');
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      root?.removeAttribute('inert');
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);
  const host = document.getElementById('sheet-root');
  if (!host) return null;
  return createPortal(
    <div className={`sheet-layer sheet-layer-${variant}`}>
      <div className="sheet-backdrop" onClick={onClose} />
      <section className={`sheet sheet-${variant}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="sheet-head">
          <h2 id={titleId} tabIndex={-1} ref={titleRef}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={i18n.t('common.close')}><Icon name="x" /></button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>,
    host,
  );
}

/** An inline error inside a form (the toast says it too). */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="notice notice-alert form-error" role="alert">{message}</p>;
}
