// Entry point node-windows actually launches as the Windows Service. Runs
// two long-lived children tied to this service's lifetime:
//   1. the app itself, bound to loopback only — never directly reachable
//      from the LAN, only from this same machine
//   2. the HTTPS reverse proxy (scripts/https-proxy.js), which is what
//      actually listens on the LAN, terminating TLS and forwarding to (1)
// If either dies, the other is killed and this process exits — so the
// service (and its own restart policy) sees the failure rather than half
// the app quietly running without the other half.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');
const hasCert = fs.existsSync(path.join(projectRoot, 'certs', 'cert.pem'));

const app = spawn('npm.cmd', ['run', 'start:internal'], { cwd: projectRoot, stdio: 'inherit', shell: true });

let proxy = null;
if (hasCert) {
  proxy = spawn('node', ['scripts/https-proxy.js'], { cwd: projectRoot, stdio: 'inherit', shell: true });
} else {
  console.error('[service-wrapper] No certificate in certs/ — running WITHOUT the HTTPS proxy. Generate one with: node scripts/generate-cert.js');
}

let exiting = false;
function shutdown(code) {
  if (exiting) return;
  exiting = true;
  app.kill();
  if (proxy) proxy.kill();
  process.exit(code == null ? 0 : code);
}

app.on('exit', code => shutdown(code));
if (proxy) proxy.on('exit', code => shutdown(code));
