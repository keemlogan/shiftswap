// Pay (owner). Weekly (week_summary, UC-08): one card per worker with holiday-allowance eligibility, the amount and the
// reason when there is none, and the substitution-attendance policy. Monthly (payroll_months, payroll_month,
// generate_payroll, acknowledge_min_wage, confirm_payroll; UC-09, UC-14): month navigation back to the first month with
// payroll, rows with their chips, the minimum-wage warnings to acknowledge, totals, and Confirm — disabled with its
// reason until every warning is acknowledged.
import { Link, Navigate, useParams } from 'react-router-dom';
import { rpc } from '../api';
import { Button, Chip, EmptyState, Notice, PageHead, PeriodNav, ScreenState, Segmented } from '../components/ui';
import { useAction, useScreen, useShell } from '../context';
import { addDays, addMonths, DATE_RE, MONTH_RE, weekStart } from '../dates';
import { useI18n } from '../i18n';
import type { PayrollMonth, PayrollMonthItem, WeekSummary } from '../types';

export function Pay() {
  const { tab, period } = useParams();
  const { now } = useShell();
  if (tab === 'week' && period && DATE_RE.test(period)) return <PayWeek key={weekStart(period)} week={weekStart(period)} />;
  if (tab === 'month' && period && MONTH_RE.test(period)) return <PayMonth key={period} month={period} />;
  if (!now) return <div className="screen" data-screen="pay" data-loaded="false"><ScreenState error={null} onRetry={() => undefined} /></div>;
  const today = now.slice(0, 10);
  return <Navigate to={tab === 'month' ? `/pay/month/${today.slice(0, 7)}` : `/pay/week/${weekStart(today)}`} replace />;
}

function Tabs({ active, week, month }: { active: 'week' | 'month'; week: string; month: string }) {
  const i18n = useI18n();
  return (
    <Segmented label={i18n.t('pay.title')} items={[
      { to: `/pay/week/${week}`, label: i18n.t('pay.weekly'), active: active === 'week' },
      { to: `/pay/month/${month}`, label: i18n.t('pay.monthly'), active: active === 'month' },
    ]} />
  );
}

function PayWeek({ week }: { week: string }) {
  const i18n = useI18n();
  const { now } = useShell();
  const screen = useScreen(() => rpc<WeekSummary>('week_summary', { p_week_start: week }), [week]);
  const data = screen.data;
  // The month that pays this week's holiday allowance is the month of its Sunday (BR-11).
  const month = addDays(week, 6).slice(0, 7);
  const thisWeek = now ? weekStart(now.slice(0, 10)) : null;
  return (
    <div className="screen" data-screen="pay-week" data-loaded={data ? 'true' : 'false'} data-week={week}>
      <PageHead title={i18n.t('pay.title')} cta={<Button kind="primary" block to={`/pay/month/${month}`} id="to-month">{i18n.t('pay.toMonth', { month: i18n.monthShort(month) })}</Button>} />
      <Tabs active="week" week={week} month={month} />
      <PeriodNav label={i18n.t('common.weekOf', { date: i18n.dateShort(week) })} prevTo={`/pay/week/${addDays(week, -7)}`} nextTo={`/pay/week/${addDays(week, 7)}`}
        prevLabel={i18n.t('common.prevWeek')} nextLabel={i18n.t('common.nextWeek')}
        extra={thisWeek && thisWeek !== week ? <Link className="btn btn-text btn-small" to={`/pay/week/${thisWeek}`}>{i18n.t('common.thisWeek')}</Link> : undefined} />
      {!data ? <ScreenState error={screen.error} onRetry={screen.reload} /> : (
        <>
          <p className="muted" data-policy={data.policy}>{i18n.t(data.policy === 'ABSENT' ? 'pay.policyNoteABSENT' : 'pay.policyNoteEXCUSED')}</p>
          {data.frozen && <Notice icon="info"><p>{i18n.t('pay.frozen')}</p></Notice>}
          {data.rows.length ? (
            <div className="grid-cards">
              {data.rows.map((r) => (
                <article key={r.worker_id} className={`card pay-card ${r.holiday_eligible ? 'is-ok' : ''}`} data-week-row={r.worker_id}
                  data-eligible={String(r.holiday_eligible)} data-holiday-pay={r.holiday_pay}>
                  <div className="card-row">
                    <h3 className="card-title">{i18n.name(r.name)}</h3>
                    <Chip tone={r.holiday_eligible ? 'ok' : 'neutral'}>{i18n.t(r.holiday_eligible ? 'pay.eligible' : 'pay.notEligible')}</Chip>
                  </div>
                  {r.holiday_eligible ? (
                    <>
                      <p className="key-number num">{i18n.won(r.holiday_pay)}</p>
                      <p className="muted num">{i18n.t('pay.holidayLine', { h: i18n.hours(r.holiday_hours), c: i18n.hours(r.contract_hours) })}</p>
                    </>
                  ) : (
                    <p className="reason" data-reason>{r.reasons.map((x) => (x.code === 'CONTRACT_BELOW_15'
                      ? i18n.t('pay.reasonContract', { h: i18n.hours(r.contract_hours) })
                      : x.code === 'ABSENT' ? i18n.t('reason.absent', { day: i18n.dateShort(x.date!) })
                        : i18n.t('reason.gaveAway', { day: i18n.dateShort(x.date!) }))).join(i18n.t('common.sep'))}</p>
                  )}
                  <p className="muted num">{i18n.t('pay.contractLine', { s: i18n.hours(r.scheduled_hours), a: i18n.hours(r.actual_hours) })}</p>
                </article>
              ))}
            </div>
          ) : <EmptyState text={i18n.t('pay.weekEmpty')} />}
        </>
      )}
    </div>
  );
}

