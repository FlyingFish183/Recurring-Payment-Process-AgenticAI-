import { Signer } from "@aws-sdk/rds-signer";
import { env } from "../config/env";

/** Short-lived Aurora password from your AWS IAM credentials (~15 min). */
export async function getIamDbPassword(): Promise<string> {
  const signer = new Signer({
    hostname: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    region: env.AWS_REGION,
  });
  return signer.getAuthToken();
}

export async function buildIamDatabaseUrl(): Promise<string> {
  const token = encodeURIComponent(await getIamDbPassword());
  const user = encodeURIComponent(env.DB_USER);
  // no-verify: encrypt traffic; skip CA path issues for hackathon / Prisma CLI
  return `postgresql://${user}:${token}@${env.DB_HOST}:${env.DB_PORT}/${encodeURIComponent(env.DB_NAME)}?sslmode=no-verify&schema=public`;
}
