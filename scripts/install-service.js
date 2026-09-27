// Registers RideOps as a real Windows Service (visible in services.msc), so
// it starts at boot and restarts itself on crash without anyone logging in
// first. Run once, from an elevated PowerShell/cmd window:
//   node scripts/install-service.js
'use strict';
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({ name: 'RideOps', description: 'RideOps taxi dispatch service', script: path.join(__dirname, 'service-wrapper.js') });

svc.on('install', () => { console.log('RideOps service installed. Starting it now...'); svc.start(); });
svc.on('start', () => console.log('RideOps service started. Check services.msc — it should show as "RideOps", Running.'));
svc.on('alreadyinstalled', () => console.log('RideOps service is already installed. Use uninstall-service.js first if you need to reinstall it.'));
svc.on('error', err => console.error('Service install failed:', err));

svc.install();
