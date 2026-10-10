// UC-06 Approve or reject substitution (FR-11, FR-24, BR-15, BR-16): the owner's decision card with one line per
// worker (hours before → after, holiday allowance before → after with any change highlighted, pay change) and the
// store's labour-cost change, the part-time warning, and the full preview behind "Details". Every number comes from
// approval_preview (embedded in owner_home.decisions).
import { useId, useState } from 'react';
import { rpc } from '../api';
import { Button, Notice } from '../components/ui';
import { useAction } from '../context';
import { useI18n, type I18n, type TextKey } from '../i18n';
import type { ApprovalPreview, PersonEffect, WeekCalc } from '../types';

function holidayChanged(p: PersonEffect): boolean {
  return p.eligibility_changed || p.before.holiday_pay !== p.after.holiday_pay;
}

function holidayAmount(i18n: I18n, w: WeekCalc): string {
  return w.holiday_eligible ? i18n.won(w.holiday_pay) : i18n.t('eligible.false');
}

/** One worker of the swap: hours, holiday allowance and pay change in one line. */
function PersonLine({ p, premiums }: { p: PersonEffect; premiums: boolean }) {
  const i18n = useI18n();
  const changed = holidayChanged(p);
  let holiday: JSX.Element;
  if (changed) {
    holiday = (
      <mark className="hl" data-holiday-change>
        {i18n.t('owner.holidayChanged', { from: holidayAmount(i18n, p.before), to: holidayAmount(i18n, p.after), delta: i18n.signedWon(p.change.holiday_pay) })}
      </mark>
    );
  } else if (p.after.holiday_eligible) {
    holiday = <span>{i18n.t('owner.holidayKeep', { amount: i18n.won(p.after.holiday_pay) })}</span>;
  } else {
    const why = i18n.reasonText(p.after.reasons, p.after.contract_hours);
    holiday = <span>{why ? i18n.t('owner.holidayNone', { why }) : i18n.t('owner.holidayNoneShort')}</span>;
  }
  const sep = <span aria-hidden="true">·</span>;
  return (
    <li className={`person-effect ${changed ? 'is-changed' : ''}`} data-person={p.worker_id}>
      <strong>{i18n.person(p.name)}</strong>
      <span className="num">{i18n.t('owner.hours', { from: i18n.hours(p.before.scheduled_hours), to: i18n.hours(p.after.scheduled_hours) })}</span>
      {sep}
      {holiday}
      {sep}
      <span className="num">{i18n.t('owner.pay', { amount: i18n.signedWon(p.change.base_pay) })}</span>
      {premiums && <>{sep}<span className="num">{i18n.t('owner.premium', { amount: i18n.signedWon(p.change.premium_pay) })}</span></>}
    </li>
  );
}

type Row = [TextKey, (w: WeekCalc) => string, (p: PersonEffect) => string];

function CompareTable({ p }: { p: PersonEffect }) {
  const i18n = useI18n();
  const rows: Row[] = [
    ['table.contract', (w) => i18n.hours(w.contract_hours), () => ''],
    ['table.scheduled', (w) => i18n.hours(w.scheduled_hours), (x) => (x.change.scheduled_hours ? `${x.change.scheduled_hours > 0 ? '+' : ''}${i18n.hours(x.change.scheduled_hours)}` : '')],
    ['table.eligible', (w) => i18n.t(w.holiday_eligible ? 'eligible.true' : 'eligible.false'), () => ''],
    ['table.holidayHours', (w) => i18n.hours(w.holiday_hours), () => ''],
    ['table.holidayPay', (w) => i18n.won(w.holiday_pay), (x) => (x.change.holiday_pay ? i18n.signedWon(x.change.holiday_pay) : '')],
    ['table.basePay', (w) => i18n.won(w.base_pay), (x) => (x.change.base_pay ? i18n.signedWon(x.change.base_pay) : '')],
    ['table.premiumPay', (w) => i18n.won(w.premium_pay), (x) => (x.change.premium_pay ? i18n.signedWon(x.change.premium_pay) : '')],
    ['table.totalPay', (w) => i18n.won(w.total_pay), (x) => (x.change.total ? i18n.signedWon(x.change.total) : '')],
  ];
  return (
    <table className="compare">
      <caption>{i18n.name(p.name)}</caption>
      <thead>
        <tr>
          <th scope="col"><span className="sr-only">{i18n.t('table.change')}</span></th>
          <th scope="col">{i18n.t('table.before')}</th>
          <th scope="col">{i18n.t('table.after')}</th>
          <th scope="col">{i18n.t('table.change')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, value, change]) => {
          const b = value(p.before);
          const a = value(p.after);
          return (
            <tr key={key} className={b !== a ? 'is-changed' : ''}>
              <th scope="row">{i18n.t(key)}</th>
              <td className="num">{b}</td>
              <td className="num">{a}</td>
              <td className="num">{change(p)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** One ACCEPTED request waiting for the owner (Approve is the screen's primary action when `primary`). */
export function DecisionCard({ d, primary }: { d: ApprovalPreview; primary: boolean }) {
  const i18n = useI18n();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const premiums = d.regular_employees >= 5;
  const req = d.requester;
  const acc = d.acceptor;
  const approve = () => act(() => rpc('decide_sub_request', { p_request_id: d.request_id, p_decision: 'APPROVE' }),
    i18n.t('owner.approved', { acc: i18n.name(acc.name), day: i18n.dayLong(d.shift.work_date) }));
  const reject = () => act(() => rpc('decide_sub_request', { p_request_id: d.request_id, p_decision: 'REJECT' }),
    i18n.t('owner.rejected', { req: i18n.name(req.name) }));
  return (
    <article className="card decision-card" data-decision={d.request_id} aria-labelledby={`dec-${d.request_id}`}>
      <h3 className="card-title" id={`dec-${d.request_id}`}>
        {i18n.t('owner.covers', { req: i18n.name(req.name), acc: i18n.name(acc.name), shift: i18n.shift(d.shift) })}
      </h3>
      {d.reason && <p className="muted">{i18n.t('home.reason', { text: d.reason })}</p>}
      <ul className="people-effects">
        <PersonLine p={req} premiums={premiums} />
        <PersonLine p={acc} premiums={premiums} />
      </ul>
      <p className="store-line num" data-store-change={d.store_total_change}>
        {i18n.t('owner.store', { amount: i18n.signedWon(d.store_total_change) })}
      </p>
      {d.warning && (
        <Notice tone="warn" icon="alert" role="note">
          <p data-warning>{i18n.t('owner.overtimeWarn', { name: i18n.name(acc.name), h: i18n.hours(d.warning.beyond_contract) })}</p>
        </Notice>
      )}
      {open && (
        <div className="details" id={detailsId}>
          <CompareTable p={req} />
          <CompareTable p={acc} />
          <p className="hint">
            {i18n.t('table.policy', { policy: i18n.t(d.policy === 'ABSENT' ? 'settings.policyABSENT' : 'settings.policyEXCUSED'), n: d.regular_employees })}
          </p>
        </div>
      )}
      <div className="actions">
        <Button kind={primary ? 'primary' : 'secondary'} block onClick={approve} data-approve={d.request_id}>{i18n.t('owner.approve')}</Button>
        <Button kind="text" onClick={reject} data-reject={d.request_id}>{i18n.t('owner.reject')}</Button>
        <Button kind="text" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-controls={detailsId} data-details={d.request_id}>
          {i18n.t(open ? 'owner.hideDetails' : 'owner.details')}
        </Button>
      </div>
    </article>
  );
}
