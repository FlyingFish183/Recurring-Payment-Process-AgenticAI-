import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";

function encryptionKey(): Buffer {
  const keyHex =
    env.BANK_ACCOUNT_ENCRYPTION_KEY ??
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  return Buffer.from(keyHex.slice(0, 64), "hex");
}

export function hashAccountNumber(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export function encryptAccountNumber(plain: string): { enc: string; hash: string } {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: Buffer.concat([iv, tag, encrypted]).toString("base64"),
    hash: hashAccountNumber(plain),
  };
}

/** Decrypt stored account number for FA / CA / Cashier payment use. */
export function decryptAccountNumber(encB64: string): string | null {
  try {
    const buf = Buffer.from(encB64, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
