import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { env } from "../config/env";
import { getIamDbPassword } from "./rdsIam";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

function createPrismaClient(): PrismaClient {
  const pool =
    globalForPrisma.pgPool ??
    new Pool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      database: env.DB_NAME,
      password: getIamDbPassword,
      ssl: { rejectUnauthorized: false },
      // Warm pool: fewer cold IAM + TCP handshakes under concurrent UI loads
      max: 10,
      min: 2,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 15_000,
      allowExitOnIdle: false,
    });

  if (env.NODE_ENV !== "production") {
    globalForPrisma.pgPool = pool;
  }

  return new PrismaClient({
    adapter: new PrismaPg(pool),
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function hasStoreAssignment(client: PrismaClient | undefined): boolean {
  return Boolean(client && (client as { storeAssignment?: unknown }).storeAssignment);
}

/** Recreate after schema generate — hot reload keeps a stale singleton. */
function getClient(): PrismaClient {
  if (hasStoreAssignment(globalForPrisma.prisma)) {
    return globalForPrisma.prisma!;
  }
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  }
  const client = createPrismaClient();
  if (env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

export const prisma = getClient();

/** Best-effort warm connections so the first UI click is not a cold IAM handshake. */
export async function warmDbPool(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.warn("[db] warm failed", err instanceof Error ? err.message : err);
  }
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
  if (globalForPrisma.pgPool) {
    await globalForPrisma.pgPool.end();
    globalForPrisma.pgPool = undefined;
  }
  globalForPrisma.prisma = undefined;
}
