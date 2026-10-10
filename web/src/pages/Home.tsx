// Home (NFR-13): what is waiting for this person right now, most urgent first, each item with its own action. The first
// actionable item carries the screen's single primary button; the rest are secondary.
//   Worker (worker_home): requests for me with the effect on my week, my requests (FAILED to acknowledge, open ones with
//   the tracker), shifts to record, the next shift with "Find a substitute", this week's hours.
//   Owner (owner_home, whose decisions are approval_preview results): decisions, FAILED requests to acknowledge,
//   attendance to confirm, payroll drafts ready, requests waiting for replies, today's shifts, the week's totals.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../api';
import { Button, Chip, Hero, Icon, ScreenState, Section } from '../components/ui';
import { useAction, useScreen, useShell } from '../context';
import { useI18n } from '../i18n';
import type { OwnerHome as OwnerHomeData, Shift, WeekCalc, WorkerHome as WorkerHomeData } from '../types';
import { RecordSheet } from './Attendance';
import { DecisionCard } from './Decision';
import { Answers, FailedCard, IncomingCard, MyRequestCard, TakenCard } from './RequestCards';

export function Home() {
  const { user } = useShell();
  if (!user) return null;
  return user.role === 'OWNER' ? <OwnerHome /> : <WorkerHome userId={user.id} />;
}

// ---- Worker ------------------------------------------------------------------------------------------------------

function WeekCard({ week }: { week: WeekCalc }) {
  const i18n = useI18n();
  const scale = Math.max(20, week.contract_hours + 2);
  const fill = Math.min(100, (week.contract_hours / scale) * 100);
  const line = (15 / scale) * 100;
  let text: string;
  if (week.holiday_eligible) text = i18n.t('holiday.yes', { amount: i18n.won(week.holiday_pay) });
  else if (week.reasons.some((r) => r.code === 'CONTRACT_BELOW_15')) text = i18n.t('holiday.noContract', { h: i18n.hours(week.contract_hours) });
  else {
    const r = week.reasons.find((x) => x.code === 'ABSENT') ?? week.reasons.find((x) => x.code === 'GAVE_AWAY');
    text = r && r.code === 'ABSENT' ? i18n.t('holiday.noAbsent', { day: i18n.date(r.date!) })
      : i18n.t('holiday.noGaveAway', { day: r?.date ? i18n.date(r.date) : '' });
  }
  return (
    <section className="card" aria-labelledby="week-title" data-week-card>
      <h2 className="card-title" id="week-title">{i18n.t('home.week')}</h2>
      <div className="kpis">
        <div className="kpi"><span className="kpi-label">{i18n.t('home.scheduled')}</span><span className="kpi-value num" data-scheduled>{i18n.hours(week.scheduled_hours)}</span></div>
        <div className="kpi"><span className="kpi-label">{i18n.t('home.contract')}</span><span className="kpi-value num">{i18n.perWeek(week.contract_hours)}</span></div>
      </div>
      <div className="meter" role="img" aria-label={`${i18n.t('home.contract')} ${i18n.perWeek(week.contract_hours)}, ${i18n.t('home.line15')}`}>
        <span className={`meter-fill ${week.reasons.some((r) => r.code === 'CONTRACT_BELOW_15') ? '' : 'is-ok'}`} style={{ width: `${fill}%` }} />
        <span className="meter-line" style={{ left: `${line}%` }}><span className="meter-line-label">{i18n.t('home.line15')}</span></span>
      </div>
      <p className={`holiday ${week.holiday_eligible ? 'is-ok' : ''}`} data-holiday>
        <Icon name={week.holiday_eligible ? 'check' : 'info'} /><span>{text}</span>
      </p>
    </section>
  );
}

