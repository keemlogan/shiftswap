// Result shapes of the database functions (db/shiftswap.sql). Dates are 'YYYY-MM-DD', times 'HH:MM', timestamps
// 'YYYY-MM-DDTHH:MM:SS' in Korea time without a zone; hours are numbers with up to two decimals; money is integer KRW.

export type Role = 'OWNER' | 'WORKER';
export type ShiftStatus = 'SCHEDULED' | 'WORKED' | 'ABSENT';
export type RequestStatus = 'REQUESTED' | 'ACCEPTED' | 'APPROVED' | 'REJECTED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
export type TargetResponse = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CLOSED';
export type Policy = 'EXCUSED' | 'ABSENT';

/** ss_shift_json */
export interface Shift {
  id: number;
  work_date: string;
  weekday: number;
  start_time: string;
  end_time: string;
  start_at: string;
  end_at: string;
  minutes: number;
  hours: number;
  worker_id: number;
  worker_name: string;
  original_worker_id: number | null;
  original_worker_name: string | null;
  status: ShiftStatus;
  fixed_schedule_id: number | null;
}

export interface Reason {
  code: 'CONTRACT_BELOW_15' | 'ABSENT' | 'GAVE_AWAY';
  date?: string;
}

export interface Premium {
  daily_minutes: number;
  weekly_minutes: number;
  night_minutes: number;
  part_time_minutes: number;
  total_minutes: number;
}

/** ss_week_calc: one worker's ISO week (BR-06, BR-07, BR-08, BR-16). */
export interface WeekCalc {
  worker_id: number;
  week_start: string;
  contract_minutes: number;
  contract_hours: number;
  part_time: boolean;
  scheduled_minutes: number;
  scheduled_hours: number;
  actual_minutes: number;
  actual_hours: number;
  perfect_attendance: boolean;
  holiday_eligible: boolean;
  holiday_hours: number;
  holiday_pay: number;
  paid_minutes: number;
  base_pay: number;
  premium: Premium;
  premium_hours: number;
  premium_pay: number;
  total_pay: number;
  reasons: Reason[];
}

export interface Change {
  scheduled_hours: number;
  base_pay: number;
  premium_pay: number;
  holiday_pay: number;
  total: number;
}

/** ss_person_effect: one person of a swap, before → after. */
export interface PersonEffect {
  worker_id: number;
  name: string;
  hourly_wage: number;
  contract_hours: number;
  part_time: boolean;
  before: WeekCalc;
  after: WeekCalc;
  change: Change;
  eligibility_changed: boolean;
}

/** approval_preview (also the elements of owner_home.decisions). */
export interface ApprovalPreview {
  request_id: number;
  status: RequestStatus;
  requester_id: number;
  acceptor_id: number;
  deadline: string;
  reason: string | null;
  shift: Shift;
  week_start: string;
  policy: Policy;
  regular_employees: number;
  requester: PersonEffect;
  acceptor: PersonEffect;
  store_total_change: number;
  warning: { beyond_contract: number; limit: number } | null;
}

/** ss_request_params: the parameters of a request notification. */
export interface RequestParams {
  request_id: number;
  status: RequestStatus;
  requester_id: number;
  requester_name: string;
  acceptor_id: number | null;
  acceptor_name: string | null;
  shift_id: number;
  work_date: string;
  start_time: string;
  end_time: string;
  deadline: string;
  reason: string | null;
}

export interface Target {
  worker_id: number;
  name: string;
  response: TargetResponse;
  responded_at: string | null;
}

export interface WorkerHome {
  worker: { id: number; name: string };
  now: string;
  today: string;
  incoming: (RequestParams & { effect: PersonEffect })[];
  taken: RequestParams[];
  my_open: (RequestParams & { targets: Target[] })[];
  failed: (RequestParams & { notification_id: number })[];
  next_shift: Shift | null;
  week: WeekCalc;
  to_record: Shift[];
  unread: number;
}

export interface OwnerHome {
  now: string;
  today: string;
  decisions: ApprovalPreview[];
  open: (RequestParams & { targets: Target[] })[];
  failed: (RequestParams & { notification_id: number })[];
  to_confirm: (Shift & { clock_in: string; clock_out: string; recorded_minutes: number })[];
  payroll_ready: { notification_id: number; year_month: string }[];
  pay_warnings: { year_month: string; worker_id: number; name: string; hourly_wage: number }[];
  today_shifts: Shift[];
  week: { week_start: string; shifts: number; hours: number; holiday_total: number; labour_cost: number };
  unread: number;
}

export interface AttendanceInfo {
  clock_in: string;
  clock_out: string;
  confirmed: boolean;
  minutes?: number;
}

export interface BoardShift extends Shift {
  handover: boolean;
  open_request: { id: number; status: RequestStatus; requester_id: number; acceptor_id: number | null; deadline: string } | null;
  attendance: AttendanceInfo | null;
}

