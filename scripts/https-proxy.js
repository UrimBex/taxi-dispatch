// A minimal TLS-terminating reverse proxy in front of the app server. The
// app itself only ever listens on 127.0.0.1 (see service-wrapper.js) —
// this is the only thing actually reachable from the LAN, and it's HTTPS.
// Hand-written against Node's own http/https modules rather than a proxy
// library: the traffic shape here is simple — plain request/response, plus
// the one WebSocket upgrade that carries the live dispatch feed — and both
// are a few lines of .pipe()/socket forwarding.
'use strict';
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const certDir = path.join(projectRoot, 'certs');

function loadEnv() {
  const envPath = path.join(projectRoot, '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
      if (m) env[m[1]] = m[2];
    }
  }
  return env;
}

const env = loadEnv();
const HTTPS_PORT = Number(env.HTTPS_PORT || 443);
const TARGET_PORT = Number(env.INTERNAL_PORT || 3000);

const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('No certificate found in certs/. Generate one first:');
  console.error('  node scripts/generate-cert.js');
  process.exit(1);
}

const tlsOptions = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };

// Forwarded with the original Host header intact, plus x-forwarded-proto
// so the app knows the original connection was HTTPS even though this hop
// (proxy to app) is plain HTTP — needed for Secure-cookie handling to
// come out right on the app side.
function forwardedHeaders(clientReq) {
  return Object.assign({}, clientReq.headers, { 'x-forwarded-proto': 'https', 'x-forwarded-host': clientReq.headers.host });
}

function proxyRequest(clientReq, clientRes) {
  const proxyReq = http.request(
    { hostname: '127.0.0.1', port: TARGET_PORT, path: clientReq.url, method: clientReq.method, headers: forwardedHeaders(clientReq) },
    proxyRes => { clientRes.writeHead(proxyRes.statusCode, proxyRes.headers); proxyRes.pipe(clientRes); }
  );
  proxyReq.on('error', err => {
    console.error('[https-proxy] upstream error:', err.message);
    if (!clientRes.headersSent) clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
    clientRes.end("Bad gateway — the app isn't responding.");
  });
  clientReq.on('error', () => proxyReq.destroy());
  clientReq.pipe(proxyReq);
}

// The live dispatch feed rides a WebSocket (/ws) — a plain request/response
// proxy can't carry that, so upgrades get their own raw socket-to-socket
// forward instead.
function proxyUpgrade(clientReq, clientSocket, head) {
  const proxyReq = http.request({ hostname: '127.0.0.1', port: TARGET_PORT, path: clientReq.url, method: clientReq.method, headers: forwardedHeaders(clientReq) });
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    clientSocket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n'
    );
    if (proxyHead && proxyHead.length) proxySocket.unshift(proxyHead);
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
  });
  proxyReq.on('error', err => { console.error('[https-proxy] upstream upgrade error:', err.message); clientSocket.destroy(); });
  clientSocket.on('error', () => proxyReq.destroy());
  if (head && head.length) proxyReq.write(head);
  proxyReq.end();
}

function startServer(port) {
  const server = https.createServer(tlsOptions, proxyRequest);
  server.on('upgrade', proxyUpgrade);
  server.on('error', err => {
    if ((err.code === 'EACCES' || err.code === 'EADDRINUSE') && port === 443) {
      console.error(`[https-proxy] could not bind port 443 (${err.code}) — falling back to 8443`);
      startServer(8443);
      return;
    }
    console.error('[https-proxy] fatal:', err);
    process.exit(1);
  });
  server.keepAliveTimeout = 6 * 60 * 60 * 1000; // the WebSocket connection is long-lived; don't let keep-alive cut it
  server.listen(port, () => console.log(`[https-proxy] listening on https://0.0.0.0:${port}, forwarding to http://127.0.0.1:${TARGET_PORT}`));
}

startServer(HTTPS_PORT);
