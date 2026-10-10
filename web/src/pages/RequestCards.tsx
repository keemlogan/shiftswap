// UC-04 / UC-05 / UC-12 cards shared by Home and Swaps: a request for me (with the effect of accepting on my week,
// Accept / Can't), a request someone else took first, my own request with its tracker, and my FAILED request.
import { Button, Chip, Icon, Tracker } from '../components/ui';
import { useAction, useShell } from '../context';
import { rpc } from '../api';
import { useI18n } from '../i18n';
import type { RequestStatus, Target } from '../types';

/** The effect of taking the shift on my week (from the database: ss_swap_effect for me as the acceptor). */
export interface AcceptEffect {
  from: number;
  to: number;
  eligibleBefore: boolean;
  eligibleAfter: boolean;
  holidayBefore: number;
  holidayAfter: number;
  /** Why there is no holiday allowance after accepting (BR-06), when known. */
  why?: string;
  totalChange: number;
}

export interface IncomingView {
  id: number;
  requesterName: string;
  work_date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  deadline: string;
  effect: AcceptEffect | null;
}

export function EffectBox({ effect }: { effect: AcceptEffect }) {
  const i18n = useI18n();
  const changed = effect.eligibleBefore !== effect.eligibleAfter || effect.holidayBefore !== effect.holidayAfter;
  const amount = (eligible: boolean, pay: number) => (eligible ? i18n.won(pay) : i18n.t('eligible.false'));
  let holiday: JSX.Element;
  if (changed) {
    holiday = <mark className="hl">{i18n.t('effect.holidayChanged', { from: amount(effect.eligibleBefore, effect.holidayBefore), to: amount(effect.eligibleAfter, effect.holidayAfter) })}</mark>;
  } else if (effect.eligibleAfter) {
    holiday = <span>{i18n.t('effect.holidaySame', { amount: i18n.won(effect.holidayAfter) })}</span>;
  } else {
    holiday = <span>{effect.why ? i18n.t('effect.holidayNone', { why: effect.why }) : i18n.t('effect.holidayNoneShort')}</span>;
  }
  return (
    <div className={`effect ${changed ? 'effect-changed' : ''}`} data-effect>
      <p className="num"><strong>{i18n.t('effect.accept', { from: i18n.hours(effect.from), to: i18n.hours(effect.to) })}</strong></p>
      <p>{holiday}{i18n.t('common.sep')}<span className="num">{i18n.t('effect.pay', { amount: i18n.signedWon(effect.totalChange) })}</span></p>
    </div>
  );
}

/** A request sent to me: who asks, the shift, reason, deadline, the effect of accepting, Accept / Can't. */
export function IncomingCard({ r, primary }: { r: IncomingView; primary: boolean }) {
  const i18n = useI18n();
  const { user, now } = useShell();
  const act = useAction();
  const accept = () => act(() => rpc('accept_sub_request', { p_request_id: r.id, p_worker_id: user!.id }),
    i18n.t('home.accepted', { day: i18n.dayLong(r.work_date) }));
  const decline = () => act(() => rpc('decline_sub_request', { p_request_id: r.id, p_worker_id: user!.id }),
    i18n.t('home.declined'));
  return (
    <article className="card" data-incoming={r.id} aria-labelledby={`in-${r.id}`}>
      <div className="card-row">
        <h3 className="card-title" id={`in-${r.id}`}>{i18n.t('home.asks', { name: i18n.name(r.requesterName) })}</h3>
        <Chip tone="handover">{i18n.dday(r.work_date, now)}</Chip>
      </div>
      <p className="shift-line num">{i18n.shift(r)}</p>
      {r.reason && <p className="muted">{i18n.t('home.reason', { text: r.reason })}</p>}
      <p className="deadline"><Icon name="clock" /><span>{i18n.t('home.replyBy', { when: i18n.when(r.deadline, now) })}</span></p>
      {r.effect && <EffectBox effect={r.effect} />}
      <div className="actions">
        <Button kind={primary ? 'primary' : 'secondary'} block onClick={accept} data-accept={r.id}>{i18n.t('home.accept')}</Button>
        <Button kind="text" onClick={decline} data-decline={r.id}>{i18n.t('home.decline')}</Button>
      </div>
    </article>
  );
}

