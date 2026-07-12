import { Signer } from "@aws-sdk/rds-signer";
import { env } from "../config/env";

/** IAM auth tokens last ~15m; refresh early to avoid mid-request expiry. */
const TOKEN_TTL_MS = 10 * 60 * 1000;

let cachedToken: string | null = null;
let cachedAt = 0;
let inflight: Promise<string> | null = null;

async function fetchIamToken(): Promise<string> {
  const signer = new Signer({
    hostname: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    region: env.AWS_REGION,
  });
  return signer.getAuthToken();
}

/** Short-lived Aurora password from AWS IAM — cached across pool checkouts. */
export async function getIamDbPassword(): Promise<string> {
  const age = Date.now() - cachedAt;
  if (cachedToken && age < TOKEN_TTL_MS) {
    return cachedToken;
  }

  if (!inflight) {
    inflight = fetchIamToken()
      .then((token) => {
        cachedToken = token;
        cachedAt = Date.now();
        return token;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}

export async function buildIamDatabaseUrl(): Promise<string> {
  const token = encodeURIComponent(await getIamDbPassword());
  const user = encodeURIComponent(env.DB_USER);
  return `postgresql://${user}:${token}@${env.DB_HOST}:${env.DB_PORT}/${encodeURIComponent(env.DB_NAME)}?sslmode=no-verify&schema=public`;
}
