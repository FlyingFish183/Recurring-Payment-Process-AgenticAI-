import {
  DetectDocumentTextCommand,
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
  type Block,
} from "@aws-sdk/client-textract";
import { env } from "../config/env";
import { parseS3Uri } from "./s3";

const textract = new TextractClient({ region: env.AWS_REGION });

const ASYNC_POLL_MS = 2000;
const ASYNC_MAX_ATTEMPTS = 90; // ~3 minutes

export type TextractPageLine = {
  page: number;
  text: string;
  confidence: number | null;
};

export type TextractResult = {
  engine: "textract";
  extractionMethod: "DETECT_DOCUMENT_TEXT" | "START_DOCUMENT_TEXT_DETECTION";
  rawText: string;
  pageData: {
    pages: Array<{ page: number; lines: string[] }>;
    lineCount: number;
    wordCount: number;
  };
  structuredFields: {
    lines: string[];
    wordCount: number;
    lineCount: number;
  };
  confidenceOverall: number | null;
};

function blocksToResult(
  blocks: Block[],
  extractionMethod: TextractResult["extractionMethod"],
): TextractResult {
  const lineBlocks = blocks.filter((b) => b.BlockType === "LINE" && b.Text);
  const wordBlocks = blocks.filter((b) => b.BlockType === "WORD");

  const pageMap = new Map<number, string[]>();
  const confidences: number[] = [];

  for (const block of lineBlocks) {
    const page = block.Page ?? 1;
    const text = block.Text ?? "";
    const list = pageMap.get(page) ?? [];
    list.push(text);
    pageMap.set(page, list);
    if (typeof block.Confidence === "number") confidences.push(block.Confidence);
  }

  const pages = [...pageMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, lines]) => ({ page, lines }));

  const allLines = pages.flatMap((p) => p.lines);
  const rawText = allLines.join("\n");
  const confidenceOverall =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;

  return {
    engine: "textract",
    extractionMethod,
    rawText,
    pageData: {
      pages,
      lineCount: allLines.length,
      wordCount: wordBlocks.length,
    },
    structuredFields: {
      lines: allLines,
      lineCount: allLines.length,
      wordCount: wordBlocks.length,
    },
    confidenceOverall,
  };
}

async function detectTextSync(bucket: string, key: string): Promise<TextractResult> {
  const res = await textract.send(
    new DetectDocumentTextCommand({
      Document: {
        S3Object: { Bucket: bucket, Name: key },
      },
    }),
  );
  return blocksToResult(res.Blocks ?? [], "DETECT_DOCUMENT_TEXT");
}

async function detectTextAsync(bucket: string, key: string): Promise<TextractResult> {
  const started = await textract.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: {
        S3Object: { Bucket: bucket, Name: key },
      },
    }),
  );

  const jobId = started.JobId;
  if (!jobId) throw new Error("Textract did not return a JobId");

  const allBlocks: Block[] = [];
  let nextToken: string | undefined;

  for (let attempt = 0; attempt < ASYNC_MAX_ATTEMPTS; attempt++) {
    const statusRes = await textract.send(
      new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken,
        MaxResults: 1000,
      }),
    );

    const status = statusRes.JobStatus;
    if (status === "FAILED") {
      throw new Error(statusRes.StatusMessage ?? "Textract async job failed");
    }

    if (status === "SUCCEEDED" || status === "PARTIAL_SUCCESS") {
      allBlocks.push(...(statusRes.Blocks ?? []));
      nextToken = statusRes.NextToken;
      // Drain remaining pages of results
      while (nextToken) {
        const more = await textract.send(
          new GetDocumentTextDetectionCommand({
            JobId: jobId,
            NextToken: nextToken,
            MaxResults: 1000,
          }),
        );
        allBlocks.push(...(more.Blocks ?? []));
        nextToken = more.NextToken;
      }
      return blocksToResult(allBlocks, "START_DOCUMENT_TEXT_DETECTION");
    }

    await new Promise((r) => setTimeout(r, ASYNC_POLL_MS));
  }

  throw new Error(`Textract job ${jobId} timed out`);
}

/**
 * Run Textract against an S3 object.
 * Images use sync DetectDocumentText; PDFs use async StartDocumentTextDetection.
 */
export async function extractTextWithTextract(
  storageUri: string,
  fileFormat: "PDF" | "IMAGE" | string,
): Promise<TextractResult> {
  const parsed = parseS3Uri(storageUri);
  if (!parsed) throw new Error(`Invalid S3 URI: ${storageUri}`);

  if (fileFormat === "PDF") {
    return detectTextAsync(parsed.bucket, parsed.key);
  }

  // PNG / JPEG (and most image uploads)
  return detectTextSync(parsed.bucket, parsed.key);
}
