// Generates a self-signed TLS certificate for the HTTPS reverse proxy
// (scripts/https-proxy.js). Run once per install, or again if the host's
// LAN address changes:
//   node scripts/generate-cert.js [ip-or-hostname]
// With no argument, it reads the host from APP_URL in .env.
'use strict';
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const projectRoot = path.join(__dirname, '..');
const certDir = path.join(projectRoot, 'certs');

function loadAppUrlHost() {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return null;
  const text = fs.readFileSync(envPath, 'utf8');
  const match = text.match(/^APP_URL\s*=\s*"?https?:\/\/([^:"/]+)/m);
  return match ? match[1] : null;
}

async function main() {
  const host = process.argv[2] || loadAppUrlHost();
  if (!host) {
    console.error('Usage: node scripts/generate-cert.js <lan-ip-or-hostname>');
    console.error('(or set APP_URL in .env first, e.g. https://192.168.1.22)');
    process.exitCode = 1;
    return;
  }

  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }];
  altNames.push(isIp ? { type: 7, ip: host } : { type: 2, value: host });

  const notBefore = new Date();
  const notAfter = new Date(notBefore);
  notAfter.setFullYear(notAfter.getFullYear() + 10);

  const pems = await selfsigned.generate([{ name: 'commonName', value: host }], {
    keySize: 2048, algorithm: 'sha256', notBeforeDate: notBefore, notAfterDate: notAfter,
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: 'subjectAltName', altNames }
    ]
  });

  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(path.join(certDir, 'key.pem'), pems.private);
  fs.writeFileSync(path.join(certDir, 'cert.pem'), pems.cert);
  // Same certificate, saved under a name meant for distributing to devices
  // and installing into their trusted root store (see the README) — that's
  // what makes the browser warning go away.
  fs.writeFileSync(path.join(certDir, 'ca.crt'), pems.cert);

  console.log('Generated a self-signed certificate for:', host);
  console.log('  certs/cert.pem  (certificate, used by the proxy)');
  console.log('  certs/key.pem   (private key — keep this secret, never share it)');
  console.log('  certs/ca.crt    (same certificate, for installing as trusted on other devices)');
  console.log('\nValid 10 years. Covers:', altNames.map(a => a.value || a.ip).join(', '));
}

main().catch(err => { console.error('Certificate generation failed:', err); process.exitCode = 1; });
