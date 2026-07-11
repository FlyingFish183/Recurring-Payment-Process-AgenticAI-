import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(8).default("dev-only-change-me"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  BANK_ACCOUNT_ENCRYPTION_KEY: z.string().length(64).optional(),

  // Aurora IAM auth
  AWS_REGION: z.string().default("us-east-1"),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USER: z.string().min(1),
  DB_NAME: z.string().min(1),
  DATABASE_URL: z.string().default("postgresql://localhost:5432/postgres"),

  // S3 document storage (Phase 2)
  S3_BUCKET: z.string().min(1).default("kfc-document-pdf"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
