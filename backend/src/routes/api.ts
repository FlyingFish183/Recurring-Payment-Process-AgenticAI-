import { Router } from "express";
import { authRouter } from "./auth";
import { documentRouter } from "./documents";
import { masterDataRouter } from "./masterData";
import { paymentLineRouter } from "./paymentLines";
import { paymentRequestRouter } from "./paymentRequests";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use(masterDataRouter);
apiRouter.use("/payment-requests", paymentRequestRouter);
apiRouter.use("/payment-lines", paymentLineRouter);
apiRouter.use("/documents", documentRouter);
