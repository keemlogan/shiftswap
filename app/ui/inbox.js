// FR-21 Inbox and UC-05 Respond: a REQUEST_RECEIVED item has Accept / Decline on the item itself (NFR-01).
import * as svc from '../core/services.js';
import { t, esc, fmtDateTime, notificationText } from './i18n.js';

export function render(view, ctx) {
  const { user } = ctx;
  const { items } = svc.listNotifications(user.id);
  view.innerHTML = `
    <div class="page-head"><h1>${esc(t('inbox.title'))}</h1></div>
    ${items.length ? `<ul class="inbox">${items.map(item).join('')}</ul>` : `<p class="empty">${esc(t('inbox.empty'))}</p>`}`;

  view.querySelectorAll('[data-respond]').forEach((b) => b.addEventListener('click', () => {
    const response = b.dataset.respond;
    try {
      svc.respondToRequest(Number(b.dataset.request), user.id, response);
      ctx.flash(t(response === 'ACCEPTED' ? 'inbox.accepted' : 'inbox.declined'));
      ctx.refresh();
    } catch (err) {
      ctx.fail(err);
    }
  }));

  if (items.some((n) => !n.readAt)) {
    svc.markNotificationsRead(user.id);
    ctx.setUnread(0);
  }
}

function item(n) {
  const unread = !n.readAt;
  return `
    <li class="card note ${unread ? 'unread' : ''}">
      <div class="note-head">
        <time class="num muted" datetime="${esc(n.createdAt)}">${esc(fmtDateTime(n.createdAt))}</time>
        ${unread ? `<span class="chip chip-shift">${esc(t('inbox.new'))}</span>` : ''}
      </div>
      <p>${esc(notificationText(n))}</p>
      ${n.kind === 'REQUEST_RECEIVED' && n.reason ? `<p class="muted">${esc(t('requests.reasonText', { text: n.reason }))}</p>` : ''}
      ${n.kind === 'REQUEST_RECEIVED' ? receivedFooter(n) : ''}
    </li>`;
}

function receivedFooter(n) {
  switch (n.state) {
    case 'OPEN':
      return `<div class="actions">
        <button type="button" class="btn btn-primary" data-respond="ACCEPTED" data-request="${n.subRequestId}">${esc(t('inbox.accept'))}</button>
        <button type="button" class="btn" data-respond="DECLINED" data-request="${n.subRequestId}">${esc(t('inbox.decline'))}</button>
      </div>`;
    case 'TAKEN':
      return `<p class="taken"><span class="chip">${esc(t('inbox.taken', { name: n.acceptorName }))}</span></p>`;
    case 'ACCEPTED_BY_ME':
      return `<p><span class="chip chip-ok">${esc(t('inbox.youAccepted'))}</span></p>`;
    case 'DECLINED':
      return `<p><span class="chip">${esc(t('inbox.youDeclined'))}</span></p>`;
    default:
      return `<p><span class="chip">${esc(t(`inbox.closed${n.state}`))}</span></p>`;
  }
}
