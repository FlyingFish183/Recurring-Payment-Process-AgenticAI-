/**
 * Poll extract-worker.fifo → Textract / XML extract → DocumentExtraction rows.
 * Failures mark Document FAILED for HOD review (no DLQ).
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
import type { ExtractQueueMessage } from "../src/services/sqs";

const sqs = new SQSClient({ region: env.AWS_REGION });
const WAIT_SECONDS = 20;
const MAX_MESSAGES = 1;
/** PDFs use async Textract — keep message invisible long enough. */
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

  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: env.SQS_EXTRACT_QUEUE_URL,
      ReceiptHandle: receiptHandle,
    }),
  );

  console.log(
    `[worker] ack ${body.requestNumber} — extracted ${summary.okCount}/${summary.total}` +
      (summary.failCount ? ` (${summary.failCount} failed → HOD review)` : "") +
      ` → READY`,
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
      // Leave message for retry; after repeated failure HOD reviews via FAILED docs.
    }
  }
}

async function main() {
  console.log(`[worker] polling ${env.SQS_EXTRACT_QUEUE_URL}`);
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
