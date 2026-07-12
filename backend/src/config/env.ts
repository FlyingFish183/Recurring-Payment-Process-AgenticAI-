import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(8).default("dev-only-change-me"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  /** HMAC signing secret for digital signatures (falls back to JWT_SECRET). */
  SIGNING_SECRET: z.string().min(8).optional(),
  /** Optional AWS KMS key id/ARN for RSASSA-PSS signatures (CA / Cashier). */
  SIGNING_KMS_KEY_ID: z.string().min(1).optional(),
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

  // SQS FIFO — extract / rule-validate worker
  SQS_EXTRACT_QUEUE_URL: z
    .string()
    .url()
    .default("https://sqs.us-east-1.amazonaws.com/293221314416/extract-worker.fifo"),

  /** OpenAI — CA/Cashier analytics chat (text-to-SQL). */
  OPENAI_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
