// Writes the seed template of the shared database (spec §10 "Shared-mode seed") into db/app-shared.sql:
// the rows of the local seed (app/core/db.js, created at the default demo time) without Payroll, in snake_case.
// app_reset moves them by whole weeks to the current date; the payroll history is completed by the app (BR-14).
// Usage: node tools/seed-sql.mjs [--check]   (--check exits with 1 if the file is not up to date)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { createDatabase, all } from '../app/core/db.js';
import { resetClock } from '../app/core/clock.js';

export const SQL_FILE = fileURLToPath(new URL('../db/app-shared.sql', import.meta.url));
const BEGIN = '-- BEGIN SEED TEMPLATE';
const END = '-- END SEED TEMPLATE';
const TABLES = ['Workplace', 'Worker', 'FixedSchedule', 'Shift', 'SubRequest', 'SubRequestTarget', 'Attendance',
  'WeeklySummary', 'MinimumWage', 'Notification'];

export const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** The SQL between the markers: app_seed_template() returning {table: [rows]} with one row per line. */
export function templateSql(SQL) {
  resetClock();
  createDatabase(SQL);
  const parts = TABLES.map((table) => {
    const rows = all(`SELECT * FROM ${table} ORDER BY ${table === 'MinimumWage' ? 'year' : 'id'}`)
      .map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).map(([k, v]) => [snake(k), v]))));
    return `"${table}": [\n${rows.join(',\n')}\n]`;
  });
  const json = `{\n${parts.join(',\n')}\n}`;
  if (json.includes('$json$')) throw new Error('The seed contains the quoting tag $json$.');
  return [
    'create or replace function public.app_seed_template()',
    'returns jsonb',
    'language sql',
    'immutable',
    "set search_path = ''",
    'as $tpl$',
    `select $json$${json}$json$::jsonb`,
    '$tpl$;',
  ].join('\n');
}

/** The whole file with the template section replaced. */
export function withTemplate(text, section) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error(`Markers ${BEGIN} / ${END} not found in ${SQL_FILE}.`);
  const head = text.slice(0, text.indexOf('\n', start) + 1);
  return `${head}${section}\n${text.slice(end)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const SQL = await initSqlJs();
  const text = readFileSync(SQL_FILE, 'utf8');
  const next = withTemplate(text, templateSql(SQL));
  if (process.argv.includes('--check')) {
    console.log(next === text ? 'seed template is up to date' : 'seed template is out of date: run node tools/seed-sql.mjs');
    process.exit(next === text ? 0 : 1);
  }
  writeFileSync(SQL_FILE, next);
  console.log(`seed template written to ${SQL_FILE}`);
}
