// UC-04 Request substitute in three steps (spec §19): (1) choose one of my future shifts (requestable_shifts) →
// (2) a reason, quick chips stored as plain text → (3) the reply deadline pre-filled with default_deadline and the
// co-workers who will be notified (preview_candidates) → Send swap request (create_sub_request) → the result screen.
// The draft lives in sessionStorage so a reload keeps it.
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { rpc } from '../api';
import { Button, EmptyState, FormError, Icon, Notice, PageHead, ScreenState, Section, Tracker } from '../components/ui';
import { useAction, useHold, useScreen, useShell } from '../context';
import { DATETIME_RE, toInputDateTime } from '../dates';
import { useI18n, type TextKey } from '../i18n';
import type { RequestableShift } from '../types';

const FLOW_KEY = 'shiftswap9.flow';
const REASONS = ['Exam', 'Hospital', 'Family', 'Personal', 'Other'] as const;
type ReasonKey = (typeof REASONS)[number];

interface FlowState {
  shiftId?: number;
  reasonKey?: ReasonKey | null;
  reasonText?: string;
  deadline?: string;
  result?: {
    status: 'REQUESTED' | 'FAILED';
    candidates: string[];
    shift: { work_date: string; start_time: string; end_time: string };
  };
}

function loadFlow(): FlowState {
  try {
    return JSON.parse(sessionStorage.getItem(FLOW_KEY) || '{}') as FlowState;
  } catch {
    return {};
  }
}

function saveFlow(state: FlowState) {
  try {
    sessionStorage.setItem(FLOW_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the draft lives in memory for this step only.
  }
}

function clearFlow() {
  try {
    sessionStorage.removeItem(FLOW_KEY);
  } catch {
    // nothing to clear
  }
}

function useFlow(): [FlowState, (patch: Partial<FlowState>) => void] {
  const [state, setState] = useState<FlowState>(loadFlow);
  const update = (patch: Partial<FlowState>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      saveFlow(next);
      return next;
    });
  };
  return [state, update];
}

function FlowHead({ step, back }: { step: number; back: string | null }) {
  const i18n = useI18n();
  return (
    <>
      <div className="flow-head">
        {back ? <Link className="icon-btn" to={back} aria-label={i18n.t('common.back')}><Icon name="chevronLeft" /></Link>
          : <span className="icon-btn-spacer" />}
        {step <= 3 ? (
          <p className="step-indicator"><span aria-hidden="true" className="num">{i18n.t('flow.step', { n: step })}</span>
            <span className="sr-only">{i18n.t('flow.stepSr', { n: step })}</span></p>
        ) : <span />}
        <Link className="icon-btn" to="/swaps" aria-label={i18n.t('flow.exit')} onClick={clearFlow} data-exit>
          <Icon name="x" />
        </Link>
      </div>
      {step <= 3 && <div className="step-bar" aria-hidden="true"><span style={{ width: `${(step / 3) * 100}%` }} /></div>}
    </>
  );
}

export function SwapFlow() {
  const { step, shiftId } = useParams();
  if (step === 'done') return <FlowDone />;
  if (step === '2') return <FlowReason />;
  if (step === '3') return <FlowDeadline />;
  return <FlowShift preselect={shiftId ? Number(shiftId) : null} />;
}

/** Shared by the steps: the worker's requestable shifts (run_system_clock + requestable_shifts). */
function useRequestable() {
  const { user } = useShell();
  return useScreen(() => rpc<RequestableShift[]>('requestable_shifts', { p_worker_id: user!.id }), [user!.id]);
}