/** A request I was asked for that someone else accepted first. */
export function TakenCard({ acceptorName, shift }: { acceptorName: string; shift: { work_date: string; start_time: string; end_time: string } }) {
  const i18n = useI18n();
  return (
    <article className="card req-closed" data-taken>
      <div className="card-row">
        <h3 className="card-title">{i18n.t('home.taken', { name: i18n.name(acceptorName) })}</h3>
        <Icon name="check" className="muted-icon" />
      </div>
      <p className="muted">{i18n.t('home.takenSub', { shift: i18n.shift(shift) })}</p>
    </article>
  );
}

export function Answers({ targets }: { targets: Target[] }) {
  const i18n = useI18n();
  if (!targets.length) return <p className="muted">{i18n.t('answer.none')}</p>;
  return (
    <ul className="answers">
      {targets.map((x) => (
        <li key={x.worker_id} className={`answer answer-${x.response.toLowerCase()}`}>
          {i18n.t('answer.line', { name: i18n.name(x.name), answer: i18n.t(`answer.${x.response}`) })}
        </li>
      ))}
    </ul>
  );
}

export interface MyRequestView {
  id: number;
  status: RequestStatus;
  work_date: string;
  start_time: string;
  end_time: string;
  deadline: string;
  acceptorName: string | null;
  targets: Target[];
}

/** One of my requests with the tracker Requested → Accepted → Approved; an open one can be cancelled. */
export function MyRequestCard({ r }: { r: MyRequestView }) {
  const i18n = useI18n();
  const { user, now } = useShell();
  const act = useAction();
  const open = r.status === 'REQUESTED' || r.status === 'ACCEPTED';
  const cancel = () => act(() => rpc('cancel_sub_request', { p_request_id: r.id, p_requester_id: user!.id }),
    i18n.t('swaps.cancelled'));
  return (
    <article className="card" data-my-request={r.id} data-status={r.status}>
      <div className="card-row"><h3 className="card-title num">{i18n.shift(r)}</h3></div>
      <Tracker status={r.status} />
      {r.status === 'REQUESTED' && (
        <>
          <p className="status-line">{i18n.t('status.waitingReplies')}{i18n.t('common.sep')}{i18n.t('common.until', { when: i18n.when(r.deadline, now) })}</p>
          <Answers targets={r.targets} />
        </>
      )}
      {r.status === 'FAILED' && <Answers targets={r.targets} />}
      {r.status === 'ACCEPTED' && <p className="status-line">{i18n.t('status.waitingOwner', { name: i18n.name(r.acceptorName) })}</p>}
      {r.status === 'APPROVED' && <p className="status-line">{i18n.t('status.approved', { name: i18n.name(r.acceptorName) })}</p>}
      {open && (
        <div className="actions actions-end">
          <Button kind="text" onClick={cancel} data-cancel={r.id}>{i18n.t('swaps.cancel')}</Button>
        </div>
      )}
    </article>
  );
}

/** BR-13: my request ended FAILED; shown until I acknowledge its notification. */
export function FailedCard({ notificationId, shift, primary }: {
  notificationId: number; shift: { work_date: string; start_time: string; end_time: string }; primary: boolean;
}) {
  const i18n = useI18n();
  const { user } = useShell();
  const act = useAction();
  const ack = () => act(() => rpc('mark_notifications_read', { p_worker_id: user!.id, p_ids: [notificationId] }),
    i18n.t('failed.acked'));
  return (
    <article className="card" data-failed={notificationId}>
      <div className="card-row"><h3 className="card-title num">{i18n.shift(shift)}</h3></div>
      <Tracker status="FAILED" />
      <div className="actions">
        <Button kind={primary ? 'primary' : 'secondary'} block onClick={ack} data-ack-failed={notificationId}>{i18n.t('failed.ack')}</Button>
      </div>
    </article>
  );
}
