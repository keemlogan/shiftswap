// UC-07 Record attendance (FR-13, BR-17): the worker records clock-in and clock-out of an ended shift; a clock-out
// earlier than the clock-in is on the next day. The database checks plausibility (ATTENDANCE_IMPLAUSIBLE).
import { useState } from 'react';
import { rpc } from '../api';
import { Button, FormError, Sheet } from '../components/ui';
import { useAction, useShell } from '../context';
import { useI18n } from '../i18n';

export interface RecordTarget {
  id: number;
  work_date: string;
  start_time: string;
  end_time: string;
}

export function RecordSheet({ shift, onClose }: { shift: RecordTarget; onClose: () => void }) {
  const i18n = useI18n();
  const { user } = useShell();
  const act = useAction();
  const [clockIn, setClockIn] = useState(shift.start_time);
  const [clockOut, setClockOut] = useState(shift.end_time);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const res = await act(() => rpc('record_attendance', {
      p_shift_id: shift.id, p_worker_id: user!.id, p_clock_in: clockIn, p_clock_out: clockOut,
    }), i18n.t('record.saved'));
    if (res.ok) onClose();
    else setError(res.message ?? null);
  };
  return (
    <Sheet title={i18n.t('record.title')} onClose={onClose}>
      <form className="form" id="record-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <FormError message={error} />
        <p className="shift-line num">{i18n.shift(shift)}</p>
        <div className="row-2">
          <label className="field"><span className="field-label">{i18n.t('record.in')}</span>
            <input type="time" name="clockIn" className="num" value={clockIn} onChange={(e) => setClockIn(e.target.value)} required />
          </label>
          <label className="field"><span className="field-label">{i18n.t('record.out')}</span>
            <input type="time" name="clockOut" className="num" value={clockOut} onChange={(e) => setClockOut(e.target.value)} required />
          </label>
        </div>
        <p className="hint">{i18n.t('record.hint')}</p>
        <Button kind="primary" block onClick={save} id="record-save">{i18n.t('record.save')}</Button>
      </form>
    </Sheet>
  );
}
