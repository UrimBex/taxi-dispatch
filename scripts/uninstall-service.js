// Removes the RideOps Windows Service (e.g. before reinstalling it, or to
// go back to running it by hand). Run once, from an elevated
// PowerShell/cmd window:
//   node scripts/uninstall-service.js
'use strict';
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({ name: 'RideOps', script: path.join(__dirname, 'service-wrapper.js') });

svc.on('uninstall', () => console.log('RideOps service uninstalled.'));
svc.on('error', err => console.error('Service uninstall failed:', err));

svc.uninstall();