export interface WeekBoard {
  week_start: string;
  week_end: string;
  days: string[];
  shifts: BoardShift[];
}

export interface ShiftDetail extends Shift {
  attendance: AttendanceInfo | null;
  requests: (RequestParams & { created_at: string; decided_at: string | null; targets: Target[] })[];
  actions: { can_edit: boolean; can_delete: boolean; can_mark_absent: boolean; can_confirm_attendance: boolean };
}

export interface FixedSlot {
  id?: number;
  weekday: number;
  start_time: string;
  end_time: string;
  hours?: number;
}

export interface DemoAccount {
  id: number;
  role: Role;
  name: string;
  contract_hours: number | null;
  fixed: FixedSlot[];
}

export interface Settings {
  workplace: { id: number; name: string; regular_employees: number; sub_attendance_policy: Policy; demo_clock: string | null };
  now: string;
  minimum_wages: { year: number; hourly: number }[];
}

export interface WorkerInfo {
  id: number;
  name: string;
  role: Role;
  phone: string | null;
  hourly_wage: number | null;
  contract_start: string | null;
  contract_end: string | null;
  probation_end: string | null;
  simple_labor: boolean;
  active: boolean;
  contract_hours: number;
  fixed?: FixedSlot[];
}

export interface RequestableShift {
  id: number;
  work_date: string;
  start_time: string;
  end_time: string;
  start_at: string;
  default_deadline: string;
}

export interface ShiftRef {
  id: number;
  work_date: string;
  start_time: string;
  end_time: string;
}

export interface MyRequest {
  id: number;
  status: RequestStatus;
  shift: ShiftRef;
  reason: string | null;
  deadline: string;
  acceptor: { id: number; name: string } | null;
  created_at: string;
  decided_at: string | null;
  targets: Target[];
}

export interface RequestForMe {
  id: number;
  status: RequestStatus;
  requester: { id: number; name: string };
  shift: ShiftRef;
  reason: string | null;
  deadline: string;
  my_response: TargetResponse;
  acceptor: { id: number; name: string } | null;
  effect: {
    scheduled_before: number;
    scheduled_after: number;
    holiday_pay_before: number;
    holiday_pay_after: number;
    eligible_before: boolean;
    eligible_after: boolean;
    total_change: number;
  } | null;
}

export interface MyRequests {
  mine: MyRequest[];
  for_me: RequestForMe[];
}

export interface AttendanceRow extends Shift {
  attendance: AttendanceInfo | null;
  can_record: boolean;
}

export interface WeekSummaryRow {
  worker_id: number;
  name: string;
  hourly_wage: number;
  contract_hours: number;
  scheduled_hours: number;
  actual_hours: number;
  perfect_attendance: boolean;
  holiday_eligible: boolean;
  holiday_hours: number;
  holiday_pay: number;
  reasons: Reason[];
}

export interface WeekSummary {
  week_start: string;
  week_end: string;
  frozen: boolean;
  policy: Policy;
  regular_employees: number;
  rows: WeekSummaryRow[];
}

export interface PayrollRow {
  id: number;
  worker_id: number;
  name: string;
  hourly_wage: number;
  base_hours: number;
  base_pay: number;
  holiday_pay: number;
  premium_pay: number;
  total: number;
  min_wage_warning: boolean;
  min_wage_ack: boolean;
  estimated: boolean;
  status: 'DRAFT' | 'CONFIRMED';
  probation_minimum: number | null;
}

export interface PayrollMonth {
  year_month: string;
  status: 'NONE' | 'DRAFT' | 'CONFIRMED';
  auto_prepared: boolean;
  minimum_hourly: number | null;
  unacknowledged_warnings: number;
  rows: PayrollRow[];
  totals: { base_hours: number; base_pay: number; holiday_pay: number; premium_pay: number; total: number };
}

export interface PayrollMonthItem {
  year_month: string;
  status: 'DRAFT' | 'CONFIRMED';
  auto_prepared: boolean;
}

export type NotificationKind = 'REQUEST_RECEIVED' | 'REQUEST_ACCEPTED' | 'TARGET_CLOSED' | 'REQUEST_APPROVED'
  | 'REQUEST_REJECTED' | 'REQUEST_EXPIRED' | 'REQUEST_CANCELLED' | 'REQUEST_FAILED' | 'PAYROLL_DRAFT_READY';

export interface NotificationItem {
  id: number;
  kind: NotificationKind;
  params: Partial<RequestParams> & { year_month?: string };
  sub_request_id: number | null;
  created_at: string;
  read_at: string | null;
}

export interface Notifications {
  items: NotificationItem[];
  unread: number;
}

export interface SessionUser {
  id: number;
  role: Role;
  name: string;
}
