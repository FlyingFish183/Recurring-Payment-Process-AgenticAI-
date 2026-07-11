"use client";

import type { Document } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

type Props = {
  documents: Document[];
};

export function DocumentList({ documents }: Props) {
  if (documents.length === 0) {
    return (
      <div className="rounded border border-dashed border-line bg-surface px-4 py-8 text-center text-muted">
        No documents yet. Upload an XML e-invoice or PDF/image invoice.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-line bg-surface">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-line bg-paper-2 text-xs tracking-wide text-muted uppercase">
          <tr>
            <th className="px-3 py-2 font-semibold">File</th>
            <th className="px-3 py-2 font-semibold">Format</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">S3 URI</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-b border-line/70 last:border-0">
              <td className="px-3 py-2.5 font-medium">{doc.fileName}</td>
              <td className="px-3 py-2.5">{doc.fileFormat}</td>
              <td className="px-3 py-2.5">
                {doc.documentType.replaceAll("_", " ")}
              </td>
              <td className="px-3 py-2.5">
                <StatusBadge status={doc.processingStatus} />
              </td>
              <td className="max-w-xs truncate px-3 py-2.5 font-mono text-xs text-muted" title={doc.storageUri}>
                {doc.storageUri}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
