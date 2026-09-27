// Restores the live database from a snapshot taken by the automatic backup
// job (server/lib/backup.js). Stops the RideOps Windows Service if one is
// installed, swaps the database file, keeps a safety copy of whatever it
// replaced, and starts the service back up.
//
// Usage (from an elevated PowerShell/cmd window, same as the service scripts):
//   node scripts/restore-backup.js                 restore the most recent local snapshot
//   node scripts/restore-backup.js --file <path>    restore a specific snapshot file
//   node scripts/restore-backup.js --list           list available local snapshots and exit
'use strict';
const fs = require('fs');
const path = require('path');
const { Service } = require('node-windows');

const projectRoot = path.join(__dirname, '..');
const backupDir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(projectRoot, 'backups');

function loadDatabasePath() {
  const envPath = path.join(projectRoot, '.env');
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const match = text.match(/^DATABASE_URL\s*=\s*"?file:(.+?)"?\s*$/m);
  return path.resolve(projectRoot, match ? match[1] : './dev.db');
}
function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).filter(f => f.startsWith('backup-') && f.endsWith('.db')).sort();
}
function parseArgs(argv) {
  const args = { file: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--list') args.list = true;
  }
  return args;
}

// Wraps node-windows' event-based start/stop in a promise with a timeout,
// resolving false (rather than rejecting) on any failure — the caller
// always has a fallback path ("stop/start it yourself") either way.
function serviceAction(action) {
  return new Promise(resolve => {
    const svc = new Service({ name: 'RideOps', script: path.join(__dirname, 'service-wrapper.js') });
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    svc.on(action, () => finish(true));
    svc.on('alreadystopped', () => finish(true));
    svc.on('error', () => finish(false));
    setTimeout(() => finish(false), 20000);
    try { svc[action](); } catch (e) { finish(false); }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backups = listBackups();

  if (args.list) {
    if (backups.length === 0) console.log('No local backups found in', backupDir);
    else { console.log('Available backups, oldest first:'); backups.forEach(f => console.log(' -', f)); }
    return;
  }
  if (backups.length === 0 && !args.file) {
    console.error('No local backups found in', backupDir);
    console.error('Pass --file <path> to restore from somewhere else (e.g. the OneDrive mirror folder).');
    process.exitCode = 1;
    return;
  }

  const chosenFile = args.file ? path.resolve(args.file) : path.join(backupDir, backups[backups.length - 1]);
  if (!fs.existsSync(chosenFile)) { console.error('Backup file not found:', chosenFile); process.exitCode = 1; return; }

  const dbPath = loadDatabasePath();
  console.log('Restoring:'); console.log('  from:', chosenFile); console.log('  to:  ', dbPath);

  console.log('\nStopping the RideOps service (if installed)...');
  const stopped = await serviceAction('stop');
  console.log(stopped ? '  Stopped.' : '  Could not confirm it stopped — it may not be installed as a service, or is running another way.\n  If RideOps is running at all right now (npm run dev, a fallback script, anything), STOP IT before continuing.');
  await new Promise(r => setTimeout(r, 1500)); // let any lingering file handle release

  if (fs.existsSync(dbPath)) {
    const safetyCopy = `${dbPath}.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    fs.copyFileSync(dbPath, safetyCopy);
    console.log('\nSaved the current database to:'); console.log(' ', safetyCopy);
  }
  for (const suffix of ['-wal', '-shm']) { // stale sidecar files could otherwise shadow the restored file
    const sidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
  fs.copyFileSync(chosenFile, dbPath);
  console.log('\nDatabase restored from', path.basename(chosenFile));

  console.log('\nStarting the RideOps service back up...');
  const started = await serviceAction('start');
  console.log(started ? '  Started.' : '  Could not confirm it started — start it manually (services.msc, or your fallback method).');
  console.log('\nDone.');
}

main().catch(err => { console.error('Restore failed:', err); process.exitCode = 1; });
