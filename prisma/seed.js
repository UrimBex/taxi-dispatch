// Seeds a runnable demo: one platform superuser, one taxi company with an
// ops login and a driver login (bound to the existing demo driver, Ben
// Krasniqi), and one returning rider — the same accounts the earlier
// browser-only prototype had, now backed by the real database.
//   node prisma/seed.js   (also runs automatically after `npm run db:push`)
'use strict';
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { encryptField, hashLookup } = require('../server/lib/crypto');

const prisma = new PrismaClient();

async function upsertStaff({ role, companyId, name, username, password }) {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.upsert({
    where: { username },
    update: { name, passwordHash, role, companyId },
    create: { role, companyId, name, username, passwordHash }
  });
}

async function main() {
  const superuser = await upsertStaff({ role: 'SUPERUSER', companyId: null, name: 'Platform Admin', username: 'superadmin', password: 'super-admin-pass' });

  const company = await prisma.company.upsert({
    where: { slug: 'rideops-prishtina' },
    update: {},
    create: { name: 'RideOps Prishtina', slug: 'rideops-prishtina', fleetSize: 14 }
  });

  const ops = await upsertStaff({ role: 'OPS', companyId: company.id, name: 'Dana', username: 'ops', password: 'ops-demo-pass' });

  const driver = await upsertStaff({ role: 'DRIVER', companyId: company.id, name: 'Ben Krasniqi', username: 'driver', password: 'driver-demo-pass' });
  await prisma.driverSlot.upsert({
    where: { companyId_slot: { companyId: company.id, slot: 6 } }, // slot 6 = the 7th roster entry, "Ben Krasniqi" in server/../public/js/store.js
    update: { userId: driver.id },
    create: { companyId: company.id, slot: 6, userId: driver.id }
  });

  const clientPhone = '+38344111222';
  const clientPhoneHash = hashLookup(clientPhone);
  await prisma.user.upsert({
    where: { phoneHash: clientPhoneHash },
    update: {},
    create: {
      role: 'CLIENT', companyId: company.id, name: 'Arta Gashi', phone: encryptField(clientPhone), phoneHash: clientPhoneHash,
      favorites: JSON.stringify([{ name: 'Home', x: 300, y: 700 }, { name: 'Work', x: 900, y: 200 }])
    }
  });

  console.log('\nSeed complete.\n');
  console.log('Superuser (platform admin):', superuser.username, '/', 'super-admin-pass', '→ /admin.html');
  console.log('Ops room:                 ', ops.username, '/', 'ops-demo-pass');
  console.log('Driver (Ben Krasniqi):    ', driver.username, '/', 'driver-demo-pass');
  console.log('Client (returning rider): ', clientPhone, '(phone + text-message code — check the server console for the code)');
  console.log('\nChange these before this goes anywhere but a private demo.');
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
