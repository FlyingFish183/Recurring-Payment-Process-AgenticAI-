/**
 * Prints a short-lived DATABASE_URL for Prisma CLI.
 *
 *   eval "$(npx tsx scripts/print-iam-database-url.ts)"
 *   npx prisma migrate dev --name init
 */
import "dotenv/config";
import { buildIamDatabaseUrl } from "../src/lib/rdsIam";

async function main() {
  const url = await buildIamDatabaseUrl();
  process.stdout.write(`export DATABASE_URL='${url}'\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
