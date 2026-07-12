/**
 * Poll extract-worker.fifo → Textract/XML → rule validate → READY.
 *
 *   npm run worker:extract
 */
import "dotenv/config";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";
import { extractDocumentsForRequest } from "../src/services/extraction";
import { fillLinesFromExtractions } from "../src/services/fillFromExtraction";
import { submitForApproval } from "../src/services/approval";
import type { ExtractQueueMessage } from "../src/services/sqs";
import { analyzePaymentRequest } from "../src/services/validation";

const sqs = new SQSClient({ region: env.AWS_REGION });
const WAIT_SECONDS = 20;
const MAX_MESSAGES = 1;
/** Textract async — keep message invisible long enough. */
const VISIBILITY_TIMEOUT = 300;

async function processMessage(body: ExtractQueueMessage, receiptHandle: string) {
  console.log(`[worker] claimed ${body.requestNumber} (${body.requestId})`);

  const request = await prisma.paymentRequest.findUnique({
    where: { id: body.requestId },
    include: { documents: true, lines: true },
  });

  if (!request) {
    console.warn(`[worker] request missing — deleting message`);
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: env.SQS_EXTRACT_QUEUE_URL,
        ReceiptHandle: receiptHandle,
      }),
    );
    return;
  }

  await prisma.paymentRequest.update({
    where: { id: request.id },
    data: { status: "EXTRACTING" },
  });

  const summary = await extractDocumentsForRequest(request.id);
  console.log(
    `[worker] extract ${body.requestNumber}: ${summary.okCount}/${summary.total}` +
      (summary.failCount ? ` (${summary.failCount} failed)` : ""),
  );

  const filled = await fillLinesFromExtractions(request.id);
  console.log(`[worker] filled ${filled} line(s) from OCR text`);

  const validation = await analyzePaymentRequest(request.id);

  // Auto-route to HOD only when nothing is BLOCKING (e.g. duplicate invoice)
  const refreshed = await prisma.paymentRequest.findUniqueOrThrow({
    where: { id: request.id },
    select: { status: true, requesterId: true },
  });
  if (refreshed.status === "READY" && !validation.blocked) {
    await submitForApproval({
      requestId: request.id,
      requesterId: refreshed.requesterId,
      comments: "Auto-submitted after extract",
    });
    console.log(`[worker] routed ${body.requestNumber} → IN_REVIEW (HOD)`);
  } else if (validation.blocked) {
    console.log(
      `[worker] hold ${body.requestNumber} at READY — blocking validation (no approval)`,
    );
  }

  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: env.SQS_EXTRACT_QUEUE_URL,
      ReceiptHandle: receiptHandle,
    }),
  );

  console.log(
    `[worker] ack ${body.requestNumber}` +
      ` risk=${validation.overallRisk} findings=${validation.findings}` +
      (validation.blocked ? " blocked=true" : ""),
  );
}

async function pollOnce() {
  const res = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: env.SQS_EXTRACT_QUEUE_URL,
      MaxNumberOfMessages: MAX_MESSAGES,
      WaitTimeSeconds: WAIT_SECONDS,
      VisibilityTimeout: VISIBILITY_TIMEOUT,
      MessageAttributeNames: ["All"],
    }),
  );

  for (const msg of res.Messages ?? []) {
    if (!msg.Body || !msg.ReceiptHandle) continue;
    try {
      const body = JSON.parse(msg.Body) as ExtractQueueMessage;
      await processMessage(body, msg.ReceiptHandle);
    } catch (err) {
      console.error(
        "[worker] process error — message will reappear after visibility timeout",
        err,
      );
    }
  }
}

async function main() {
  console.log(`[worker] polling ${env.SQS_EXTRACT_QUEUE_URL} | validate=rules`);
  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      console.error("[worker] poll error", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
