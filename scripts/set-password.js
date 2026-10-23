// Sets (or resets) the password of any staff login — superadmin, an ops login or a driver — from the machine
// the app runs on. This is the only way to change the superadmin password (the admin page manages ops/driver
// logins, not the platform admin itself).
//   node scripts/set-password.js <username>                 -> generates a strong password and prints it once
//   node scripts/set-password.js <username> <new-password>  -> uses the one you give (min. 10 characters)
// Prefer the first form: a password typed on the command line ends up in the shell history.
// Also signs that user out everywhere, so a leaked old password / stolen session stops working immediately.
'use strict';
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const username = String(process.argv[2] || '').trim().toLowerCase();
  if (!username) { console.error('Usage: node scripts/set-password.js <username> [new-password]'); process.exitCode = 1; return; }
  const generated = !process.argv[3];
  const password = process.argv[3] || crypto.randomBytes(12).toString('base64url');
  if (password.length < 10) { console.error('Password must be at least 10 characters.'); process.exitCode = 1; return; }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.passwordHash) { console.error(`No staff login named "${username}" (riders have no password — they sign in by text message).`); process.exitCode = 1; return; }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12) } });
    const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });
    console.log(`\nPassword updated for "${username}" (${user.role}). ${count} existing session(s) signed out.`);
    if (generated) console.log(`New password: ${password}\n\nWrite it down now — it is not stored anywhere readable. Restart the service to clear the default-password warning.\n`);
  } finally { await prisma.$disconnect(); }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
