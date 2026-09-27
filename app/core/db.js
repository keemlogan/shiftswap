// Data access: sql.js database, schema (spec §8), seed data (spec §10), persistence and tx().

export const DB_KEY = 'shiftswap.db.v1';

export const SCHEMA = `
CREATE TABLE Workplace (id INTEGER PRIMARY KEY, name TEXT NOT NULL, regularEmployees INTEGER NOT NULL DEFAULT 4,
  subAttendancePolicy TEXT NOT NULL DEFAULT 'EXCUSED' CHECK (subAttendancePolicy IN ('EXCUSED','ABSENT')));
CREATE TABLE Worker (id INTEGER PRIMARY KEY, workplaceId INTEGER NOT NULL REFERENCES Workplace(id), role TEXT NOT NULL CHECK (role IN ('OWNER','WORKER')),
  name TEXT NOT NULL, phone TEXT, hourlyWage INTEGER, contractStart TEXT, contractEnd TEXT, probationEnd TEXT,
  simpleLabor INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE FixedSchedule (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  startTime TEXT NOT NULL, endTime TEXT NOT NULL);
CREATE TABLE Availability (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  startTime TEXT NOT NULL, endTime TEXT NOT NULL);
CREATE TABLE Shift (id INTEGER PRIMARY KEY, workDate TEXT NOT NULL, startTime TEXT NOT NULL, endTime TEXT NOT NULL,
  workerId INTEGER NOT NULL REFERENCES Worker(id), originalWorkerId INTEGER REFERENCES Worker(id), fixedScheduleId INTEGER REFERENCES FixedSchedule(id),
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','WORKED','ABSENT')));
CREATE TABLE SubRequest (id INTEGER PRIMARY KEY, shiftId INTEGER NOT NULL REFERENCES Shift(id), requesterId INTEGER NOT NULL REFERENCES Worker(id),
  acceptorId INTEGER REFERENCES Worker(id), reason TEXT, deadline TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','ACCEPTED','APPROVED','REJECTED','EXPIRED','CANCELLED')), createdAt TEXT NOT NULL, decidedAt TEXT);
CREATE TABLE SubRequestTarget (id INTEGER PRIMARY KEY, subRequestId INTEGER NOT NULL REFERENCES SubRequest(id), workerId INTEGER NOT NULL REFERENCES Worker(id),
  response TEXT NOT NULL DEFAULT 'PENDING' CHECK (response IN ('PENDING','ACCEPTED','DECLINED','CLOSED')), respondedAt TEXT);
CREATE TABLE Attendance (id INTEGER PRIMARY KEY, shiftId INTEGER NOT NULL UNIQUE REFERENCES Shift(id), clockIn TEXT NOT NULL, clockOut TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE WeeklySummary (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), weekStart TEXT NOT NULL,
  contractHours REAL NOT NULL, scheduledHours REAL NOT NULL, actualHours REAL NOT NULL, perfectAttendance INTEGER NOT NULL,
  holidayEligible INTEGER NOT NULL, holidayHours REAL NOT NULL, UNIQUE (workerId, weekStart));
CREATE TABLE Payroll (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), yearMonth TEXT NOT NULL,
  baseHours REAL NOT NULL, basePay INTEGER NOT NULL, holidayPay INTEGER NOT NULL, premiumPay INTEGER NOT NULL, total INTEGER NOT NULL,
  minWageWarning INTEGER NOT NULL DEFAULT 0, minWageAck INTEGER NOT NULL DEFAULT 0, estimated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED')), UNIQUE (workerId, yearMonth));
CREATE TABLE MinimumWage (year INTEGER PRIMARY KEY, hourly INTEGER NOT NULL);
CREATE TABLE Notification (id INTEGER PRIMARY KEY, workerId INTEGER NOT NULL REFERENCES Worker(id), subRequestId INTEGER REFERENCES SubRequest(id),
  kind TEXT NOT NULL, message TEXT NOT NULL, createdAt TEXT NOT NULL, readAt TEXT);
`;

let SQLlib = null;
let db = null;
let storage = null;
let depth = 0;

/** Create an in-memory database with the schema (and the seed data unless seed = false). Used by Node tests. */
export function createDatabase(SQL, { seed = true } = {}) {
  SQLlib = SQL;
  storage = null;
  db = new SQL.Database();
  db.run(SCHEMA);
  if (seed) seedDatabase();
  return db;
}

/** Browser start-up: load the saved database from storage, otherwise create schema + seed and save it. */
export function openDatabase(SQL, store) {
  SQLlib = SQL;
  storage = store;
  const saved = store.getItem(DB_KEY);
  if (saved) {
    try {
      db = new SQL.Database(fromBase64(saved));
      if (hasCurrentSchema()) return db;
      console.warn('Saved ShiftSwap data uses an older schema; starting from the demo data.');
    } catch (err) {
      console.warn('Saved ShiftSwap data could not be read; starting from the demo data.', err);
    }
  }
  db = new SQL.Database();
  db.run(SCHEMA);
  seedDatabase();
  persist();
  return db;
}

/** A saved database from before spec v2 lacks Payroll.minWageAck; such a copy is replaced by the seed. */
function hasCurrentSchema() {
  const columns = db.exec('PRAGMA table_info(Payroll)');
  return columns.length > 0 && columns[0].values.some((c) => c[1] === 'minWageAck');
}

