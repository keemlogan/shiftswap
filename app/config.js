// Shared mode (spec §9, iteration 8): the shared database of the Supabase project "shiftswap" and the demo store.
// The publishable key is public by design: the API roles may only read the app_ tables and call app_snapshot,
// app_commit and app_reset (db/app-shared.sql). Empty values turn the shared mode off (local demonstration mode only).
export const SUPABASE_URL = 'https://dbahxuegxnqsthntpuqy.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Efbr07Evn3lAJUKUqmZWmg_EvWp5DkY';
export const STORE = 'dalbit';
