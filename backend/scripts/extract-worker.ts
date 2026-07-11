/**
 * Poll extract-worker.fifo and claim jobs.
 * Textract / Bedrock come next — for now: mark PROCESSING, log, delete message.
 * Failures should leave the request for HOD review (no DLQ).
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
import type { ExtractQueueMessage } from "../src/services/sqs";

const sqs = new SQSClient({ region: env.AWS_REGION });
const WAIT_SECONDS = 20;
const MAX_MESSAGES = 1;

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

  if (request.documents.length > 0) {
    await prisma.document.updateMany({
      where: { requestId: request.id, processingStatus: "QUEUED" },
      data: { processingStatus: "PROCESSING" },
    });
  }

  // TODO: Textract → DocumentExtraction → Bedrock anomaly → ValidationResult
  // Until then, park as READY so HOD can open it; keep docs PROCESSING visible.
  await prisma.paymentRequest.update({
    where: { id: request.id },
    data: { status: "READY" },
  });

  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: env.SQS_EXTRACT_QUEUE_URL,
      ReceiptHandle: receiptHandle,
    }),
  );

  console.log(
    `[worker] ack ${body.requestNumber} — ${request.documents.length} doc(s), ${request.lines.length} line(s) → READY (extract stub)`,
  );
}

async function pollOnce() {
  const res = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: env.SQS_EXTRACT_QUEUE_URL,
      MaxNumberOfMessages: MAX_MESSAGES,
      WaitTimeSeconds: WAIT_SECONDS,
      VisibilityTimeout: 60,
      MessageAttributeNames: ["All"],
    }),
  );

  for (const msg of res.Messages ?? []) {
    if (!msg.Body || !msg.ReceiptHandle) continue;
    try {
      const body = JSON.parse(msg.Body) as ExtractQueueMessage;
      await processMessage(body, msg.ReceiptHandle);
    } catch (err) {
      console.error("[worker] process error — message will reappear after visibility timeout", err);
      // No DLQ: after retries / timeout HOD reviews via request status.
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
