# Backend Implementation Plan

**Owner**: Backend developer  
**Spec**: [spec.md](./spec.md) · **Shared**: [plan.md](./plan.md) · **Pair**: [plan-frontend.md](./plan-frontend.md)

Stack: Node.js, Express, TypeScript, Prisma, Aurora PostgreSQL, AWS SDK (S3, Textract, Bedrock).

---

## Goals

1. Persist **structured invoice data** in Aurora (headers + line items); raw files in S3.
2. Run extract → validate → duplicate/anomaly → 5-level workflow → export.
3. Expose REST API matching the shared contract in [plan.md](./plan.md).
4. Admin **text-to-SQL** via Bedrock with SELECT-only safety gate.

---

## Phase 1 — Foundation

### Tasks
- [ ] Convert Express scaffold to TypeScript (`src/`, `tsconfig`, `npm run dev`).
- [ ] Add folder layout: `controllers/`, `services/`, `middleware/`, `utils/`, Prisma under `prisma/`.
- [ ] Prisma schema (Aurora-compatible PostgreSQL):
  - `User` (id, name, role, email)
  - `Store` (id, code, name, location/district/city)
  - `Vendor` (id, name, taxId, bankAccount)
  - `Contract` + `ContractTerm` (storeId, category, amount rules, effective dates)
  - `Invoice` (invoiceNumber, vendorId, storeId, issueDate, total, tax, s3Key, sourceType, rawMeta JSON)
  - `InvoiceLineItem` (invoiceId, description, category, amount, quantity)
  - `PaymentRequest` (status, currentStep, requesterId, storeId, …)
  - `WorkflowEvent` / `AuditLog` (requestId, actorId, action, comment, timestamp)
  - `AnomalyFlag` (requestId/invoiceId, type, message, severity)
- [ ] Migrations + seed: stores, vendors, contracts, users per role.
- [ ] Mock auth middleware: `POST /auth/login` by role, JWT or signed token, `GET /auth/me`.
- [ ] `GET /health`, CORS for `localhost:3000`, shared error middleware.
- [ ] Stub all contract routes with `501` or empty lists so frontend can wire early.

### Done when
- DB migrates against local Postgres; seed works; login returns a role token.

---

## Phase 2 — Document intelligence & structured persistence

### Tasks
- [ ] `POST /invoices/upload`: multipart upload → sanitize filename → S3 put.
- [ ] Textract service (PDF) + optional XML parser for VN e-invoice.
- [ ] Bedrock service: map OCR/XML → structured JSON (amount, tax, date, line items, vendor hints).
- [ ] Persist `Invoice` + `InvoiceLineItem` in Aurora; store `s3Key`.
- [ ] `GET /invoices/:id` returns structured payload.
- [ ] Contract validation service: compare line items vs store contract terms.
- [ ] Duplicate detection: same invoiceNumber + vendor (+ amount/date heuristics).
- [ ] Anomaly service: over-budget / price spike vs contract → write `AnomalyFlag`.
- [ ] `POST /requests` + `GET /requests` + `GET /requests/:id` (dossier).
- [ ] Dev toggle: mock Textract/Bedrock fixtures when AWS unavailable.

### Done when
- Upload returns invoice id; DB has header + lines; dossier shows validation + flags.

---

## Phase 3 — Workflow engine

### Tasks
- [ ] State machine: `DRAFT → PENDING_HOD → PENDING_FA → PENDING_CA → PENDING_CASHIER → APPROVED | REJECTED`.
- [ ] `POST /requests/:id/submit` (Requester only).
- [ ] `GET /approvals/pending` filtered by current role.
- [ ] `POST .../approve` and `.../reject` with role checks; append `AuditLog`.
- [ ] Sign endpoint stub (KMS or mock signature hash) for CA/Cashier as needed.
- [ ] Never skip levels unless explicit auto-approve flag (default: strict 5-level).

### Done when
- One request can be walked through all five roles with a full audit trail.

---

## Phase 4 — Analytics text-to-SQL & export

### Tasks
- [ ] `POST /analytics/query` (ADMIN only):
  1. Send prompt + **schema summary** to Bedrock.
  2. Parse returned SQL.
  3. Safety gate: single statement, `SELECT` only, no `;` chains, block DDL/DML, allowlist tables (`invoices`, `invoice_line_items`, `stores`, `vendors`, `payment_requests`, …).
  4. Execute read-only (optional: Prisma `$queryRaw` with timeout / statement timeout).
  5. Return `{ sql, columns, rows }`.
- [ ] Log analytics queries (who, prompt, sql, time).
- [ ] `GET /requests/:id/export` → CSV/JSON journal mapping.
- [ ] Admin CRUD for stores/vendors/contracts if not done in Phase 1.

### Done when
- Prompt like *"invoices for store X in District Y"* returns safe SQL + rows; export downloads.

---

## Phase 5 — Hardening & demo

### Tasks
- [ ] Jest: duplicate logic, workflow transitions, SQL safety gate.
- [ ] Retry/error wrapping for AWS calls.
- [ ] README: env vars, migrate, seed, run, demo curl script.
- [ ] Sample fixtures under `backend/fixtures/` for offline demo.

### Done when
- Happy-path demo works offline (mocks) and online (AWS) without code changes beyond env.

---

## Suggested file map

```
backend/
├── prisma/schema.prisma
├── prisma/seed.ts
├── src/
│   ├── app.ts
│   ├── controllers/
│   │   ├── authController.ts
│   │   ├── invoiceController.ts
│   │   ├── requestController.ts
│   │   ├── approvalController.ts
│   │   ├── analyticsController.ts
│   │   └── masterDataController.ts
│   ├── services/
│   │   ├── s3Service.ts
│   │   ├── textractService.ts
│   │   ├── bedrockService.ts
│   │   ├── invoicePersistService.ts
│   │   ├── validationService.ts
│   │   ├── duplicateService.ts
│   │   ├── anomalyService.ts
│   │   ├── workflowService.ts
│   │   ├── textToSqlService.ts
│   │   └── exportService.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── requireRole.ts
│   │   └── errorHandler.ts
│   └── utils/
│       └── sqlSafety.ts
└── fixtures/
```

---

## API ownership checklist

Ship stubs early; flesh out in order:

1. Auth + health  
2. Master data GET (seeded)  
3. Invoice upload + GET  
4. Requests CRUD + submit  
5. Approvals  
6. Analytics query  
7. Export  

Notify frontend when each group moves from stub → real (Slack/chat + bump response examples).

---

## Out of scope (unless asked)

- Real Entra ID production SSO (mock is enough for hackathon).
- Direct live ERP write-back (export only).
- Auto-skipping approval levels.
