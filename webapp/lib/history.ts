// Server-only reader for the hourly history DB written by the data worker
// (scripts/history.py — keep the layout in sync).
//
// fac_day: one row per (facility, UTC day), 24 hourly slots of 9 bytes:
// int32 vacantSpaces, int32 parkingCapacity, uint8 flags.
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import type { DailySnapshots } from '@/types/parking';

const SLOT = 9;
const F_SAMPLE = 1, F_V = 2, F_C = 4, F_O_SET = 8, F_O = 16, F_F_SET = 32, F_F = 64;

// Set by the Docker image; for local dev in .env.development.local. Env-only on
// purpose: a computed fallback path makes Next trace the whole project.
const DB_PATH = process.env.PARKING_HISTORY_DB;

let db: Database.Database | null = null;

function open(): Database.Database | null {
  if (db) return db;
  if (!DB_PATH || !existsSync(DB_PATH)) return null;
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return db;
}

export const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
export const dayString = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
export const todayUtc = () => new Date().toISOString().slice(0, 10);

type Entry = DailySnapshots['snapshots'][string]['facilities'][string];

function decode(buf: Buffer, hour: number): Entry | null {
  const o = hour * SLOT;
  const flags = buf[o + 8];
  if (!(flags & F_SAMPLE)) return null;
  const entry: Entry = {};
  if (flags & F_V) entry.v = buf.readInt32LE(o);
  if (flags & F_C) entry.c = buf.readInt32LE(o + 4);
  if (flags & F_O_SET) entry.o = Boolean(flags & F_O);
  if (flags & F_F_SET) entry.f = Boolean(flags & F_F);
  return entry;
}

function build(
  hours: { day: number; hour: number; ts: string }[],
  rows: { day: number; uuid: string; data: Buffer }[],
): DailySnapshots[] {
  const days = new Map<number, DailySnapshots>();
  for (const h of hours) {
    let d = days.get(h.day);
    if (!d) days.set(h.day, (d = { date: dayString(h.day), snapshots: {} }));
    d.snapshots[String(h.hour).padStart(2, '0')] = { timestamp: h.ts, facility_count: 0, facilities: {} };
  }
  for (const r of rows) {
    const d = days.get(r.day);
    if (!d) continue;
    for (const [key, snap] of Object.entries(d.snapshots)) {
      const entry = decode(r.data, Number(key));
      if (entry) {
        snap.facilities[r.uuid] = entry;
        snap.facility_count++;
      }
    }
  }
  return [...days.values()];
}

// The old public/data/snapshots/YYYY/MM/DD.json day file, rebuilt from the DB.
export function daySnapshots(date: string): DailySnapshots | null {
  const conn = open();
  if (!conn) return null;
  const day = dayNumber(date);
  const hours = conn
    .prepare('SELECT day, hour, ts FROM snap_hour WHERE day = ? ORDER BY hour')
    .all(day) as { day: number; hour: number; ts: string }[];
  if (hours.length === 0) return null;
  const rows = conn
    .prepare('SELECT d.day AS day, f.uuid AS uuid, d.data AS data FROM fac_day d JOIN facility f ON f.id = d.fac WHERE d.day = ?')
    .all(day) as { day: number; uuid: string; data: Buffer }[];
  return build(hours, rows)[0];
}

// One facility's day files for the `days` UTC days ending today, oldest first;
// days without any snapshot are left out. facility_count counts only this facility.
export function facilityHistory(uuid: string, days: number): DailySnapshots[] {
  const conn = open();
  if (!conn) return [];
  const to = dayNumber(todayUtc());
  const from = to - days + 1;
  const hours = conn
    .prepare('SELECT day, hour, ts FROM snap_hour WHERE day BETWEEN ? AND ? ORDER BY day, hour')
    .all(from, to) as { day: number; hour: number; ts: string }[];
  const rows = conn
    .prepare(
      `SELECT d.day AS day, f.uuid AS uuid, d.data AS data
         FROM fac_day d JOIN facility f ON f.id = d.fac
        WHERE f.uuid = ? AND d.day BETWEEN ? AND ?`,
    )
    .all(uuid, from, to) as { day: number; uuid: string; data: Buffer }[];
  return build(hours, rows);
}
