import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import {
  KMSClient,
  SignCommand,
  VerifyCommand,
} from "@aws-sdk/client-kms";
import { env } from "../config/env";

const PREFIX = "dsig.v1.";

export type SignaturePayload = {
  requestId: string;
  requestNumber: string;
  stepId: string;
  sequenceNumber: number;
  roleRequired: string;
  action: string;
  actorId: string;
  actorEmail: string;
  actorDisplayName: string;
  totalAmount: string;
  currency: string;
  paymentPeriod: string;
  storeId: string;
  signedAt: string;
};

export type SignatureRecord = {
  version: 1;
  algorithm: "HMAC-SHA256" | "KMS-RSASSA-PSS-SHA-256";
  keyId: string;
  payload: SignaturePayload;
  /** Base64 signature bytes */
  signature: string;
  /** SHA-256 hex of canonical payload (integrity fingerprint) */
  contentHash: string;
};

function signingSecret(): string {
  return env.SIGNING_SECRET || env.JWT_SECRET;
}

/** Stable JSON for signing — sorted keys, no whitespace variance. */
export function canonicalPayloadJson(payload: SignaturePayload): string {
  const ordered: SignaturePayload = {
    requestId: payload.requestId,
    requestNumber: payload.requestNumber,
    stepId: payload.stepId,
    sequenceNumber: payload.sequenceNumber,
    roleRequired: payload.roleRequired,
    action: payload.action,
    actorId: payload.actorId,
    actorEmail: payload.actorEmail,
    actorDisplayName: payload.actorDisplayName,
    totalAmount: payload.totalAmount,
    currency: payload.currency,
    paymentPeriod: payload.paymentPeriod,
    storeId: payload.storeId,
    signedAt: payload.signedAt,
  };
  return JSON.stringify(ordered);
}

export function contentHash(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function encodeRecord(record: SignatureRecord): string {
  return PREFIX + Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
}

export function decodeSignatureRecord(stored: string | null | undefined): SignatureRecord | null {
  if (!stored?.startsWith(PREFIX)) return null;
  try {
    const json = Buffer.from(stored.slice(PREFIX.length), "base64url").toString("utf8");
    const parsed = JSON.parse(json) as SignatureRecord;
    if (parsed?.version !== 1 || !parsed.signature || !parsed.payload) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function signWithHmac(canonical: string): Promise<{ signature: string; keyId: string; algorithm: SignatureRecord["algorithm"] }> {
  const keyId = "local/hmac-sha256";
  const signature = createHmac("sha256", signingSecret())
    .update(canonical, "utf8")
    .digest("base64");
  return { signature, keyId, algorithm: "HMAC-SHA256" };
}

async function verifyWithHmac(canonical: string, signatureB64: string): Promise<boolean> {
  const expected = createHmac("sha256", signingSecret())
    .update(canonical, "utf8")
    .digest();
  const actual = Buffer.from(signatureB64, "base64");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

async function signWithKms(canonical: string): Promise<{ signature: string; keyId: string; algorithm: SignatureRecord["algorithm"] }> {
  const keyId = env.SIGNING_KMS_KEY_ID!;
  const kms = new KMSClient({ region: env.AWS_REGION });
  const out = await kms.send(
    new SignCommand({
      KeyId: keyId,
      Message: Buffer.from(canonical, "utf8"),
      MessageType: "RAW",
      SigningAlgorithm: "RSASSA_PSS_SHA_256",
    }),
  );
  if (!out.Signature) throw new Error("KMS Sign returned empty signature");
  return {
    signature: Buffer.from(out.Signature).toString("base64"),
    keyId,
    algorithm: "KMS-RSASSA-PSS-SHA-256",
  };
}

async function verifyWithKms(canonical: string, signatureB64: string, keyId: string): Promise<boolean> {
  const kms = new KMSClient({ region: env.AWS_REGION });
  const out = await kms.send(
    new VerifyCommand({
      KeyId: keyId,
      Message: Buffer.from(canonical, "utf8"),
      MessageType: "RAW",
      Signature: Buffer.from(signatureB64, "base64"),
      SigningAlgorithm: "RSASSA_PSS_SHA_256",
    }),
  );
  return Boolean(out.SignatureValid);
}

/**
 * Create a digital signature over the approval action.
 * Uses AWS KMS when SIGNING_KMS_KEY_ID is set; otherwise HMAC-SHA256 (demo).
 */
export async function createDigitalSignature(payload: SignaturePayload): Promise<{
  stored: string;
  record: SignatureRecord;
}> {
  const canonical = canonicalPayloadJson(payload);
  const hash = contentHash(canonical);

  const signed = env.SIGNING_KMS_KEY_ID
    ? await signWithKms(canonical)
    : await signWithHmac(canonical);

  const record: SignatureRecord = {
    version: 1,
    algorithm: signed.algorithm,
    keyId: signed.keyId,
    payload,
    signature: signed.signature,
    contentHash: hash,
  };

  return { stored: encodeRecord(record), record };
}

export async function verifyDigitalSignature(stored: string): Promise<{
  valid: boolean;
  record: SignatureRecord | null;
  reason?: string;
}> {
  const record = decodeSignatureRecord(stored);
  if (!record) {
    return { valid: false, record: null, reason: "Not a digital signature (legacy or missing)" };
  }

  const canonical = canonicalPayloadJson(record.payload);
  if (contentHash(canonical) !== record.contentHash) {
    return { valid: false, record, reason: "Payload content hash mismatch" };
  }

  try {
    const ok =
      record.algorithm === "KMS-RSASSA-PSS-SHA-256"
        ? await verifyWithKms(canonical, record.signature, record.keyId)
        : await verifyWithHmac(canonical, record.signature);

    return {
      valid: ok,
      record,
      reason: ok ? undefined : "Cryptographic verification failed",
    };
  } catch (err) {
    return {
      valid: false,
      record,
      reason: err instanceof Error ? err.message : "Verify error",
    };
  }
}

/** Roles that must digitally sign when approving. */
export const SIGNING_REQUIRED_ROLES = new Set<string>(["CA", "CASHIER"]);
