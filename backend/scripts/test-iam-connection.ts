/**
 * Quick Aurora IAM connectivity check.
 *   npx tsx scripts/test-iam-connection.ts
 */
import "dotenv/config";
import { Client } from "pg";
import { Signer } from "@aws-sdk/rds-signer";

async function main() {
  const host = process.env.DB_HOST!;
  const port = Number(process.env.DB_PORT ?? 5432);
  const user = process.env.DB_USER!;
  const database = process.env.DB_NAME!;
  const region = process.env.AWS_REGION ?? "us-east-1";

  const password = await new Signer({
    hostname: host,
    port,
    username: user,
    region,
  }).getAuthToken();

  console.log(`Connecting ${user}@${host}/${database} via IAM…`);

  const client = new Client({
    host,
    port,
    user,
    database,
    password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const { rows } = await client.query("SELECT now() AS now, current_user, current_database()");
  console.log("OK:", rows[0]);
  await client.end();
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
