export type UserRole = "REQUESTER" | "HOD" | "FA" | "CA" | "CASHIER";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  department: string | null;
};

export type Store = {
  id: string;
  storeCode: string;
  storeName: string;
  region: string | null;
  costCenterCode: string | null;
  address: string | null;
  status: string;
};

export type Vendor = {
  id: string;
  vendorCode: string;
  legalName: string;
  taxId: string | null;
  vendorType: string;
  status: string;
  riskLevel: string;
  bankAccounts?: BankAccount[];
};

export type BankAccount = {
  id: string;
  vendorId: string;
  bankName: string;
  bankCode: string | null;
  accountName: string;
  accountNumberHash: string;
  isActive: boolean;
  verificationStatus: string;
};

export type Contract = {
  id: string;
  contractNumber: string;
  storeId: string;
  vendorId: string;
  contractType: string;
  baseAmount: string | number;
  currency: string;
  status: string;
  store?: Pick<Store, "id" | "storeCode" | "storeName">;
  vendor?: Pick<Vendor, "id" | "vendorCode" | "legalName">;
};

export type ExpenseType =
  | "RENT"
  | "ELECTRICITY"
  | "WATER"
  | "SERVICE_FEE"
  | "MAINTENANCE"
  | "OTHER";

export type PaymentLine = {
  id: string;
  requestId: string;
  lineNumber: number;
  expenseType: ExpenseType;
  vendorId: string;
  contractId: string | null;
  bankAccountId: string | null;
  netAmount: string | number;
  taxAmount: string | number;
  grossAmount: string | number;
  currency: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  description: string | null;
  status: string;
  source: string;
  riskScore?: number | null;
  vendor?: Pick<Vendor, "id" | "vendorCode" | "legalName" | "taxId">;
  contract?: { id: string; contractNumber: string; baseAmount?: string | number } | null;
  bankAccount?: {
    id: string;
    bankName: string;
    accountName: string;
    accountNumberHash: string;
  } | null;
};

export type DocumentExtraction = {
  id: string;
  documentId: string;
  engine: string;
  extractionMethod: string;
  rawText: string | null;
  structuredFields: Record<string, unknown> | null;
  pageData: unknown;
  confidenceOverall: number | null;
  status: string;
  createdAt: string;
};

export type ValidationResult = {
  id: string;
  requestId: string | null;
  lineId: string | null;
  validationType: string;
  severity: string;
  message: string;
  evidence?: Record<string, unknown> | null;
  recommendedAction: string | null;
  createdAt: string;
};

export type Document = {
  id: string;
  requestId: string;
  lineId: string | null;
  fileName: string;
  mimeType: string;
  fileFormat: "XML" | "PDF" | "IMAGE" | "OTHER";
  storageUri: string;
  /** Short-lived HTTPS URL for browser display (presigned S3 GET). */
  viewUrl?: string | null;
  sha256Hash: string;
  documentType: string;
  processingStatus: string;
  uploadedById: string;
  createdAt: string;
  extractions?: DocumentExtraction[];
};

export type ApprovalStep = {
  id: string;
  requestId: string;
  sequenceNumber: number;
  roleRequired: UserRole;
  status: string;
  actorId: string | null;
  comments: string | null;
  signatureHash: string | null;
  signedAt: string | null;
  actedAt: string | null;
  createdAt: string;
  actor?: Pick<AuthUser, "id" | "displayName" | "email" | "role"> | null;
};

export type AuditEvent = {
  id: string;
  requestId: string | null;
  actorId: string | null;
  actorRole: UserRole | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
};

export type PaymentRequest = {
  id: string;
  requestNumber: string;
  storeId: string;
  requesterId: string;
  paymentPeriod: string;
  currency: string;
  totalAmount: string | number;
  status: string;
  riskLevel: string;
  currentApprovalLevel: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  store?: Pick<Store, "id" | "storeCode" | "storeName">;
  requester?: Pick<AuthUser, "id" | "displayName" | "role" | "email">;
  lines?: PaymentLine[];
  documents?: Document[];
  validationResults?: ValidationResult[];
  approvalSteps?: ApprovalStep[];
  auditEvents?: AuditEvent[];
  _count?: { lines: number };
};

export type PendingApprovalStep = ApprovalStep & {
  request: PaymentRequest & {
    store?: Pick<Store, "id" | "storeCode" | "storeName"> & { region?: string };
    lines?: Array<{
      id: string;
      lineNumber: number;
      expenseType: string;
      grossAmount: string | number;
      invoiceNumber: string | null;
      status?: string;
      vendor?: { legalName: string; vendorCode: string };
    }>;
    validationResults?: Array<{
      id: string;
      validationType: string;
      message: string;
    }>;
  };
};

export type Paginated<T> = {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};
