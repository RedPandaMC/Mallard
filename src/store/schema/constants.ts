export const STORE_SCHEMA_VERSION = 5;

/** Keep this many days of raw, per-request events before rolling up. */
export const RAW_WINDOW_DAYS = 90;

/** Force a rollup if the raw event count ever exceeds this. */
export const MAX_RAW_EVENTS = 50_000;