/** "Reset demo data": drop the saved copy and rebuild schema + seed. */
export function resetDatabase() {
  if (storage) storage.removeItem(DB_KEY);
  db = new SQLlib.Database();
  db.run(SCHEMA);
  seedDatabase();
  persist();
}

function persist() {
  if (!storage) return;
  storage.setItem(DB_KEY, toBase64(db.export()));
}

/** Run fn inside BEGIN … COMMIT (ROLLBACK on error) and save the database after the commit. Nested calls join the outer transaction. */
export function tx(fn) {
  if (depth > 0) return fn();
  db.run('BEGIN');
  depth++;
  let result;
  try {
    result = fn();
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
  persist();
  return result;
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

export function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

/** Execute a write statement; returns the new row id and the number of changed rows. */
export function run(sql, params = []) {
  db.run(sql, params);
  const changes = db.getRowsModified();
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  return { id, changes };
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---- Seed data (spec §10) -------------------------------------------------

const SEED_WEEKS = ['2026-09-21', '2026-09-28'];

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function seedDatabase() {
  db.run("INSERT INTO Workplace (id, name, regularEmployees, subAttendancePolicy) VALUES (1, 'Dalbit Café', 4, 'EXCUSED')");
  db.run('INSERT INTO MinimumWage (year, hourly) VALUES (2025, 10030), (2026, 10320)');
  const workers = [
    [1, 'OWNER', 'Park Jiyoung', '010-3827-1150', null, null, null, null, 0],
    [2, 'WORKER', 'Lee Seoyeon', '010-4172-2083', 10500, '2026-03-02', '2027-02-28', null, 0],
    [3, 'WORKER', 'Choi Minho', '010-5290-3316', 10320, '2026-06-01', '2026-12-31', null, 0],
    [4, 'WORKER', 'Jung Hana', '010-6631-4427', 10320, '2026-09-01', null, '2026-11-30', 0],
    [5, 'WORKER', 'Kang Doyun', '010-7748-5539', 10000, '2026-08-15', '2026-11-15', null, 1],
  ];
  for (const w of workers) {
    db.run(
      `INSERT INTO Worker (id, workplaceId, role, name, phone, hourlyWage, contractStart, contractEnd, probationEnd, simpleLabor, active)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      w,
    );
  }
  const fixed = [
    [2, 1, '18:00', '23:00'], [2, 3, '18:00', '23:00'],
    [3, 2, '18:00', '23:00'], [3, 4, '18:00', '23:00'], [3, 6, '12:00', '18:00'],
    [4, 5, '17:00', '23:00'], [4, 7, '10:00', '16:00'],
    [5, 6, '10:00', '16:00'], [5, 7, '16:00', '22:00'],
  ];
  for (const f of fixed) db.run('INSERT INTO FixedSchedule (workerId, weekday, startTime, endTime) VALUES (?, ?, ?, ?)', f);
  const availability = [
    [2, 2, '17:00', '23:00'], [2, 4, '17:00', '23:00'], [2, 6, '10:00', '22:00'],
    [3, 1, '17:00', '23:00'], [3, 3, '17:00', '23:00'],
    [4, 1, '18:00', '23:00'], [4, 6, '10:00', '18:00'],
    [5, 3, '18:00', '23:00'], [5, 4, '18:00', '23:00'], [5, 5, '17:00', '23:00'],
  ];
  for (const a of availability) db.run('INSERT INTO Availability (workerId, weekday, startTime, endTime) VALUES (?, ?, ?, ?)', a);

  const schedules = all('SELECT * FROM FixedSchedule ORDER BY id');
  for (const week of SEED_WEEKS) {
    for (const f of schedules) {
      const date = addDays(week, f.weekday - 1);
      const worked = week === '2026-09-21';
      db.run(
        'INSERT INTO Shift (workDate, startTime, endTime, workerId, fixedScheduleId, status) VALUES (?, ?, ?, ?, ?, ?)',
        [date, f.startTime, f.endTime, f.workerId, f.id, worked ? 'WORKED' : 'SCHEDULED'],
      );
      if (worked) {
        const shiftId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        db.run('INSERT INTO Attendance (shiftId, clockIn, clockOut, confirmed) VALUES (?, ?, ?, 1)', [shiftId, f.startTime, f.endTime]);
      }
    }
  }

  const shift = get("SELECT id FROM Shift WHERE workerId = 2 AND workDate = '2026-09-30'");
  const createdAt = '2026-09-28T08:30';
  db.run(
    "INSERT INTO SubRequest (id, shiftId, requesterId, reason, deadline, status, createdAt) VALUES (1, ?, 2, 'Midterm exam', '2026-09-29T21:00', 'REQUESTED', ?)",
    [shift.id, createdAt],
  );
  for (const workerId of [3, 5]) {
    db.run("INSERT INTO SubRequestTarget (subRequestId, workerId, response) VALUES (1, ?, 'PENDING')", [workerId]);
    db.run(
      "INSERT INTO Notification (workerId, subRequestId, kind, message, createdAt) VALUES (?, 1, 'REQUEST_RECEIVED', ?, ?)",
      [workerId, 'Lee Seoyeon asks for a substitute on Wed 2026-09-30 18:00–23:00. Reply by 2026-09-29 21:00.', createdAt],
    );
  }
}
