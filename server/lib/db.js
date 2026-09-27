'use strict';
const { PrismaClient } = require('@prisma/client');

const g = globalThis;
const prisma = g.__rideopsPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.__rideopsPrisma = prisma;

module.exports = { prisma };
