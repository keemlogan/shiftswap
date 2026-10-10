// Me (worker; worker_detail, attendance_list, record_attendance): contract, wage and phone — shown only to the worker
// and the owner (NFR-11) — and the attendance of last week and this week with Record on the rows that can be recorded.
import { useState } from 'react';
import { rpc } from '../api';
import { Button, Chip, EmptyState, PageHead, ScreenState, Section } from '../components/ui';
import { useScreen, useShell } from '../context';
import { useI18n } from '../i18n';
import type { AttendanceRow, WorkerInfo } from '../types';
import { RecordSheet } from './Attendance';

export function Me() {
  const i18n = useI18n();
  const { user, now } = useShell();
  const [recording, setRecording] = useState<AttendanceRow | null>(null);
  const screen = useScreen(async () => {
    const [me, rows] = await Promise.all([
      rpc<WorkerInfo>('worker_detail', { p_worker_id: user!.id }),
      rpc<AttendanceRow[]>('attendance_list', { p_worker_id: user!.id }),
    ]);
    return { me, rows };
  }, [user!.id]);
  const data = screen.data;
  if (!data) return <div className="screen" data-screen="me" data-loaded="false"><ScreenState error={screen.error} onRetry={screen.reload} /></div>;
  const { me } = data;
  const rows = [...data.rows].sort((a, b) => `${b.work_date}${b.start_time}`.localeCompare(`${a.work_date}${a.start_time}`));
  const firstRecordable = rows.find((r) => r.can_record)?.id ?? null;

  return (
    <div className="screen" data-screen="me" data-loaded="true">
      <PageHead title={i18n.t('me.title')} sub={i18n.t('me.sub')}
        cta={firstRecordable === null ? <Button kind="primary" block to="/schedule">{i18n.t('home.openSchedule')}</Button> : undefined} />
      <Section>
        <div className="card profile">
          <div className="card-row"><h2 className="card-title">{i18n.name(me.name)}</h2><Chip>{i18n.t('role.WORKER')}</Chip></div>
          <dl className="summary-list">
            <div><dt>{i18n.t('me.contract')}</dt><dd className="num">{i18n.t('staff.period', {
              from: i18n.ymd(me.contract_start), to: me.contract_end ? i18n.ymd(me.contract_end) : i18n.t('staff.openEnded'),
            })}</dd></div>
            <div><dt>{i18n.t('me.hours')}</dt><dd className="num">{i18n.perWeek(me.contract_hours)}</dd></div>
            <div><dt>{i18n.t('me.fixed')}</dt><dd className="num">{me.fixed?.length ? i18n.fixedSummary(me.fixed) : i18n.t('signin.noFixed')}</dd></div>
            <div><dt>{i18n.t('me.wage')}</dt><dd className="num" data-wage>{me.hourly_wage != null ? i18n.won(me.hourly_wage) : ''}</dd></div>
            <div><dt>{i18n.t('me.phone')}</dt><dd className="num" data-phone>{me.phone ?? ''}</dd></div>
          </dl>
          <p className="hint">{i18n.t('me.privacy')}</p>
        </div>
      </Section>
      <Section title={i18n.t('me.attendance')} id="attendance-title">
        <p className="muted">{i18n.t('me.attendanceSub')}</p>
        {rows.length ? (
          <ul className="card list">
            {rows.map((s) => {
              let state: JSX.Element;
              if (s.status === 'ABSENT') state = <Chip tone="alert">{i18n.t('me.absent')}</Chip>;
              else if (s.status === 'WORKED' && s.attendance) state = <Chip tone="ok" className="num">{i18n.t('me.confirmed', { range: i18n.range(s.attendance.clock_in, s.attendance.clock_out) })}</Chip>;
              else if (s.attendance) state = <Chip tone="handover" className="num">{i18n.t('me.recorded', { range: i18n.range(s.attendance.clock_in, s.attendance.clock_out) })}</Chip>;
              else if (s.can_record) {
                state = <Button kind={s.id === firstRecordable ? 'primary' : 'secondary'} small onClick={() => setRecording(s)} data-record={s.id}>{i18n.t('me.record')}</Button>;
              } else state = <Chip>{i18n.t(now && s.start_at <= now ? 'me.notEnded' : 'me.upcoming')}</Chip>;
              return (
                <li key={s.id} className="list-row" data-attendance-row={s.id}>
                  <div className="list-main"><strong>{i18n.date(s.work_date)}</strong><span className="muted num">{i18n.range(s.start_time, s.end_time)}</span></div>
                  <div className="list-side">{state}</div>
                </li>
              );
            })}
          </ul>
        ) : <EmptyState text={i18n.t('me.attendanceEmpty')} />}
      </Section>
      {recording && <RecordSheet shift={recording} onClose={() => setRecording(null)} />}
    </div>
  );
}