function WorkerHome({ userId }: { userId: number }) {
  const i18n = useI18n();
  const { setUnread, now } = useShell();
  const screen = useScreen(() => rpc<WorkerHomeData>('worker_home', { p_worker_id: userId }), [userId]);
  const [recording, setRecording] = useState<Shift | null>(null);
  useEffect(() => { if (screen.data) setUnread(screen.data.unread); }, [screen.data, setUnread]);
  const h = screen.data;
  if (!h) return <div className="screen" data-screen="home" data-loaded="false"><ScreenState error={screen.error} onRetry={screen.reload} /></div>;

  const nextPending = !!h.next_shift && h.my_open.some((r) => r.shift_id === h.next_shift!.id);
  const primary = h.incoming.length ? 'incoming' : h.failed.length ? 'failed' : h.to_record.length ? 'record'
    : h.next_shift && !nextPending ? 'next' : 'fallback';
  const busy = h.incoming.length + h.failed.length + h.my_open.length + h.to_record.length > 0;
  const today = h.today ?? now?.slice(0, 10);

  return (
    <div className="screen" data-screen="home" data-loaded="true">
      <Hero kicker={today ? i18n.date(today) : undefined} title={i18n.t('home.greeting', { name: i18n.name(h.worker.name) })}
        sub={busy ? undefined : i18n.t('home.nothing')} />
      {primary === 'fallback' && (
        <div className="cta-bar"><Button kind="primary" block to="/schedule">{i18n.t('home.openSchedule')}</Button></div>
      )}
      {(h.incoming.length > 0 || h.taken.length > 0) && (
        <Section title={i18n.t('home.incoming')} count={h.incoming.length || null} id="incoming-title">
          <div className="stack">
            {h.incoming.map((r, i) => (
              <IncomingCard key={r.request_id} primary={primary === 'incoming' && i === 0} r={{
                id: r.request_id, requesterName: r.requester_name, work_date: r.work_date, start_time: r.start_time,
                end_time: r.end_time, reason: r.reason, deadline: r.deadline,
                effect: {
                  from: r.effect.before.scheduled_hours, to: r.effect.after.scheduled_hours,
                  eligibleBefore: r.effect.before.holiday_eligible, eligibleAfter: r.effect.after.holiday_eligible,
                  holidayBefore: r.effect.before.holiday_pay, holidayAfter: r.effect.after.holiday_pay,
                  why: i18n.reasonText(r.effect.after.reasons, r.effect.after.contract_hours),
                  totalChange: r.effect.change.total,
                },
              }} />
            ))}
            {h.taken.map((r) => <TakenCard key={r.request_id} acceptorName={r.acceptor_name ?? ''} shift={r} />)}
          </div>
        </Section>
      )}
      {(h.my_open.length > 0 || h.failed.length > 0) && (
        <Section title={i18n.t('home.myRequests')} id="mine-title">
          <div className="stack">
            {h.failed.map((f, i) => (
              <FailedCard key={f.notification_id} notificationId={f.notification_id} shift={f} primary={primary === 'failed' && i === 0} />
            ))}
            {h.my_open.map((r) => (
              <MyRequestCard key={r.request_id} r={{
                id: r.request_id, status: r.status, work_date: r.work_date, start_time: r.start_time, end_time: r.end_time,
                deadline: r.deadline, acceptorName: r.acceptor_name, targets: r.targets,
              }} />
            ))}
          </div>
        </Section>
      )}
      {h.to_record.length > 0 && (
        <Section title={i18n.t('home.toRecord')} count={h.to_record.length} id="record-title">
          <ul className="card list">
            {h.to_record.map((s, i) => (
              <li key={s.id} className="list-row">
                <div className="list-main"><strong>{i18n.date(s.work_date)}</strong><span className="muted num">{i18n.range(s.start_time, s.end_time)}</span></div>
                <Button kind={primary === 'record' && i === 0 ? 'primary' : 'secondary'} small onClick={() => setRecording(s)} data-record={s.id}>
                  {i18n.t('home.record')}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {h.next_shift && (
        <Section>
          <section className={`card next-card ${nextPending ? 'pending' : ''}`} aria-labelledby="next-title" data-next-shift={h.next_shift.id}>
            <div className="card-row">
              <h2 className="card-title" id="next-title">{i18n.t('home.next')}</h2>
              <Chip tone="primary">{i18n.dday(h.next_shift.work_date, h.now)}</Chip>
            </div>
            <p className="big-date">{i18n.date(h.next_shift.work_date)}</p>
            <p className="big-time num">{i18n.range(h.next_shift.start_time, h.next_shift.end_time)}</p>
            {nextPending ? <p><Chip tone="handover">{i18n.t('home.nextPending')}</Chip></p> : (
              <div className="actions">
                <Button kind={primary === 'next' ? 'primary' : 'secondary'} block to={`/swaps/new/1/${h.next_shift.id}`} data-find-cover={h.next_shift.id}>
                  {i18n.t('home.findCover')}
                </Button>
              </div>
            )}
          </section>
        </Section>
      )}
      <Section><WeekCard week={h.week} /></Section>
      {recording && <RecordSheet shift={recording} onClose={() => setRecording(null)} />}
    </div>
  );
}

// ---- Owner -------------------------------------------------------------------------------------------------------

function OwnerHome() {
  const i18n = useI18n();
  const navigate = useNavigate();
  const act = useAction();
  const { user, setUnread } = useShell();
  const screen = useScreen(() => rpc<OwnerHomeData>('owner_home'), []);
  useEffect(() => { if (screen.data) setUnread(screen.data.unread); }, [screen.data, setUnread]);
  const h = screen.data;
  if (!h) return <div className="screen" data-screen="home" data-loaded="false"><ScreenState error={screen.error} onRetry={screen.reload} /></div>;

  const readyMonths = new Set(h.payroll_ready.map((p) => p.year_month));
  const warnings = h.pay_warnings.filter((w) => !readyMonths.has(w.year_month));
  const tasks = h.decisions.length + h.failed.length + h.to_confirm.length + h.payroll_ready.length + warnings.length;
  const primary = h.decisions.length ? 'decision' : h.failed.length ? 'failed' : h.to_confirm.length ? 'confirm'
    : h.payroll_ready.length ? 'payroll' : warnings.length ? 'warning' : 'fallback';

  const ackFailed = (id: number) => act(() => rpc('mark_notifications_read', { p_worker_id: user!.id, p_ids: [id] }), i18n.t('failed.acked'));
  const confirm = (id: number) => act(() => rpc('confirm_attendance', { p_shift_id: id }), i18n.t('owner.confirmed'));
  const absent = (id: number) => act(() => rpc('mark_absent', { p_shift_id: id }), i18n.t('owner.markedAbsent'));
  const openPayroll = async (notificationId: number, ym: string) => {
    // Opening the draft is what "read" means for PAYROLL_DRAFT_READY (UC-14).
    try {
      await rpc('mark_notifications_read', { p_worker_id: user!.id, p_ids: [notificationId] });
    } catch {
      // The draft opens anyway; the card stays until the next read succeeds.
    }
    navigate(`/pay/month/${ym}`);
  };

  return (
    <div className="screen" data-screen="home" data-loaded="true">
      <Hero kicker={i18n.date(h.today)} title={tasks === 1 ? i18n.t('owner.task1') : tasks ? i18n.t('owner.tasks', { n: tasks }) : i18n.t('owner.noTasks')} />
      {primary === 'fallback' && (
        <div className="cta-bar"><Button kind="primary" block to="/schedule">{i18n.t('home.openSchedule')}</Button></div>
      )}
      {h.decisions.length > 0 && (
        <Section title={i18n.t('owner.decisions')} count={h.decisions.length} id="decisions-title">
          <div className="stack">
            {h.decisions.map((d, i) => <DecisionCard key={d.request_id} d={d} primary={primary === 'decision' && i === 0} />)}
          </div>
        </Section>
      )}
      {h.failed.length > 0 && (
        <Section title={i18n.t('owner.failed')} count={h.failed.length} id="failed-title">
          <div className="stack">
            {h.failed.map((f, i) => (
              <article key={f.notification_id} className="card" data-owner-failed={f.notification_id}>
                <div className="card-row">
                  <h3 className="card-title">{i18n.t('owner.failedLine', { name: i18n.name(f.requester_name), shift: i18n.shift(f) })}</h3>
                  <Icon name="alert" className="alert-icon" />
                </div>
                <div className="actions">
                  <Button kind={primary === 'failed' && i === 0 ? 'primary' : 'secondary'} block onClick={() => ackFailed(f.notification_id)}
                    data-ack-failed={f.notification_id}>{i18n.t('failed.ack')}</Button>
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}
      {h.to_confirm.length > 0 && (
        <Section title={i18n.t('owner.toConfirm')} count={h.to_confirm.length} id="confirm-title">
          <div className="stack">
            {h.to_confirm.map((s, i) => (
              <article key={s.id} className="card" data-to-confirm={s.id}>
                <h3 className="card-title">{i18n.name(s.worker_name)}{i18n.t('common.sep')}<span className="num">{i18n.shift(s)}</span></h3>
                <p className="muted num">{i18n.t('owner.recorded', { range: i18n.range(s.clock_in, s.clock_out) })}</p>
                <div className="actions">
                  <Button kind={primary === 'confirm' && i === 0 ? 'primary' : 'secondary'} block onClick={() => confirm(s.id)} data-confirm={s.id}>{i18n.t('owner.confirm')}</Button>
                  <Button kind="text" onClick={() => absent(s.id)} data-absent={s.id}>{i18n.t('owner.absent')}</Button>
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}
      {h.payroll_ready.length > 0 && (
        <Section title={i18n.t('owner.payrollReady')} id="payroll-title">
          <div className="stack">
            {h.payroll_ready.map((p, i) => (
              <article key={p.notification_id} className="card" data-payroll-card={p.year_month}>
                <div className="card-row">
                  <h3 className="card-title">{i18n.t('owner.payrollReadyLine', { month: i18n.monthShort(p.year_month) })}</h3>
                  <Icon name="pay" />
                </div>
                <div className="actions">
                  <Button kind={primary === 'payroll' && i === 0 ? 'primary' : 'secondary'} block onClick={() => openPayroll(p.notification_id, p.year_month)}
                    data-payroll-ready={p.year_month}>{i18n.t('owner.payrollOpen')}</Button>
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}
      {warnings.length > 0 && (
        <Section title={i18n.t('owner.payWarnings')} count={warnings.length} id="warnings-title">
          <div className="stack">
            {warnings.map((w, i) => (
              <article key={`${w.year_month}-${w.worker_id}`} className="card">
                <div className="card-row">
                  <h3 className="card-title">{i18n.t('owner.payWarning', { name: i18n.name(w.name), year: w.year_month.slice(0, 4) })}</h3>
                  <Icon name="alert" className="alert-icon" />
                </div>
                <div className="actions">
                  <Button kind={primary === 'warning' && i === 0 ? 'primary' : 'secondary'} block to={`/pay/month/${w.year_month}`}>{i18n.t('owner.toPay')}</Button>
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}
      {h.open.length > 0 && (
        <Section title={i18n.t('owner.open')} count={h.open.length} id="open-title">
          <div className="stack">
            {h.open.map((r) => (
              <article key={r.request_id} className="card" data-open-request={r.request_id}>
                <h3 className="card-title">{i18n.t('owner.openLine', { name: i18n.name(r.requester_name), shift: i18n.shift(r) })}</h3>
                <p className="deadline"><Icon name="clock" /><span>{i18n.t('common.until', { when: i18n.when(r.deadline, h.now) })}</span></p>
                <Answers targets={r.targets} />
              </article>
            ))}
          </div>
        </Section>
      )}
      <Section title={i18n.t('owner.today')} id="today-title">
        {h.today_shifts.length ? (
          <ul className="card list">
            {h.today_shifts.map((s) => (
              <li key={s.id} className={`list-row ${s.original_worker_id ? 'handover' : ''}`}>
                <div className="list-main"><strong>{i18n.name(s.worker_name)}</strong><span className="muted num">{i18n.range(s.start_time, s.end_time)}</span></div>
                {s.status !== 'SCHEDULED' && <div className="list-side"><Chip tone={s.status === 'WORKED' ? 'ok' : 'alert'}>{i18n.t(`shift.${s.status}`)}</Chip></div>}
              </li>
            ))}
          </ul>
        ) : <p className="card muted">{i18n.t('owner.todayNone')}</p>}
      </Section>
      <Section title={i18n.t('owner.week')} id="week-title">
        <div className="card kpis kpis-4" data-week-totals>
          <div className="kpi"><span className="kpi-label">{i18n.t('owner.kpiShifts')}</span><span className="kpi-value num">{i18n.t('owner.kpiShiftsValue', { n: h.week.shifts })}</span></div>
          <div className="kpi"><span className="kpi-label">{i18n.t('owner.kpiHours')}</span><span className="kpi-value num">{i18n.hours(h.week.hours)}</span></div>
          <div className="kpi"><span className="kpi-label">{i18n.t('owner.kpiHoliday')}</span><span className="kpi-value num">{i18n.won(h.week.holiday_total)}</span></div>
          <div className="kpi"><span className="kpi-label">{i18n.t('owner.kpiCost')}</span><span className="kpi-value num">{i18n.won(h.week.labour_cost)}</span></div>
        </div>
      </Section>
    </div>
  );
}