function PayMonth({ month }: { month: string }) {
  const i18n = useI18n();
  const { settings } = useShell();
  const act = useAction();
  const screen = useScreen(async () => {
    const [m, months] = await Promise.all([
      rpc<PayrollMonth>('payroll_month', { p_year_month: month }),
      rpc<PayrollMonthItem[]>('payroll_months'),
    ]);
    return { m, months };
  }, [month]);
  const data = screen.data;
  const label = i18n.monthShort(month);
  const week = weekStart(`${month}-01`);
  const prev = addMonths(month, -1);
  const first = data?.months[0]?.year_month ?? null;

  const generate = () => act(() => rpc('generate_payroll', { p_year_month: month }), i18n.t('pay.drafted', { month: label }));
  const ack = (workerId: number) => act(() => rpc('acknowledge_min_wage', { p_year_month: month, p_worker_id: workerId }), i18n.t('pay.ackDone'));
  const confirm = () => act(() => rpc('confirm_payroll', { p_year_month: month }), i18n.t('pay.confirmed', { month: label }));

  let cta: JSX.Element | undefined;
  if (data) {
    const m = data.m;
    if (m.status === 'NONE') cta = <Button kind="primary" block onClick={generate} id="make-draft">{i18n.t('pay.makeDraft', { month: label })}</Button>;
    else if (m.status === 'DRAFT') {
      cta = <Button kind="primary" block onClick={confirm} id="confirm-payroll" disabled={m.unacknowledged_warnings > 0}
        reason={i18n.t('pay.confirmBlocked', { n: m.unacknowledged_warnings })}>{i18n.t('pay.confirm', { month: label })}</Button>;
    } else cta = <Button kind="primary" block disabled reason={i18n.t('pay.confirmedNote', { month: label })} id="confirmed-payroll">{i18n.t('pay.confirmedButton', { month: label })}</Button>;
  }
  const statusChip = data && data.m.status !== 'NONE'
    ? <Chip tone={data.m.status === 'CONFIRMED' ? 'ok' : 'primary'}>{i18n.t(data.m.status === 'CONFIRMED' ? 'pay.monthConfirmed' : 'pay.monthDraft')}</Chip> : undefined;
  const cols = ['pay.baseHours', 'pay.basePay', 'pay.holidayPay', 'pay.premiumPay', 'pay.total'] as const;

  return (
    <div className="screen" data-screen="pay-month" data-loaded={data ? 'true' : 'false'} data-month={month} data-status={data?.m.status}>
      <PageHead title={i18n.t('pay.title')} cta={cta} />
      <Tabs active="month" week={week} month={month} />
      <PeriodNav label={i18n.month(month)} prevTo={first && prev < first ? null : `/pay/month/${prev}`} nextTo={`/pay/month/${addMonths(month, 1)}`}
        prevLabel={i18n.t('common.prevMonth')} nextLabel={i18n.t('common.nextMonth')} extra={statusChip} />
      {!data ? <ScreenState error={screen.error} onRetry={screen.reload} /> : (
        <>
          {data.m.status === 'CONFIRMED' && <Notice tone="ok" icon="check"><p>{i18n.t('pay.confirmedNote', { month: label })}</p></Notice>}
          {data.m.status === 'DRAFT' && data.m.auto_prepared && <Notice icon="clock"><p data-auto-note>{i18n.t('pay.autoNote')}</p></Notice>}
          {first && month === first && <p className="hint">{i18n.t('pay.firstMonth', { month: i18n.month(first) })}</p>}
          {data.m.rows.length ? (
            <table className="dtable pay-table">
              <thead>
                <tr>
                  <th scope="col">{i18n.t('pay.worker')}</th>
                  {cols.map((c) => <th key={c} scope="col" className="numh">{i18n.t(c)}</th>)}
                  <th scope="col">{i18n.t('pay.flags')}</th>
                </tr>
              </thead>
              <tbody>
                {data.m.rows.flatMap((r) => {
                  const min = r.probation_minimum ?? data.m.minimum_hourly ?? 0;
                  const row = (
                    <tr key={r.id} className={r.min_wage_warning ? 'row-warning' : ''} data-pay-row={r.worker_id} data-total={r.total}>
                      <th scope="row">{i18n.name(r.name)}</th>
                      <td className="num" data-label={i18n.t(cols[0])}>{i18n.hours(r.base_hours)}</td>
                      <td className="num" data-label={i18n.t(cols[1])}>{i18n.won(r.base_pay)}</td>
                      <td className="num" data-label={i18n.t(cols[2])}>{i18n.won(r.holiday_pay)}</td>
                      <td className="num" data-label={i18n.t(cols[3])}>{i18n.won(r.premium_pay)}</td>
                      <td className="num strong" data-label={i18n.t(cols[4])}>{i18n.won(r.total)}</td>
                      <td className="flags" data-label={i18n.t('pay.flags')}>
                        <Chip tone={r.status === 'CONFIRMED' ? 'ok' : 'primary'}>{i18n.t(r.status === 'CONFIRMED' ? 'pay.statusCONFIRMED' : 'pay.statusDRAFT')}</Chip>
                        {r.estimated && <Chip>{i18n.t('pay.estimated')}</Chip>}
                        {r.probation_minimum != null && <Chip data-probation>{i18n.t('pay.probation', { min: i18n.won(r.probation_minimum) })}</Chip>}
                        {r.min_wage_warning && <Chip tone="alert">{i18n.t('pay.belowMin')}</Chip>}
                      </td>
                    </tr>
                  );
                  if (!r.min_wage_warning) return [row];
                  return [row, (
                    <tr key={`${r.id}-w`} className="warning-row">
                      <td colSpan={7}>
                        <div className="warning-box">
                          <p data-min-warning={r.worker_id}>{i18n.t('pay.minSentence', { name: i18n.name(r.name), wage: i18n.won(r.hourly_wage), year: month.slice(0, 4), min: i18n.won(min) })}</p>
                          {r.min_wage_ack ? <Chip tone="ok">{i18n.t('pay.acked')}</Chip>
                            : r.status === 'DRAFT' ? <Button kind="secondary" small onClick={() => ack(r.worker_id)} data-ack={r.worker_id}>{i18n.t('pay.ack')}</Button> : null}
                        </div>
                      </td>
                    </tr>
                  )];
                })}
              </tbody>
              <tfoot>
                <tr data-pay-total={data.m.totals.total}>
                  <th scope="row">{i18n.t('pay.sum')}</th>
                  <td className="num" data-label={i18n.t(cols[0])}>{i18n.hours(data.m.totals.base_hours)}</td>
                  <td className="num" data-label={i18n.t(cols[1])}>{i18n.won(data.m.totals.base_pay)}</td>
                  <td className="num" data-label={i18n.t(cols[2])}>{i18n.won(data.m.totals.holiday_pay)}</td>
                  <td className="num" data-label={i18n.t(cols[3])}>{i18n.won(data.m.totals.premium_pay)}</td>
                  <td className="num strong" data-label={i18n.t(cols[4])}>{i18n.won(data.m.totals.total)}</td>
                  <td className="spacer" />
                </tr>
              </tfoot>
            </table>
          ) : <EmptyState text={i18n.t('pay.noDraft', { month: i18n.month(month) })} />}
          {data.m.rows.length > 0 && (
            <div className="notes">
              {data.m.rows.some((r) => r.estimated) && <p className="hint">{i18n.t('pay.estimatedHint')}</p>}
              {settings && <p className="hint">{i18n.t('pay.premiumNote', { n: settings.workplace.regular_employees })}</p>}
              {data.m.status === 'DRAFT' && <Button kind="text" icon="swap" onClick={generate} id="rebuild-draft">{i18n.t('pay.remake')}</Button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

