import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";

const s3 = new S3Client({ region: env.AWS_REGION });

/** Presigned GET TTL — long enough for a detail-page session */
const VIEW_URL_EXPIRES_SECONDS = 60 * 60; // 1 hour

export type UploadObjectInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

export async function uploadToS3(input: UploadObjectInput): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
  return `s3://${env.S3_BUCKET}/${input.key}`;
}

export function buildObjectKey(folder: string, requestId: string, safeName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${folder}/${requestId}/${stamp}-${safeName}`;
}

/** Parse `s3://bucket/key` into bucket + key. */
export function parseS3Uri(storageUri: string): { bucket: string; key: string } | null {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(storageUri);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
}

/**
 * Temporary HTTPS URL for browser display/download.
 * Bucket keeps Block Public Access on; no public ACL needed.
 */
export async function getPresignedViewUrl(storageUri: string): Promise<string | null> {
  const parsed = parseS3Uri(storageUri);
  if (!parsed) return null;

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key,
      ResponseContentDisposition: "inline",
    }),
    { expiresIn: VIEW_URL_EXPIRES_SECONDS },
  );
}

/** Download object bytes from `s3://bucket/key`. */
export async function downloadFromS3(storageUri: string): Promise<Buffer> {
  const parsed = parseS3Uri(storageUri);
  if (!parsed) {
    throw new Error(`Invalid S3 URI: ${storageUri}`);
  }

  const res = await s3.send(
    new GetObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key,
    }),
  );

  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Empty S3 object: ${storageUri}`);
  return Buffer.from(bytes);
}
