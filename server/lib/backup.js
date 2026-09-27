// The live database (dev.db) is deliberately never synced anywhere while
// the app is running — see the README for why. This is the actual backup
// story instead: a periodic, consistent snapshot taken safely while the
// app keeps writing to the real file, kept locally with count-based
// rotation, and optionally mirrored into a synced folder (e.g. OneDrive)
// for off-machine redundancy, kept there much longer since it costs no
// local disk — mirroring completed snapshot files is safe; the live file
// itself never is.
'use strict';
const fs = require('fs/promises');
const path = require('path');
const { prisma } = require('./db');

const projectRoot = path.join(__dirname, '..', '..');
const BACKUP_DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(projectRoot, 'backups');
const MIRROR_DIR = process.env.BACKUP_MIRROR_DIR ? path.resolve(process.env.BACKUP_MIRROR_DIR) : null;
const RETENTION_COUNT = Number(process.env.BACKUP_RETENTION_COUNT || 72); // local: count-based (disk space is the constraint)
const MIRROR_RETENTION_DAYS = Number(process.env.BACKUP_MIRROR_RETENTION_DAYS || 30); // mirror: age-based
const INTERVAL_MINUTES = Number(process.env.BACKUP_INTERVAL_MINUTES || 60);
const ALERT_AFTER_FAILURES = Number(process.env.BACKUP_ALERT_AFTER_FAILURES || 3);
const STATUS_FILE = path.join(BACKUP_DIR, 'status.json');

const EMPTY_STATUS = { lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0, lastError: null };

function timestampedFilename() { return `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`; }

async function readStatus() {
  try { return Object.assign({}, EMPTY_STATUS, JSON.parse(await fs.readFile(STATUS_FILE, 'utf8'))); }
  catch (e) { return Object.assign({}, EMPTY_STATUS); }
}
async function writeStatus(status) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  await fs.writeFile(STATUS_FILE, JSON.stringify(status, null, 2));
}
async function listBackupFiles(dir) {
  const entries = await fs.readdir(dir).catch(() => []);
  return entries.filter(f => f.startsWith('backup-') && f.endsWith('.db')).sort();
}
async function rotateByCount(dir, keepCount) {
  const backups = await listBackupFiles(dir);
  for (let i = 0; i < backups.length - keepCount; i++) await fs.unlink(path.join(dir, backups[i])).catch(() => {});
}
async function rotateByAge(dir, keepDays) {
  const backups = await listBackupFiles(dir), cutoff = Date.now() - keepDays * 86400000;
  for (const name of backups) {
    const full = path.join(dir, name), stat = await fs.stat(full).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.unlink(full).catch(() => {});
  }
}

async function runBackup() {
  const status = await readStatus();
  status.lastAttemptAt = new Date().toISOString();
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const filename = timestampedFilename(), localPath = path.join(BACKUP_DIR, filename);
    // SQLite's own hot-backup mechanism: a consistent snapshot without
    // locking out the app's own connection, unlike a raw file copy of a
    // database that's actively being written to.
    await prisma.$executeRawUnsafe(`VACUUM INTO '${localPath.replace(/'/g, "''")}'`);
    await rotateByCount(BACKUP_DIR, RETENTION_COUNT);
    if (MIRROR_DIR) {
      await fs.mkdir(MIRROR_DIR, { recursive: true });
      await fs.copyFile(localPath, path.join(MIRROR_DIR, filename));
      await rotateByAge(MIRROR_DIR, MIRROR_RETENTION_DAYS);
    }
    status.lastSuccessAt = status.lastAttemptAt; status.consecutiveFailures = 0; status.lastError = null;
    console.log(`[backup] wrote ${filename}${MIRROR_DIR ? ' (mirrored)' : ''}`);
  } catch (err) {
    status.consecutiveFailures += 1; status.lastError = err instanceof Error ? err.message : String(err);
    console.error(`[backup] run failed (${status.consecutiveFailures} in a row):`, err);
  }
  await writeStatus(status).catch(err => console.error('[backup] could not write status file:', err));
}

/** Read-only status check, safe to call from a request handler — never throws. */
async function getBackupHealth() {
  const status = await readStatus();
  const graceMs = INTERVAL_MINUTES * 60 * 1000 * 2; // 2 missed runs before flagging staleness
  const stale = !status.lastSuccessAt || Date.now() - new Date(status.lastSuccessAt).getTime() > graceMs;
  return {
    healthy: status.consecutiveFailures < ALERT_AFTER_FAILURES && !stale,
    lastSuccessAt: status.lastSuccessAt, consecutiveFailures: status.consecutiveFailures, lastError: status.lastError
  };
}

let scheduled = false;
function startBackupSchedule() {
  if (scheduled) return;
  scheduled = true;
  runBackup().catch(err => console.error('[backup] initial run failed:', err));
  setInterval(() => runBackup().catch(err => console.error('[backup] scheduled run failed:', err)), INTERVAL_MINUTES * 60 * 1000);
}

module.exports = { runBackup, getBackupHealth, startBackupSchedule, BACKUP_DIR };
