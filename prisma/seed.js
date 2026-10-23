// First-run setup: one platform superuser, one taxi company, one ops login — each with a RANDOM password that is
// printed once, here. Accounts that already exist are left exactly as they are (re-running this never resets a
// password back to a default).
//   node prisma/seed.js   (also runs automatically after `npm run db:push`)
//
// Demo mode — for development/demos only:  SEED_DEMO=1 node prisma/seed.js
// additionally creates the publicly-documented logins (superadmin / ops / driver with fixed passwords, a demo
// driver bound to a vehicle, and a returning demo rider). tools/smoke-test.js expects that mode.
//
// Optional: SEED_COMPANY_NAME (default "Taxi Ardi") and SEED_OPS_NAME (default "Dispatcher").
'use strict';
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { encryptField, hashLookup } = require('../server/lib/crypto');

const prisma = new PrismaClient();
const DEMO = process.env.SEED_DEMO === '1';
const randomPassword = () => crypto.randomBytes(12).toString('base64url');

/** Creates the login if it doesn't exist; never touches an existing one. Returns { user, created, password }. */
async function ensureStaff({ role, companyId, name, username, demoPassword }) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return { user: existing, created: false, password: null };
  const password = DEMO ? demoPassword : randomPassword();
  const user = await prisma.user.create({ data: { role, companyId, name, username, passwordHash: await bcrypt.hash(password, 12) } });
  return { user, created: true, password };
}

async function main() {
  const superuser = await ensureStaff({ role: 'SUPERUSER', companyId: null, name: 'Platform Admin', username: 'superadmin', demoPassword: 'super-admin-pass' });

  // Reuse whatever company is already there (an older install may have one under a different name) instead of adding a second.
  let company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) {
    const name = process.env.SEED_COMPANY_NAME || (DEMO ? 'RideOps Prishtina' : 'Taxi Ardi');
    company = await prisma.company.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company', fleetSize: 14 } });
  }

  const ops = await ensureStaff({ role: 'OPS', companyId: company.id, name: DEMO ? 'Dana' : (process.env.SEED_OPS_NAME || 'Dispatcher'), username: 'ops', demoPassword: 'ops-demo-pass' });

  let driver = null;
  if (DEMO) {
    driver = await ensureStaff({ role: 'DRIVER', companyId: company.id, name: 'Ben Krasniqi', username: 'driver', demoPassword: 'driver-demo-pass' });
    await prisma.driverSlot.upsert({
      where: { companyId_slot: { companyId: company.id, slot: 6 } }, // slot 6 = the 7th roster entry, "Ben Krasniqi" in public/js/store.js
      update: { userId: driver.user.id },
      create: { companyId: company.id, slot: 6, userId: driver.user.id }
    });
    const clientPhone = '+38344111222', clientPhoneHash = hashLookup(clientPhone);
    await prisma.user.upsert({
      where: { phoneHash: clientPhoneHash }, update: {},
      create: { role: 'CLIENT', companyId: company.id, name: 'Arta Gashi', phone: encryptField(clientPhone), phoneHash: clientPhoneHash, favorites: JSON.stringify([{ name: 'Home', x: 300, y: 700 }, { name: 'Work', x: 900, y: 200 }]) }
    });
  }

  const line = (label, r) => console.log(`${label.padEnd(26)} ${r.user.username} / ${r.created ? r.password : '(already exists — password unchanged)'}`);
  console.log(`\nSeed complete${DEMO ? ' (DEMO mode — fixed, publicly documented passwords!)' : ''}.\n`);
  line('Superuser → /admin.html:', superuser);
  line('Ops room:', ops);
  if (driver) line('Demo driver (Ben Krasniqi):', driver);
  if ([superuser, ops].some(r => r.created) && !DEMO) console.log('\nWrite these passwords down NOW — they are shown only this once and are not stored anywhere readable.\nChange one later with:  npm run user:set-password -- <username>');
  if (DEMO) console.log('\nChange these before this goes anywhere but a private demo.');
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