function FlowShift({ preselect }: { preselect: number | null }) {
  const i18n = useI18n();
  const navigate = useNavigate();
  const { now } = useShell();
  const [flow, update] = useFlow();
  const screen = useRequestable();
  useHold(true);
  useEffect(() => {
    if (preselect) update({ shiftId: preselect, deadline: undefined, result: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect]);
  const shifts = screen.data;
  if (!shifts) return <div className="screen" data-screen="flow-1" data-loaded="false"><FlowHead step={1} back={null} /><ScreenState error={screen.error} onRetry={screen.reload} /></div>;
  const chosen = shifts.find((s) => s.id === flow.shiftId) ? flow.shiftId : (shifts.length === 1 ? shifts[0].id : undefined);
  const next = () => {
    update({ shiftId: chosen, deadline: undefined, result: undefined });
    navigate('/swaps/new/2');
  };
  const cta = (
    <Button kind="primary" block onClick={next} disabled={!chosen} id="flow-next"
      reason={shifts.length ? i18n.t('flow.s1Need') : i18n.t('flow.s1None')}>{i18n.t('common.next')}</Button>
  );
  return (
    <div className="screen" data-screen="flow-1" data-loaded="true">
      <FlowHead step={1} back={null} />
      <PageHead title={i18n.t('flow.s1Title')} sub={i18n.t('flow.s1Sub')} cta={cta} />
      {shifts.length ? (
        <fieldset className="options">
          <legend className="sr-only">{i18n.t('flow.s1Title')}</legend>
          {shifts.map((s) => (
            <label key={s.id} className="option-card" data-option-shift={s.id}>
              <input type="radio" name="shift" value={s.id} checked={s.id === chosen}
                onChange={() => update({ shiftId: s.id, deadline: undefined })} />
              <span className="option-main">
                <span className="option-title">{i18n.date(s.work_date)}</span>
                <span className="option-sub num">{i18n.range(s.start_time, s.end_time)}</span>
              </span>
              <span className="chip chip-neutral">{i18n.dday(s.work_date, now)}</span>
            </label>
          ))}
        </fieldset>
      ) : <EmptyState text={i18n.t('flow.s1None')} />}
    </div>
  );
}

function FlowReason() {
  const i18n = useI18n();
  const navigate = useNavigate();
  const [flow, update] = useFlow();
  const screen = useRequestable();
  useHold(true);
  const shifts = screen.data;
  if (!shifts) return <div className="screen" data-screen="flow-2" data-loaded="false"><FlowHead step={2} back="/swaps/new/1" /><ScreenState error={screen.error} onRetry={screen.reload} /></div>;
  const shift = shifts.find((s) => s.id === flow.shiftId);
  if (!shift) return <Navigate to="/swaps/new/1" replace />;
  const cta = <Button kind="primary" block onClick={() => navigate('/swaps/new/3')} id="flow-next">{i18n.t('common.next')}</Button>;
  return (
    <div className="screen" data-screen="flow-2" data-loaded="true">
      <FlowHead step={2} back="/swaps/new/1" />
      <PageHead title={i18n.t('flow.s2Title')} sub={i18n.shift(shift)} cta={cta} />
      <form className="form" id="reason-form" onSubmit={(e) => e.preventDefault()} noValidate>
        <fieldset className="field-group">
          <legend className="field-label">{i18n.t('flow.reason')}</legend>
          <div className="chip-row" role="radiogroup" aria-label={i18n.t('flow.reason')}>
            {REASONS.map((k) => (
              <label key={k} className="chip-option" data-reason={k}>
                <input type="radio" name="reason" value={k} checked={flow.reasonKey === k} onChange={() => update({ reasonKey: k })} />
                <span>{i18n.t(`flow.reason${k}` as TextKey)}</span>
              </label>
            ))}
          </div>
          {flow.reasonKey === 'Other' && (
            <label className="field"><span className="field-label">{i18n.t('flow.reasonInput')}</span>
              <input type="text" name="reasonText" maxLength={200} autoComplete="off" value={flow.reasonText ?? ''}
                onChange={(e) => update({ reasonText: e.target.value })} />
            </label>
          )}
          <p className="hint">{i18n.t('flow.reasonOptional')}</p>
        </fieldset>
      </form>
    </div>
  );
}

function reasonOf(flow: FlowState, t: (key: TextKey) => string): string {
  if (!flow.reasonKey) return '';
  if (flow.reasonKey === 'Other') return (flow.reasonText ?? '').trim().slice(0, 200);
  return t(`flow.reason${flow.reasonKey}` as TextKey);
}

function FlowDeadline() {
  const i18n = useI18n();
  const navigate = useNavigate();
  const { user, now } = useShell();
  const act = useAction();
  const [flow, update] = useFlow();
  const [error, setError] = useState<string | null>(null);
  useHold(true);
  const screen = useScreen(async () => {
    const shifts = await rpc<RequestableShift[]>('requestable_shifts', { p_worker_id: user!.id });
    const shift = shifts.find((s) => s.id === flow.shiftId) ?? null;
    const candidates = shift
      ? await rpc<{ id: number; name: string }[]>('preview_candidates', { p_shift_id: shift.id, p_requester_id: user!.id }) : [];
    return { shift, candidates };
  }, [flow.shiftId]);
  const data = screen.data;
  if (!data) return <div className="screen" data-screen="flow-3" data-loaded="false"><FlowHead step={3} back="/swaps/new/2" /><ScreenState error={screen.error} onRetry={screen.reload} /></div>;
  const { shift, candidates } = data;
  if (!shift) return <Navigate to="/swaps/new/1" replace />;

  const deadline = flow.deadline ?? toInputDateTime(shift.default_deadline);
  const start = toInputDateTime(shift.start_at);
  const nowMinute = now ? toInputDateTime(now) : null;
  let problem: string | null = null;
  if (!DATETIME_RE.test(deadline)) problem = i18n.t('flow.dEmpty');
  else if (nowMinute && deadline <= nowMinute) problem = i18n.t('flow.dPast');
  else if (deadline > start) problem = i18n.t('flow.dAfterStart', { start: i18n.shift(shift) });
  const reason = reasonOf(flow, i18n.t);

  const send = async () => {
    const res = await act(() => rpc<{ id: number; status: 'REQUESTED' | 'FAILED'; candidates: { id: number; name: string }[] }>(
      'create_sub_request', { p_shift_id: shift.id, p_requester_id: user!.id, p_reason: reason, p_deadline: `${deadline}:00` },
    ), (r) => i18n.t(r.status === 'FAILED' ? 'flow.doneFailedTitle' : 'flow.doneTitle'), { reload: false });
    if (res.ok && res.value) {
      update({ result: { status: res.value.status, candidates: res.value.candidates.map((c) => c.name), shift } });
      navigate('/swaps/new/done');
    } else {
      setError(res.message ?? null);
      void screen.reload();
    }
  };
  const cta = <Button kind="primary" block onClick={send} disabled={!!problem} reason={problem ?? ''} id="flow-send">{i18n.t('flow.send')}</Button>;

  return (
    <div className="screen" data-screen="flow-3" data-loaded="true">
      <FlowHead step={3} back="/swaps/new/2" />
      <PageHead title={i18n.t('flow.s3Title')} cta={cta} />
      <FormError message={error} />
      <dl className="card summary-list">
        <div><dt>{i18n.t('flow.shift')}</dt><dd className="num">{i18n.shift(shift)}</dd></div>
        <div><dt>{i18n.t('flow.reason')}</dt><dd>{reason || i18n.t('flow.reasonNone')}</dd></div>
      </dl>
      <form className="field-group" id="deadline-form" onSubmit={(e) => e.preventDefault()} noValidate>
        <label className="field"><span className="field-label">{i18n.t('flow.deadline')}</span>
          <input type="datetime-local" name="deadline" className="num" value={deadline} max={start} min={nowMinute ?? undefined}
            onChange={(e) => update({ deadline: e.target.value.slice(0, 16) })} />
        </label>
        {!problem && <p className="sentence" aria-live="polite"><Icon name="clock" /><span>{i18n.t('flow.dSentence', { when: i18n.when(deadline, now) })}</span></p>}
      </form>
      <Section title={i18n.t('flow.to')} count={candidates.length || null} id="candidates-title">
        {candidates.length ? (
          <>
            <ul className="card people" data-candidates={candidates.length}>
              {candidates.map((c) => (
                <li key={c.id}><span className="avatar" aria-hidden="true">{i18n.initial(c.name)}</span><span>{i18n.name(c.name)}</span></li>
              ))}
            </ul>
            <p className="hint">{i18n.t('flow.toCount', { n: candidates.length })}</p>
          </>
        ) : <Notice tone="warn" icon="alert"><p>{i18n.t('flow.toNone')}</p></Notice>}
      </Section>
    </div>
  );
}

function FlowDone() {
  const i18n = useI18n();
  const navigate = useNavigate();
  const [flow] = useFlow();
  const res = flow.result;
  if (!res) return <Navigate to="/swaps" replace />;
  const failed = res.status === 'FAILED';
  const home = () => {
    clearFlow();
    navigate('/home');
  };
  return (
    <div className="screen" data-screen="flow-done" data-loaded="true">
      <FlowHead step={4} back={null} />
      <div className={`done-mark ${failed ? 'is-alert' : ''}`} aria-hidden="true"><Icon name={failed ? 'alert' : 'check'} /></div>
      <PageHead title={i18n.t(failed ? 'flow.doneFailedTitle' : 'flow.doneTitle')} sub={i18n.shift(res.shift)}
        cta={<Button kind="primary" block onClick={home} id="flow-home">{i18n.t('common.goHome')}</Button>} />
      <div className="card">
        <Tracker status={failed ? 'FAILED' : 'REQUESTED'} />
        <p className="status-line" data-result>{failed ? i18n.t('flow.doneNone') : i18n.t('flow.doneSent', { names: i18n.people(res.candidates) })}</p>
      </div>
    </div>
  );
}
