// Settings (owner; get_settings, update_settings, UC-10): store name, regular employees, the substitution-attendance
// policy and the minimum-wage table. Demo tools (FR-20; set_demo_clock, reset_demo_data): move the demo clock (+1 hour,
// +1 day, a chosen date and time, or real time) and reset the demo data after a confirmation.
import { useState } from 'react';
import { rpc } from '../api';
import { Button, FormError, Icon, PageHead, ScreenState, Section, Sheet } from '../components/ui';
import { useAction, useHold, useScreen, useShell } from '../context';
import { addMinutes, DATETIME_RE, toInputDateTime } from '../dates';
import { useI18n } from '../i18n';
import { afterDemoReset } from '../store';
import type { Policy, Settings } from '../types';

export function SettingsPage() {
  const screen = useScreen(() => rpc<Settings>('get_settings'), []);
  const data = screen.data;
  if (!data) return <div className="screen" data-screen="settings" data-loaded="false"><ScreenState error={screen.error} onRetry={screen.reload} /></div>;
  return (
    <div className="screen" data-screen="settings" data-loaded="true">
      <StoreForm key={JSON.stringify([data.workplace.name, data.workplace.regular_employees, data.workplace.sub_attendance_policy, data.minimum_wages])} settings={data} />
      <DemoTools settings={data} />
    </div>
  );
}

let wageSeq = 0;

function StoreForm({ settings }: { settings: Settings }) {
  const i18n = useI18n();
  const act = useAction();
  useHold(true);
  const [name, setName] = useState(settings.workplace.name);
  const [employees, setEmployees] = useState(String(settings.workplace.regular_employees));
  const [policy, setPolicy] = useState<Policy>(settings.workplace.sub_attendance_policy);
  const [wages, setWages] = useState(settings.minimum_wages.map((w) => ({ key: ++wageSeq, year: String(w.year), hourly: String(w.hourly) })));
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const rows = wages.map((w) => ({ year: w.year === '' ? null : Number(w.year), hourly: w.hourly === '' ? null : Number(w.hourly) }));
    // p_minimum_wages null keeps the stored rows; the table is sent only when it was changed.
    const unchanged = JSON.stringify(rows) === JSON.stringify(settings.minimum_wages.map((w) => ({ year: w.year, hourly: w.hourly })));
    const res = await act(() => rpc('update_settings', {
      p_name: name, p_regular_employees: employees === '' ? null : Math.trunc(Number(employees)), p_policy: policy,
      p_minimum_wages: unchanged ? null : rows,
    }), i18n.t('settings.saved'));
    setError(res.ok ? null : res.message ?? null);
  };
  return (
    <>
      <PageHead title={i18n.t('settings.title')} sub={i18n.t('settings.sub')}
        cta={<Button kind="primary" block onClick={save} id="save-settings">{i18n.t('common.save')}</Button>} />
      <form className="screen" id="settings-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <FormError message={error} />
        <Section>
          <div className="card form">
            <label className="field"><span className="field-label">{i18n.t('settings.store')}</span>
              <input type="text" name="name" value={name} maxLength={100} autoComplete="off" onChange={(e) => setName(e.target.value)} /></label>
            <label className="field"><span className="field-label">{i18n.t('settings.employees')}</span>
              <input type="number" name="regularEmployees" className="num" min={0} max={1000} step={1} inputMode="numeric" value={employees}
                onChange={(e) => setEmployees(e.target.value)} aria-describedby="employees-hint" />
              <span className="hint" id="employees-hint">{i18n.t('settings.employeesHint', { n: settings.workplace.regular_employees })}</span></label>
          </div>
        </Section>
        <Section>
          <fieldset className="radio-cards">
            <legend className="section-title">{i18n.t('settings.policy')}</legend>
            {(['EXCUSED', 'ABSENT'] as const).map((p) => (
              <label key={p} className="radio-card" data-policy-option={p}>
                <input type="radio" name="policy" value={p} checked={policy === p} onChange={() => setPolicy(p)} />
                <span><strong>{i18n.t(p === 'EXCUSED' ? 'settings.policyEXCUSED' : 'settings.policyABSENT')}</strong>
                  <span className="muted">{i18n.t(p === 'EXCUSED' ? 'settings.policyEXCUSEDhint' : 'settings.policyABSENThint')}</span></span>
              </label>
            ))}
          </fieldset>
        </Section>
        <Section title={i18n.t('settings.minWage')} id="wage-title">
          <div className="card">
            <ul className="wage-rows">
              {wages.map((w) => (
                <li key={w.key} className="wage-row">
                  <label className="field"><span className="field-label">{i18n.t('settings.year')}</span>
                    <input type="number" name="year" className="num" min={2000} max={2100} step={1} inputMode="numeric" value={w.year}
                      onChange={(e) => setWages((rows) => rows.map((r) => (r.key === w.key ? { ...r, year: e.target.value } : r)))} /></label>
                  <label className="field"><span className="field-label">{i18n.t('settings.hourly')}</span>
                    <input type="number" name="hourly" className="num" min={1} step={1} inputMode="numeric" value={w.hourly}
                      onChange={(e) => setWages((rows) => rows.map((r) => (r.key === w.key ? { ...r, hourly: e.target.value } : r)))} /></label>
                  <button type="button" className="icon-btn" aria-label={i18n.t('settings.removeYear', { year: w.year })}
                    onClick={() => setWages((rows) => rows.filter((r) => r.key !== w.key))}><Icon name="x" /></button>
                </li>
              ))}
            </ul>
            <div><Button kind="text" icon="plus" id="add-wage" onClick={() => setWages((rows) => [...rows, { key: ++wageSeq, year: '', hourly: '' }])}>
              {i18n.t('settings.addYear')}</Button></div>
          </div>
        </Section>
      </form>
    </>
  );
}

