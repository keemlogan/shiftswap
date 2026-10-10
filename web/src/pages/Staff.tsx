// UC-01 Staff (owner; list_workers, worker_detail, save_worker, save_fixed_schedule): the worker list with contract
// hours, and a detail form with every FR-01 field and the fixed-shift editor (weekday, start, end; an end earlier than
// the start ends the next day). The contract hours shown are the database's (the sum of the saved fixed shifts).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { rpc } from '../api';
import { Button, Chip, FormError, Icon, PageHead, ScreenState, Section } from '../components/ui';
import { useAction, useHold, useScreen, useShell } from '../context';
import { useI18n } from '../i18n';
import type { FixedSlot, WorkerInfo } from '../types';

export function StaffList() {
  const i18n = useI18n();
  const screen = useScreen(() => rpc<WorkerInfo[]>('list_workers'), []);
  const workers = screen.data;
  if (!workers) return <div className="screen" data-screen="staff" data-loaded="false"><ScreenState error={screen.error} onRetry={screen.reload} /></div>;
  return (
    <div className="screen" data-screen="staff" data-loaded="true">
      <PageHead title={i18n.t('staff.title')} sub={i18n.t('staff.sub')}
        cta={<Button kind="primary" block icon="plus" to="/staff/new" id="add-worker">{i18n.t('staff.add')}</Button>} />
      <ul className="flex flex-col gap-3">
        {workers.map((w) => (
          <li key={w.id}>
            <Link className="link-card" to={`/staff/${w.id}`} data-worker={w.id}>
              <span className="avatar avatar-lg" aria-hidden="true">{i18n.initial(w.name)}</span>
              <span className="link-main">
                <span className="card-title">{i18n.name(w.name)} {!w.active && <Chip>{i18n.t('staff.inactive')}</Chip>}</span>
                <span className="muted num">{i18n.t('staff.card', { h: i18n.hours(w.contract_hours), wage: w.hourly_wage != null ? i18n.won(w.hourly_wage) : '' })}</span>
                <span className="muted num">{i18n.t('staff.period', { from: i18n.ymd(w.contract_start), to: w.contract_end ? i18n.ymd(w.contract_end) : i18n.t('staff.openEnded') })}</span>
              </span>
              <Icon name="chevronRight" className="chev" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StaffDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const screen = useScreen(async () => (isNew ? null : rpc<WorkerInfo>('worker_detail', { p_worker_id: Number(id) })), [id]);
  if (!isNew && !screen.data) {
    return <div className="screen" data-screen="staff-detail" data-loaded="false"><ScreenState error={screen.error} onRetry={screen.reload} /></div>;
  }
  const w = screen.data;
  return <StaffForm key={w ? JSON.stringify(w) : 'new'} worker={w} />;
}

interface SlotRow { key: number; weekday: number; start_time: string; end_time: string }

let slotSeq = 0;
const toRow = (s: FixedSlot): SlotRow => ({ key: ++slotSeq, weekday: s.weekday, start_time: s.start_time, end_time: s.end_time });

function StaffForm({ worker }: { worker: WorkerInfo | null }) {
  const i18n = useI18n();
  const navigate = useNavigate();
  const { refresh } = useShell();
  const act = useAction();
  useHold(true);
  const [form, setForm] = useState({
    name: worker?.name ?? '', phone: worker?.phone ?? '', wage: worker?.hourly_wage != null ? String(worker.hourly_wage) : '',
    start: worker?.contract_start ?? '', end: worker?.contract_end ?? '', probation: worker?.probation_end ?? '',
    simple: worker?.simple_labor ?? false, active: worker?.active ?? true,
  });
  const [slots, setSlots] = useState<SlotRow[]>((worker?.fixed ?? []).map(toRow));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const setSlot = (key: number, patch: Partial<SlotRow>) => setSlots((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addSlot = () => {
    const used = new Set(slots.map((s) => s.weekday));
    const day = [1, 2, 3, 4, 5, 6, 7].find((d) => !used.has(d)) ?? 1;
    setSlots((rows) => [...rows, toRow({ weekday: day, start_time: '18:00', end_time: '23:00' })]);
  };

  const save = async () => {
    let savedId: number | null = worker?.id ?? null;
    const res = await act(async () => {
      savedId = await rpc<number>('save_worker', {
        p_id: worker?.id ?? null, p_name: form.name, p_phone: form.phone || null,
        p_hourly_wage: form.wage === '' ? null : Math.trunc(Number(form.wage)),
        p_contract_start: form.start || null, p_contract_end: form.end || null, p_probation_end: form.probation || null,
        p_simple_labor: form.simple, p_active: form.active,
      });
      return rpc<{ contract_hours: number }>('save_fixed_schedule', {
        p_worker_id: savedId, p_slots: slots.map((s) => ({ weekday: s.weekday, start_time: s.start_time, end_time: s.end_time })),
      });
    }, (r) => i18n.t(worker ? 'staff.saved' : 'staff.created', { name: i18n.name(form.name.trim()), h: i18n.hours(r.contract_hours) }),
    { reload: false });
    if (!res.ok) setError(res.message ?? null);
    // A new worker continues on their own page, so a second save does not create them again.
    if (!worker && savedId) navigate(`/staff/${savedId}`, { replace: true });
    else if (res.ok) await refresh();
  };

  const title = worker ? i18n.name(worker.name) : i18n.t('staff.newTitle');
  const back = <Link className="back-link" to="/staff"><Icon name="chevronLeft" /><span>{i18n.t('staff.back')}</span></Link>;
  const field = (name: keyof typeof form, label: string, type: string, extra: Record<string, unknown> = {}, hint?: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type={type} name={name} value={String(form[name])} className={type === 'number' || type === 'tel' ? 'num' : undefined}
        onChange={(e) => set({ [name]: e.target.value } as Partial<typeof form>)} {...extra} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );

  return (
    <div className="screen" data-screen="staff-detail" data-loaded="true">
      <PageHead title={title} back={back}
        cta={<Button kind="primary" block onClick={save} id="save-worker">{i18n.t(worker ? 'staff.save' : 'staff.create')}</Button>} />
      <form className="screen" id="worker-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <FormError message={error} />
        <Section title={i18n.t('staff.info')} id="info-title">
          <div className="card form">
            <div className="fields">
              {field('name', i18n.t('staff.name'), 'text', { maxLength: 60, autoComplete: 'off' })}
              {field('phone', i18n.t('staff.phone'), 'tel', { maxLength: 30, autoComplete: 'off' })}
              {field('wage', i18n.t('staff.wage'), 'number', { min: 1, step: 1, inputMode: 'numeric' })}
              {field('start', i18n.t('staff.start'), 'date')}
              {field('end', i18n.t('staff.end'), 'date', {}, i18n.t('staff.endHint'))}
              {field('probation', i18n.t('staff.probation'), 'date', {}, i18n.t('staff.probationHint'))}
            </div>
            <label className="switch-row">
              <span><strong>{i18n.t('staff.simpleLabor')}</strong><span className="hint">{i18n.t('staff.simpleLaborHint')}</span></span>
              <input type="checkbox" role="switch" name="simple" checked={form.simple} onChange={(e) => set({ simple: e.target.checked })} />
            </label>
            <label className="switch-row">
              <span><strong>{i18n.t('staff.active')}</strong></span>
              <input type="checkbox" role="switch" name="active" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
            </label>
          </div>
        </Section>
        <Section title={i18n.t('staff.fixed')} id="fixed-title">
          <div className="card" id="fixed-card">
            <p className="muted">{i18n.t('staff.fixedHint')}</p>
            {slots.length ? (
              <ul className="slot-rows">
                {slots.map((s) => {
                  const range = `${s.start_time}–${s.end_time}`;
                  return (
                    <li key={s.key} className="slot-row" data-slot={s.weekday}>
                      <label className="field slot-day"><span className="field-label">{i18n.t('staff.weekday')}</span>
                        <select name="weekday" value={s.weekday} onChange={(e) => setSlot(s.key, { weekday: Number(e.target.value) })}>
                          {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{i18n.dayName(d)}</option>)}
                        </select></label>
                      <label className="field slot-start"><span className="field-label">{i18n.t('staff.slotStart')}</span>
                        <input type="time" name="start" className="num" value={s.start_time} onChange={(e) => setSlot(s.key, { start_time: e.target.value })} /></label>
                      <label className="field slot-end"><span className="field-label">{i18n.t('staff.slotEnd')}</span>
                        <input type="time" name="end" className="num" value={s.end_time} onChange={(e) => setSlot(s.key, { end_time: e.target.value })} /></label>
                      <button type="button" className="icon-btn slot-remove" onClick={() => setSlots((rows) => rows.filter((r) => r.key !== s.key))}
                        aria-label={i18n.t('staff.removeSlot', { day: i18n.dayName(s.weekday), range })}><Icon name="x" /></button>
                      {s.start_time && s.end_time && s.end_time <= s.start_time && <span className="hint">{i18n.t('staff.endsNextDay')}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="hint">{i18n.t('staff.fixedNone')}</p>}
            <div><Button kind="text" icon="plus" onClick={addSlot} id="add-slot">{i18n.t('staff.addSlot')}</Button></div>
            {worker && <p className="sentence" data-contract-hours={worker.contract_hours}><Icon name="clock" /><span>{i18n.t('staff.fixedTotal', { h: i18n.hours(worker.contract_hours) })}</span></p>}
          </div>
        </Section>
      </form>
    </div>
  );
}
