// UC-03 Schedule (week_board, shift_detail): a time grid of 7 day columns on desktop and a day list on phones. Own
// shifts are highlighted for workers; an open request has an amber dashed outline and "Looking for cover"; a handed-over
// shift has the amber edge with the original worker struck through; a shift ending after midnight is shown on its start
// day with "→ next day". The owner adds, moves, re-assigns, deletes and marks absent; a worker finds a substitute for an
// own future shift. When the owner opens a week without shifts, generate_week builds it from the fixed schedules.
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { rpc } from '../api';
import { Button, Chip, EmptyState, FormError, PageHead, PeriodNav, ScreenState, Sheet } from '../components/ui';
import { useAction, useFetch, useScreen, useShell } from '../context';
import { addDays, DATE_RE, weekStart } from '../dates';
import { useI18n } from '../i18n';
import { generatedWeeks } from '../store';
import type { BoardShift, RequestableShift, ShiftDetail, WeekBoard, WorkerInfo } from '../types';

const HOUR_PX = 44;

function minutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Start and end minutes of a shift on its start day; an end not later than the start is on the next day (BR-05). */
function span(s: { start_time: string; end_time: string }): [number, number] {
  const a = minutes(s.start_time);
  let b = minutes(s.end_time);
  if (b <= a) b += 1440;
  return [a, b];
}

interface Placed { s: BoardShift; span: [number, number]; lane: number; lanes: number }

/** Overlapping shifts of one day share the column width in lanes. */
function layoutDay(dayShifts: BoardShift[]): Placed[] {
  const items: Placed[] = dayShifts.map((s) => ({ s, span: span(s), lane: 0, lanes: 1 }))
    .sort((a, b) => a.span[0] - b.span[0]);
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((x) => x.lane + 1));
    cluster.forEach((x) => { x.lanes = lanes; });
    cluster = [];
    laneEnds = [];
  };
  for (const item of items) {
    if (cluster.length && item.span[0] >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.span[0]);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.span[1];
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.span[1]);
  }
  if (cluster.length) flush();
  return items;
}

export function Schedule() {
  const { week: param } = useParams();
  const { now } = useShell();
  if (param && DATE_RE.test(param)) return <ScheduleWeek key={weekStart(param)} week={weekStart(param)} />;
  if (!now) return <div className="screen" data-screen="schedule" data-loaded="false"><ScreenState error={null} onRetry={() => undefined} /></div>;
  return <Navigate to={`/schedule/${weekStart(now.slice(0, 10))}`} replace />;
}

