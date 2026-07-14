import { prisma } from "../lib/prisma";
import { fillLinesFromExtractions } from "./fillFromExtraction";
import { enqueueExtractJob } from "./sqs";
import { AppError } from "../utils/errors";

const SUBMITTABLE = new Set(["DRAFT", "CHANGES_REQUESTED", "READY", "EXTRACTING"]);

/**
 * Mark request for OCR extract + rule validate and push a FIFO SQS message.
 * On worker failure later, leave findings / FAILED for HOD review (no DLQ).
 */
export async function submitPaymentRequestForProcessing(input: {
  requestId: string;
  requesterId: string;
}) {
  const request = await prisma.paymentRequest.findUnique({
    where: { id: input.requestId },
    include: {
      lines: { select: { id: true } },
      documents: { select: { id: true, processingStatus: true } },
    },
  });

  if (!request) throw new AppError(404, "NOT_FOUND", "Payment request not found");
  if (request.requesterId !== input.requesterId) {
    throw new AppError(403, "FORBIDDEN", "Only the requester can submit this request");
  }
  if (!SUBMITTABLE.has(request.status)) {
    throw new AppError(409, "CONFLICT", `Cannot submit from status ${request.status}`);
  }
  if (request.lines.length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "Add at least one payment line before submit");
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentRequest.update({
      where: { id: request.id },
      data: { status: "EXTRACTING" },
    });

    // Re-queue every doc (including already EXTRACTED) so Re-run extract
    // actually re-OCRs and re-validates instead of no-oping.
    if (request.documents.length > 0) {
      await tx.document.updateMany({
        where: { requestId: request.id },
        data: { processingStatus: "QUEUED" },
      });
    }
  });

  // If OCR already exists, parse + fill line amounts immediately for the UI
  await fillLinesFromExtractions(request.id);

  const { messageId } = await enqueueExtractJob({
    requestId: request.id,
    requestNumber: request.requestNumber,
  });

  const updated = await prisma.paymentRequest.findUniqueOrThrow({
    where: { id: request.id },
    include: {
      store: { select: { id: true, storeCode: true, storeName: true } },
      lines: { orderBy: { lineNumber: "asc" } },
      documents: {
        orderBy: { createdAt: "desc" },
        include: { extractions: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });

  return { request: updated, sqsMessageId: messageId };
}
