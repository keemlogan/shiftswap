// Notifications (FR-21; notifications, mark_notifications_read): the inbox newest first, each sentence composed from the
// notification's kind and params in the chosen language; "Open" leads to the place where the action is (NFR-01: a
// candidate accepts in two clicks from the inbox).
import { useEffect } from 'react';
import { rpc } from '../api';
import { Button, EmptyState, PageHead, ScreenState } from '../components/ui';
import { useAction, useScreen, useShell } from '../context';
import { useI18n } from '../i18n';
import type { NotificationItem, Notifications } from '../types';

function target(n: NotificationItem): string | null {
  if (n.kind === 'PAYROLL_DRAFT_READY' && n.params.year_month) return `/pay/month/${n.params.year_month}`;
  if (n.kind === 'REQUEST_RECEIVED' || n.kind === 'REQUEST_ACCEPTED' || n.kind === 'REQUEST_FAILED') return '/home';
  return null;
}

export function NotificationsPage() {
  const i18n = useI18n();
  const { user, now, setUnread } = useShell();
  const act = useAction();
  const screen = useScreen(() => rpc<Notifications>('notifications', { p_worker_id: user!.id }), [user!.id]);
  useEffect(() => { if (screen.data) setUnread(screen.data.unread); }, [screen.data, setUnread]);
  const data = screen.data;
  if (!data) return <div className="screen" data-screen="notifications" data-loaded="false"><ScreenState error={screen.error} onRetry={screen.reload} /></div>;
  const readAll = () => act(() => rpc('mark_notifications_read', { p_worker_id: user!.id, p_ids: null }), i18n.t('notif.readDone'));
  return (
    <div className="screen" data-screen="notifications" data-loaded="true">
      <PageHead title={i18n.t('notif.title')} sub={i18n.t('notif.sub')}
        cta={<Button kind="primary" block onClick={readAll} disabled={data.unread === 0} reason={i18n.t('notif.readAllDisabled')} id="read-all">{i18n.t('notif.readAll')}</Button>} />
      {data.items.length ? (
        <ul className="card notif-list">
          {data.items.map((n) => {
            const to = target(n);
            return (
              <li key={n.id} className={`notif ${n.read_at ? '' : 'is-unread'}`} data-notification={n.kind}>
                <span className="notif-dot" aria-hidden="true" />
                <div>
                  <p>{i18n.notificationText(n, user!.role, now)}</p>
                  <p className="notif-meta">
                    <time className="muted num" dateTime={n.created_at}>{i18n.when(n.created_at, now)}</time>
                    {!n.read_at && <span className="sr-only">{i18n.t('notif.new')}</span>}
                  </p>
                </div>
                {to && <Button kind="secondary" small to={to}>{i18n.t('notif.open')}</Button>}
              </li>
            );
          })}
        </ul>
      ) : <EmptyState text={i18n.t('notif.empty')} />}
    </div>
  );
}