function ScheduleWeek({ week }: { week: string }) {
  const i18n = useI18n();
  const { user, now, toast } = useShell();
  const isOwner = user!.role === 'OWNER';
  const [openShift, setOpenShift] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const screen = useScreen(async () => {
    const [first, requestable] = await Promise.all([
      rpc<WeekBoard>('week_board', { p_week_start: week }),
      isOwner ? Promise.resolve([] as RequestableShift[]) : rpc<RequestableShift[]>('requestable_shifts', { p_worker_id: user!.id }),
    ]);
    let board = first;
    if (isOwner && board.shifts.length === 0 && !generatedWeeks.has(week)) {
      generatedWeeks.add(week);
      const created = await rpc<number>('generate_week', { p_week_start: week });
      if (created > 0) {
        toast(i18n.t('schedule.generated', { n: created }));
        board = await rpc<WeekBoard>('week_board', { p_week_start: week });
      }
    }
    return { board, requestable };
  }, [week]);

  const data = screen.data;
  const thisWeek = now ? weekStart(now.slice(0, 10)) : null;
  const label = `${i18n.date(week)} – ${i18n.date(addDays(week, 6))}`;
  const cta = isOwner
    ? <Button kind="primary" block icon="plus" onClick={() => setAdding(true)} id="add-shift">{i18n.t('schedule.add')}</Button>
    : <Button kind="primary" block to="/swaps/new/1" disabled={!data || data.requestable.length === 0}
      reason={i18n.t('schedule.findDisabled')} id="find-cover">{i18n.t('schedule.findCover')}</Button>;

  return (
    <div className="screen" data-screen="schedule" data-loaded={data ? 'true' : 'false'} data-week={week}>
      <PageHead title={i18n.t('schedule.title')} cta={data ? cta : undefined} />
      <PeriodNav label={label} prevTo={`/schedule/${addDays(week, -7)}`} nextTo={`/schedule/${addDays(week, 7)}`}
        prevLabel={i18n.t('common.prevWeek')} nextLabel={i18n.t('common.nextWeek')}
        extra={thisWeek && thisWeek !== week ? <Link className="btn btn-text btn-small" to={`/schedule/${thisWeek}`}>{i18n.t('common.thisWeek')}</Link> : undefined} />
      {!data ? <ScreenState error={screen.error} onRetry={screen.reload} /> : data.board.shifts.length ? (
        <>
          <Board board={data.board} today={now?.slice(0, 10) ?? ''} viewerId={isOwner ? null : user!.id} onOpen={setOpenShift} />
          <ul className="legend">
            {!isOwner && <li><span className="swatch swatch-own" aria-hidden="true" />{i18n.t('schedule.legendOwn')}</li>}
            <li><span className="swatch swatch-handover" aria-hidden="true" />{i18n.t('schedule.legendHandover')}</li>
            <li><span className="swatch swatch-pending" aria-hidden="true" />{i18n.t('schedule.legendPending')}</li>
          </ul>
        </>
      ) : <EmptyState text={i18n.t(isOwner ? 'schedule.emptyOwner' : 'schedule.emptyWorker')} />}
      {openShift !== null && <ShiftSheet shiftId={openShift} onClose={() => setOpenShift(null)} />}
      {adding && <AddShiftSheet week={week} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Board({ board, today, viewerId, onOpen }: { board: WeekBoard; today: string; viewerId: number | null; onOpen: (id: number) => void }) {
  const i18n = useI18n();
  const spans = board.shifts.map(span);
  const axisStart = Math.floor(Math.min(...spans.map((x) => x[0])) / 60) * 60;
  const axisEnd = Math.ceil(Math.max(...spans.map((x) => x[1])) / 60) * 60;
  const hours: number[] = [];
  for (let m = axisStart; m <= axisEnd; m += 60) hours.push(m);
  const px = (m: number) => ((m - axisStart) / 60) * HOUR_PX;
  const hourLabel = (m: number) => `${String((m / 60) % 24).padStart(2, '0')}:00`;
  return (
    <div className="board" style={{ ['--grid-h' as string]: `${px(axisEnd)}px` }}>
      <div className="gutter" aria-hidden="true">
        <div className="day-head" />
        <div className="lane-area">
          {hours.map((m) => <span key={m} className="hour-label num" style={{ ['--top' as string]: `${px(m)}px` }}>{hourLabel(m)}</span>)}
        </div>
      </div>
      {board.days.map((d) => {
        const placed = layoutDay(board.shifts.filter((s) => s.work_date === d));
        const isToday = d === today;
        return (
          <section key={d} className={`day ${isToday ? 'today' : ''}`} aria-label={i18n.date(d)} data-day={d}>
            <h3 className="day-head">
              <span>{i18n.dateShort(d)}</span>
              {isToday && <Chip tone="primary">{i18n.t('common.today')}</Chip>}
              <span className="day-count">{placed.length ? '' : i18n.t('schedule.noShifts')}</span>
            </h3>
            <div className="lane-area">
              {placed.length > 0 && (
                <div className="hour-lines" aria-hidden="true">
                  {hours.map((m) => <div key={m} className="hour-line" style={{ ['--top' as string]: `${px(m)}px` }} />)}
                </div>
              )}
              {placed.map((p) => <ShiftBlock key={p.s.id} p={p} px={px} viewerId={viewerId} onOpen={onOpen} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ShiftBlock({ p, px, viewerId, onOpen }: { p: Placed; px: (m: number) => number; viewerId: number | null; onOpen: (id: number) => void }) {
  const i18n = useI18n();
  const s = p.s;
  const handedOver = !!s.original_worker_id && s.original_worker_id !== s.worker_id;
  const pending = !!s.open_request;
  const overnight = i18n.overnight(s.start_time, s.end_time);
  const own = viewerId !== null && s.worker_id === viewerId;
  const cls = ['shift', handedOver ? 'handover' : '', pending ? 'pending' : '', own ? 'own' : ''].filter(Boolean).join(' ');
  const label = [
    i18n.shift(s), i18n.name(s.worker_name),
    handedOver ? i18n.t('schedule.covering', { name: i18n.name(s.original_worker_name) }) : '',
    pending ? i18n.t('schedule.pending') : '',
    s.status !== 'SCHEDULED' ? i18n.t(`shift.${s.status}`) : '',
  ].filter(Boolean).join(', ');
  const style = {
    ['--top' as string]: `${px(p.span[0])}px`, ['--height' as string]: `${px(p.span[1]) - px(p.span[0])}px`,
    ['--lane' as string]: String(p.lane), ['--lanes' as string]: String(p.lanes),
  };
  return (
    <button type="button" className={cls} style={style} onClick={() => onOpen(s.id)} aria-label={label}
      data-shift={s.id} data-worker={s.worker_id} data-date={s.work_date}>
      <span className="shift-time num">{`${s.start_time}–${s.end_time}`}</span>
      {overnight && <span className="shift-next" data-next-day>{i18n.t('common.endsNextDay', { end: s.end_time })}</span>}
      <span className="shift-worker">{handedOver ? <strong>{i18n.name(s.worker_name)}</strong> : i18n.name(s.worker_name)}</span>
      {handedOver && <s className="shift-original">{i18n.name(s.original_worker_name)}</s>}
      {pending && <Chip tone="handover">{i18n.t('schedule.pending')}</Chip>}
      {s.status === 'WORKED' && <Chip tone="ok">{i18n.t('shift.WORKED')}</Chip>}
      {s.status === 'ABSENT' && <Chip tone="alert">{i18n.t('shift.ABSENT')}</Chip>}
    </button>
  );
}

function historyLine(i18n: ReturnType<typeof useI18n>, r: ShiftDetail['requests'][number]): string {
  const date = i18n.dateShort((r.decided_at || r.created_at).slice(0, 10));
  const from = i18n.name(r.requester_name);
  const to = r.acceptor_name ? i18n.name(r.acceptor_name) : '';
  if (r.status === 'APPROVED') return i18n.t('detail.hApproved', { from, to, date });
  if (r.status === 'ACCEPTED') return i18n.t('detail.hAccepted', { from, to });
  if (r.status === 'REQUESTED') return i18n.t('detail.hRequested', { from, date });
  return i18n.t('detail.hEnded', { from, date, status: i18n.t(`end.${r.status}`) });
}

/** One shift: worker, status, attendance, swap history and the actions the viewer may take. */
function ShiftSheet({ shiftId, onClose }: { shiftId: number; onClose: () => void }) {
  const i18n = useI18n();
  const navigate = useNavigate();
  const { user, now } = useShell();
  const act = useAction();
  const isOwner = user!.role === 'OWNER';
  const [mode, setMode] = useState<'view' | 'time' | 'worker'>('view');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ date: '', start: '', end: '', worker: 0 });
  const [workers, setWorkers] = useState<WorkerInfo[] | null>(null);
  const detailScreen = useFetch(() => rpc<ShiftDetail>('shift_detail', { p_shift_id: shiftId }), [shiftId]);
  const d = detailScreen.data;

  const title = d ? i18n.shift(d) : i18n.t('app.loading');
  if (!d) {
    return <Sheet title={title} onClose={onClose}><ScreenState error={detailScreen.error} onRetry={detailScreen.reload} /></Sheet>;
  }
  const handedOver = !!d.original_worker_id && d.original_worker_id !== d.worker_id;
  const open = d.requests.some((r) => r.status === 'REQUESTED' || r.status === 'ACCEPTED');
  const ownFuture = !isOwner && d.worker_id === user!.id && d.status === 'SCHEDULED' && !!now && d.start_at > now && !open;

  const done = async (fn: () => Promise<unknown>, message: string, after?: () => void) => {
    const res = await act(fn, message);
    if (res.ok) {
      onClose();
      after?.();
    } else setError(res.message ?? null);
  };
  const startTime = () => {
    setForm({ date: d.work_date, start: d.start_time, end: d.end_time, worker: d.worker_id });
    setError(null);
    setMode('time');
  };
  const startWorker = async () => {
    setForm({ date: d.work_date, start: d.start_time, end: d.end_time, worker: d.worker_id });
    setError(null);
    setMode('worker');
    try {
      setWorkers((await rpc<WorkerInfo[]>('list_workers')).filter((w) => w.active));
    } catch (err) {
      setError(i18n.errorText(err));
    }
  };
  const update = () => done(() => rpc('update_shift', {
    p_shift_id: d.id, p_work_date: form.date, p_start: form.start, p_end: form.end, p_worker_id: form.worker,
  }), i18n.t('detail.changed'), () => {
    if (weekStart(form.date) !== weekStart(d.work_date)) navigate(`/schedule/${weekStart(form.date)}`);
  });

  return (
    <Sheet title={title} onClose={onClose}>
      <FormError message={error} />
      <dl className={`summary-list detail-box ${handedOver ? 'handover' : ''} ${open ? 'pending' : ''}`}>
        <div><dt>{i18n.t('detail.worker')}</dt><dd>{handedOver
          ? <><strong>{i18n.name(d.worker_name)}</strong> <s className="muted">{i18n.name(d.original_worker_name)}</s></>
          : i18n.name(d.worker_name)}</dd></div>
        <div><dt>{i18n.t('detail.status')}</dt><dd>{i18n.t(`shift.${d.status}`)}{open && <> <Chip tone="handover">{i18n.t('schedule.pending')}</Chip></>}</dd></div>
        {d.attendance && (
          <div><dt>{i18n.t('detail.attendance')}</dt><dd className="num">{i18n.t('detail.attendanceLine', {
            range: i18n.range(d.attendance.clock_in, d.attendance.clock_out),
            state: i18n.t(d.attendance.confirmed ? 'detail.attendanceConfirmed' : 'detail.attendanceWaiting'),
          })}</dd></div>
        )}
      </dl>
      <div>
        <h3 className="sub-title">{i18n.t('detail.history')}</h3>
        {d.requests.length ? <ul className="history-list">{d.requests.map((r) => <li key={r.request_id}>{historyLine(i18n, r)}</li>)}</ul>
          : <p className="muted">{i18n.t('detail.noHistory')}</p>}
      </div>

      {ownFuture && (
        <div className="sheet-actions">
          <p className="muted">{i18n.t('detail.ownFuture')}</p>
          <Button kind="primary" block to={`/swaps/new/1/${d.id}`} data-sheet-find-cover={d.id}>{i18n.t('schedule.findCover')}</Button>
        </div>
      )}

      {isOwner && mode === 'view' && (
        <div className="sheet-actions">
          {d.actions.can_mark_absent && (
            <Button kind="secondary" block id="act-absent" onClick={() => done(() => rpc('mark_absent', { p_shift_id: d.id }), i18n.t('owner.markedAbsent'))}>
              {i18n.t('owner.absent')}
            </Button>
          )}
          <Button kind="secondary" block id="act-time" onClick={startTime} disabled={!d.actions.can_edit} reason={i18n.t('detail.locked')}>{i18n.t('detail.changeTime')}</Button>
          <Button kind="secondary" block id="act-worker" onClick={startWorker} disabled={!d.actions.can_edit} reason={i18n.t('detail.locked')}>{i18n.t('detail.changeWorker')}</Button>
          <Button kind="danger" block id="act-delete" icon="trash" onClick={() => done(() => rpc('delete_shift', { p_shift_id: d.id }), i18n.t('detail.deleted'))}>
            {i18n.t('detail.delete')}
          </Button>
        </div>
      )}

      {isOwner && mode === 'time' && (
        <form className="form" id="time-form" onSubmit={(e) => { e.preventDefault(); void update(); }} noValidate>
          <label className="field"><span className="field-label">{i18n.t('detail.date')}</span>
            <input type="date" name="workDate" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <div className="row-2">
            <label className="field"><span className="field-label">{i18n.t('detail.start')}</span>
              <input type="time" name="startTime" className="num" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
            <label className="field"><span className="field-label">{i18n.t('detail.end')}</span>
              <input type="time" name="endTime" className="num" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
          </div>
          {form.start && form.end && form.end <= form.start && <p className="hint">{i18n.t('detail.endsNextDay', { end: form.end })}</p>}
          <Button kind="primary" block id="save-time" onClick={update}>{i18n.t('detail.saveTime')}</Button>
        </form>
      )}

      {isOwner && mode === 'worker' && (
        <form className="form" id="worker-form" onSubmit={(e) => { e.preventDefault(); void update(); }} noValidate>
          <label className="field"><span className="field-label">{i18n.t('detail.worker')}</span>
            <select name="workerId" value={form.worker} onChange={(e) => setForm({ ...form, worker: Number(e.target.value) })}>
              {(workers ?? []).map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
            </select></label>
          <Button kind="primary" block id="save-worker" onClick={update}>{i18n.t('detail.saveWorker')}</Button>
        </form>
      )}
    </Sheet>
  );
}

/** FR-05: add a single shift in the week shown. */
function AddShiftSheet({ week, onClose }: { week: string; onClose: () => void }) {
  const i18n = useI18n();
  const { now } = useShell();
  const act = useAction();
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = now?.slice(0, 10) ?? '';
  const [form, setForm] = useState({ date: days.includes(today) ? today : days[0], start: '10:00', end: '15:00', worker: 0 });
  const [error, setError] = useState<string | null>(null);
  const workersScreen = useFetch(async () => (await rpc<WorkerInfo[]>('list_workers')).filter((w) => w.active), []);
  const workers = workersScreen.data;
  const worker = form.worker || workers?.[0]?.id || 0;
  const save = async () => {
    const res = await act(() => rpc('add_shift', { p_work_date: form.date, p_start: form.start, p_end: form.end, p_worker_id: worker }),
      i18n.t('detail.added'));
    if (res.ok) onClose();
    else setError(res.message ?? null);
  };
  return (
    <Sheet title={i18n.t('detail.addTitle')} onClose={onClose}>
      {!workers ? <ScreenState error={workersScreen.error} onRetry={workersScreen.reload} /> : (
        <form className="form" id="add-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
          <FormError message={error} />
          <label className="field"><span className="field-label">{i18n.t('detail.date')}</span>
            <select name="workDate" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}>
              {days.map((d) => <option key={d} value={d}>{i18n.date(d)}</option>)}
            </select></label>
          <div className="row-2">
            <label className="field"><span className="field-label">{i18n.t('detail.start')}</span>
              <input type="time" name="startTime" className="num" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
            <label className="field"><span className="field-label">{i18n.t('detail.end')}</span>
              <input type="time" name="endTime" className="num" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
          </div>
          {form.start && form.end && form.end <= form.start && <p className="hint">{i18n.t('detail.endsNextDay', { end: form.end })}</p>}
          <label className="field"><span className="field-label">{i18n.t('detail.worker')}</span>
            <select name="workerId" value={worker} onChange={(e) => setForm({ ...form, worker: Number(e.target.value) })}>
              {workers.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
            </select></label>
          <Button kind="primary" block id="add-save" onClick={save}>{i18n.t('detail.addSave')}</Button>
        </form>
      )}
    </Sheet>
  );
}
