import bcrypt from "bcryptjs";
// Imported for its side effect of loading .env before PrismaClient reads
// DATABASE_URL; the client instance itself is created below.
import { PrismaClient } from "@nexaflow/db";

// Minimal seed: one workspace, one admin, one wallet, one location.
// Enough to log in and exercise the GMB API end to end.

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.SEED_EMAIL ?? "admin@adgrowly.local";
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "Demo@1234";
const SUPER_EMAIL = process.env.SEED_SUPER_EMAIL ?? "super@adgrowly.local";
const SUPER_PASSWORD = process.env.SEED_SUPER_PASSWORD ?? "Super@1234";

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "Demo Business",
      slug: "demo",
      industry: "hair_salon",
      timezone: "Asia/Kolkata",
    },
  });
  console.log(`✓ tenant ${tenant.name} (${tenant.id})`);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      tenantId: tenant.id,
      email: DEMO_EMAIL,
      name: "Demo Admin",
      // Cost 10 matches the login path's bcrypt.compare expectations.
      password: await bcrypt.hash(DEMO_PASSWORD, 10),
      role: "BUSINESS_ADMIN",
    },
  });
  console.log(`✓ user ${user.email}`);

  // The platform operator. Auth requires every user to belong to a tenant, so
  // the super admin gets its own "platform" workspace — it holds no GMB data
  // and exists only to satisfy that invariant.
  const platformTenant = await prisma.tenant.upsert({
    where: { slug: "platform" },
    update: {},
    create: { name: "Adgrowly Platform", slug: "platform" },
  });
  const superUser = await prisma.user.upsert({
    where: { email: SUPER_EMAIL },
    update: {},
    create: {
      tenantId: platformTenant.id,
      email: SUPER_EMAIL,
      name: "Platform Admin",
      password: await bcrypt.hash(SUPER_PASSWORD, 10),
      role: "SUPER_ADMIN",
    },
  });
  console.log(`✓ super admin ${superUser.email}`);

  const existingWallet = await prisma.wallet.findFirst({ where: { tenantId: tenant.id } });
  if (!existingWallet) {
    await prisma.wallet.create({
      data: { tenantId: tenant.id, balanceCredits: 1000 },
    });
    console.log("✓ wallet seeded with 1000 credits");
  }

  const existingLocation = await prisma.gmbLocation.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!existingLocation) {
    const loc = await prisma.gmbLocation.create({
      data: {
        tenantId: tenant.id,
        name: "Demo Salon — MG Road",
        primaryCategory: "Hair Salon",
        addressLine: "12 MG Road",
        city: "Pune",
        region: "MH",
        postalCode: "411001",
        phone: "+919000000000",
      },
    });
    console.log(`✓ location ${loc.name}`);
  }

  console.log(`\nLog in with: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
