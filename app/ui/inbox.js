// Notifications (FR-21): each notification as a sentence with its time, newest first; actionable ones link to
// the card where the action is (Home), including the owner's unread PAYROLL_DRAFT_READY (UC-14).
import * as svc from '../core/services.js';
import { t, esc, fmtWhen, notificationText } from './i18n.js';
import { icon, button, pageHead, emptyState } from './components.js';

function actionable(n, user) {
  if (n.kind === 'REQUEST_FAILED' || n.kind === 'PAYROLL_DRAFT_READY') return !n.readAt;
  if (user.role === 'WORKER') return n.kind === 'REQUEST_RECEIVED' && n.state === 'OPEN';
  return n.kind === 'REQUEST_ACCEPTED' && n.requestStatus === 'ACCEPTED';
}

export function render(view, ctx) {
  const { items, unread } = svc.listNotifications(ctx.user.id);
  const cta = button({ label: t('notif.readAll'), kind: 'primary', block: true, id: 'read-all', disabled: unread === 0, reason: t('notif.readAllDisabled') });
  view.innerHTML = `
    ${pageHead({ title: t('notif.title'), sub: t('notif.sub'), cta })}
    ${items.length ? `<ul class="card list notif-list">${items.map((n) => `
      <li class="notif ${n.readAt ? '' : 'is-unread'}">
        <span class="notif-dot" aria-hidden="true"></span>
        <div class="notif-main">
          <p>${esc(notificationText(n, ctx.now, ctx.user))}</p>
          <p class="notif-meta"><time class="muted num" datetime="${esc(n.createdAt)}">${esc(fmtWhen(n.createdAt, ctx.now))}</time>
            ${n.readAt ? '' : `<span class="sr-only">${esc(t('notif.new'))}</span>`}</p>
        </div>
        ${actionable(n, ctx.user) ? `<a class="btn btn-secondary btn-small" href="#/home">${esc(t('notif.open'))}${icon('chevronRight')}</a>` : ''}
      </li>`).join('')}</ul>` : emptyState(t('notif.empty'))}`;
  const readAll = view.querySelector('#read-all');
  if (readAll && !readAll.disabled) readAll.addEventListener('click', async () => {
    try {
      await ctx.run(() => svc.markNotificationsRead(ctx.user.id));
    } catch (err) {
      ctx.fail(err);
      return;
    }
    ctx.toast(t('notif.readDone'));
    ctx.refresh();
  });
}
