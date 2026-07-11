import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { env } from "../config/env";

const sqs = new SQSClient({ region: env.AWS_REGION });

export type ExtractQueueMessage = {
  type: "EXTRACT_AND_VALIDATE";
  requestId: string;
  requestNumber: string;
  enqueuedAt: string;
};

/**
 * Enqueue a payment request for the extract/validate worker.
 * FIFO: MessageGroupId = requestId (ordered per request).
 * Dedup id is unique per enqueue so resubmit after CHANGES_REQUESTED still works.
 */
export async function enqueueExtractJob(input: {
  requestId: string;
  requestNumber: string;
}): Promise<{ messageId: string | undefined }> {
  const body: ExtractQueueMessage = {
    type: "EXTRACT_AND_VALIDATE",
    requestId: input.requestId,
    requestNumber: input.requestNumber,
    enqueuedAt: new Date().toISOString(),
  };

  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: env.SQS_EXTRACT_QUEUE_URL,
      MessageBody: JSON.stringify(body),
      MessageGroupId: input.requestId,
      MessageDeduplicationId: `${input.requestId}-${Date.now()}`,
    }),
  );

  return { messageId: result.MessageId };
}
