import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const sender = await prisma.sender.upsert({
    where: { fromEmail: "test-sender@outbox.dev" },
    update: {},
    create: {
      name: "Test Sender",
      fromEmail: "test-sender@outbox.dev",
      maxPerHour: 10, // small cap so you can trigger rate-limiting easily in the demo
    },
  });
  console.log("Seeded sender:", sender);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
