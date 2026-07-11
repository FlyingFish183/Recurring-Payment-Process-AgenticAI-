import { createHash } from "node:crypto";
import path from "node:path";

/** Strip paths and unsafe characters; keep a short extension. */
export function sanitizeFilename(original: string): string {
  const base = path.basename(original).replace(/[\x00-\x1f\x7f]/g, "");
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  const safe = cleaned.slice(0, 120) || "document";
  return safe;
}

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function detectFileFormat(
  filename: string,
  mimeType: string,
): "XML" | "PDF" | "IMAGE" | "OTHER" {
  const lower = filename.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (lower.endsWith(".xml") || mime.includes("xml")) return "XML";
  if (lower.endsWith(".pdf") || mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lower)) {
    return "IMAGE";
  }
  return "OTHER";
}

/** Match bucket folders: XML e-invoices → XML/ · PDF/images → pdf/ */
export function s3FolderForFormat(format: "XML" | "PDF" | "IMAGE" | "OTHER"): string {
  if (format === "XML") return "XML";
  return "pdf";
}
