// UC-04 / UC-05 / UC-12 Swaps (worker; my_requests, requestable_shifts): requests for me with Accept / Can't, my
// requests with the tracker and Cancel, and the history of both. The page's primary action starts the request flow.
import { rpc } from '../api';
import { Button, EmptyState, PageHead, ScreenState, Section } from '../components/ui';
import { useScreen, useShell } from '../context';
import { useI18n } from '../i18n';
import type { MyRequest, MyRequests, RequestableShift, RequestForMe } from '../types';
import { IncomingCard, MyRequestCard, type MyRequestView } from './RequestCards';

function myView(r: MyRequest): MyRequestView {
  return {
    id: r.id, status: r.status, work_date: r.shift.work_date, start_time: r.shift.start_time, end_time: r.shift.end_time,
    deadline: r.deadline, acceptorName: r.acceptor?.name ?? null, targets: r.targets,
  };
}

const isOpen = (status: string) => status === 'REQUESTED' || status === 'ACCEPTED';

export function Swaps() {
  const i18n = useI18n();
  const { user } = useShell();
  const screen = useScreen(async () => {
    const [requests, shifts] = await Promise.all([
      rpc<MyRequests>('my_requests', { p_worker_id: user!.id }),
      rpc<RequestableShift[]>('requestable_shifts', { p_worker_id: user!.id }),
    ]);
    return { requests, shifts };
  }, [user!.id]);
  const data = screen.data;
  if (!data) return <div className="screen" data-screen="swaps" data-loaded="false"><ScreenState error={screen.error} onRetry={screen.reload} /></div>;

  const { mine, for_me: forMe } = data.requests;
  const openForMe = forMe.filter((r) => r.status === 'REQUESTED' && r.my_response === 'PENDING');
  const pastForMe = forMe.filter((r) => !(r.status === 'REQUESTED' && r.my_response === 'PENDING'));
  const openMine = mine.filter((r) => isOpen(r.status));
  const pastMine = mine.filter((r) => !isOpen(r.status));
  const cta = (
    <Button kind="primary" block to="/swaps/new/1" disabled={data.shifts.length === 0} reason={i18n.t('swaps.findDisabled')} id="find-cover">
      {i18n.t('swaps.find')}
    </Button>
  );

  const pastLine = (r: RequestForMe) => {
    if (r.acceptor && r.acceptor.id !== user!.id) return i18n.t('home.taken', { name: i18n.name(r.acceptor.name) });
    const status = r.status === 'REQUESTED' || r.status === 'ACCEPTED' || r.status === 'APPROVED'
      ? i18n.t(`track.${r.status}`) : i18n.t(`end.${r.status}`);
    return `${i18n.t('answer.mine', { answer: i18n.t(`answer.${r.my_response}`) })}${i18n.t('common.sep')}${status}`;
  };

  return (
    <div className="screen" data-screen="swaps" data-loaded="true">
      <PageHead title={i18n.t('swaps.title')} sub={i18n.t('swaps.sub')} cta={cta} />
      <Section title={i18n.t('swaps.received')} count={openForMe.length || null} id="received-title">
        {openForMe.length ? (
          <div className="stack">
            {openForMe.map((r) => (
              <IncomingCard key={r.id} primary={false} r={{
                id: r.id, requesterName: r.requester.name, work_date: r.shift.work_date, start_time: r.shift.start_time,
                end_time: r.shift.end_time, reason: r.reason, deadline: r.deadline,
                effect: r.effect && {
                  from: r.effect.scheduled_before, to: r.effect.scheduled_after,
                  eligibleBefore: r.effect.eligible_before, eligibleAfter: r.effect.eligible_after,
                  holidayBefore: r.effect.holiday_pay_before, holidayAfter: r.effect.holiday_pay_after,
                  totalChange: r.effect.total_change,
                },
              }} />
            ))}
          </div>
        ) : <EmptyState text={i18n.t('swaps.receivedEmpty')} />}
      </Section>
      <Section title={i18n.t('swaps.sent')} count={openMine.length || null} id="sent-title">
        {openMine.length ? (
          <div className="stack">{openMine.map((r) => <MyRequestCard key={r.id} r={myView(r)} />)}</div>
        ) : <EmptyState text={i18n.t('swaps.sentEmpty')} />}
      </Section>
      {pastMine.length > 0 && (
        <Section title={i18n.t('swaps.past', { n: pastMine.length })} id="past-title">
          <div className="stack">{pastMine.map((r) => <MyRequestCard key={r.id} r={myView(r)} />)}</div>
        </Section>
      )}
      {pastForMe.length > 0 && (
        <Section title={i18n.t('swaps.pastReceived', { n: pastForMe.length })} id="past-received-title">
          <ul className="card list">
            {pastForMe.map((r) => (
              <li key={r.id} className="list-row" data-past-received={r.id}>
                <div className="list-main">
                  <strong>{i18n.t('owner.openLine', { name: i18n.name(r.requester.name), shift: i18n.shift(r.shift) })}</strong>
                  <span className="muted">{pastLine(r)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