function DemoTools({ settings }: { settings: Settings }) {
  const i18n = useI18n();
  const act = useAction();
  const { now: headerNow } = useShell();
  const now = settings.now ?? headerNow ?? '';
  const [at, setAt] = useState(toInputDateTime(now));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setClock = async (value: string | null) => {
    const res = await act(() => rpc<string>('set_demo_clock', { p_at: value }),
      (newNow) => (value === null ? i18n.t('demo.realSet', { when: i18n.clock(newNow) }) : i18n.t('demo.clockSet', { when: i18n.clock(newNow) })));
    setError(res.ok ? null : res.message ?? null);
    if (res.ok && res.value) setAt(toInputDateTime(res.value));
  };
  const apply = () => {
    if (!DATETIME_RE.test(at)) {
      setError(i18n.t('demo.clockInvalid'));
      return undefined;
    }
    return setClock(`${at}:00`);
  };
  const reset = async () => {
    const res = await act(() => rpc('reset_demo_data'), i18n.t('demo.resetDone'));
    if (res.ok) afterDemoReset();
    setConfirming(false);
  };
  return (
    <Section title={i18n.t('demo.title')} id="demo-title">
      <div className="card" data-demo-tools>
        <p className="muted">{i18n.t('demo.intro')}</p>
        <FormError message={error} />
        <p className="sentence"><Icon name="clock" /><span data-demo-now={now}>
          {settings.workplace.demo_clock ? `${i18n.t('demo.now')} ${i18n.clock(now)}` : `${i18n.t('demo.real')} · ${i18n.clock(now)}`}
        </span></p>
        <div className="row-2">
          <Button kind="secondary" block id="clock-hour" onClick={() => setClock(`${addMinutes(now, 60)}`)}>{i18n.t('demo.plusHour')}</Button>
          <Button kind="secondary" block id="clock-day" onClick={() => setClock(`${addMinutes(now, 1440)}`)}>{i18n.t('demo.plusDay')}</Button>
        </div>
        <form className="form" id="clock-form" onSubmit={(e) => { e.preventDefault(); void apply(); }} noValidate>
          <label className="field"><span className="field-label">{i18n.t('demo.setLabel')}</span>
            <input type="datetime-local" name="demoClock" className="num" step={60} value={at} onChange={(e) => setAt(e.target.value.slice(0, 16))} /></label>
          <div className="row-2">
            <Button kind="secondary" block id="clock-apply" onClick={apply}>{i18n.t('demo.apply')}</Button>
            <Button kind="secondary" block id="clock-real" onClick={() => setClock(null)}>{i18n.t('demo.useReal')}</Button>
          </div>
        </form>
        <div className="divider" />
        <div><Button kind="danger" icon="alert" id="reset-ask" onClick={() => setConfirming(true)}>{i18n.t('demo.reset')}</Button></div>
      </div>
      {confirming && (
        <Sheet title={i18n.t('demo.reset')} onClose={() => setConfirming(false)}>
          <div className="confirm-box" role="alert">
            <p>{i18n.t('demo.resetConfirm')}</p>
            <div className="row-2">
              <Button kind="secondary" block onClick={() => setConfirming(false)} id="reset-no">{i18n.t('common.cancel')}</Button>
              <Button kind="danger" block onClick={reset} id="reset-yes">{i18n.t('demo.resetYes')}</Button>
            </div>
          </div>
        </Sheet>
      )}
    </Section>
  );
}
