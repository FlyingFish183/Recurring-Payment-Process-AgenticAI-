# Backend Implementation Plan

**Owner**: Backend developer  
**Blueprint**: [KFC_Recurring_Payment_System_Technical_Blueprint_v1.1.docx](./KFC_Recurring_Payment_System_Technical_Blueprint_v1.1.docx)  
**Entity map**: [plan.md — Core business entities](./plan.md) · **Problem**: [problem-statement.md](./problem-statement.md) · **Pair**: [plan-frontend.md](./plan-frontend.md)

Stack: Node.js, Express, TypeScript, Prisma, Aurora PostgreSQL, AWS SDK (S3, Textract, Bedrock, KMS).

---

## Canonical aggregate (do not invent Invoice-as-root)

```
PAYMENT_REQUEST  (workflow container: store + period)
  └── PAYMENT_LINE  (expense / validation / pay unit)
        ├── DOCUMENT* (optional line_id)
        ├── VALIDATION_RESULT*
        ├── JOURNAL_ENTRY* → JOURNAL_ENTRY_LINE*
        └── PAYMENT_RECORD*
  └── DOCUMENT* (request-level when line_id null)
  └── APPROVAL_STEP*
  └── AUDIT_EVENT*
DOCUMENT → DOCUMENT_EXTRACTION* (versioned; never overwrite)
```

Master: `STORE`, `USER`, `VENDOR`, `BANK_ACCOUNT`, `CONTRACT`.

---

## Role actors (blueprint §10)

| Step | Enum | Actor | Backend duty |
|------|------|--------|--------------|
| 1 | `REQUESTER` | Requester | Create request, upload docs, confirm proposed lines, submit |
| 2 | `HOD` | HOD | Approve / reject / request_changes |
| 3 | `FA` | F&A | Same + master data write + analytics |
| 4 | `CA` | **Chief Accountant** | Accounting / journal readiness + sign |
| 5 | `CASHIER` | Cashier | Settlement + `PAYMENT_RECORD` + sign |

Optional blueprint `ADMIN` — skip for MVP workflow.

---

## Phase 1 — Foundation (blueprint §17.1)

- [ ] TypeScript Express (`src/`, `tsx`, CORS, `/health`).
- [ ] Prisma models matching blueprint attributes:
  - `Store`, `User`, `Vendor`, `BankAccount` (encrypted + hash fields)
  - `Contract` (type, amounts, JSON rules, version)
  - `PaymentRequest` (period, derived total, status enum, risk, approval level, version)
  - `PaymentLine` (expense_type, vendor, contract?, bank?, amounts, invoice refs, source, confirmed_by)
- [ ] Seed: stores, vendors, bank accounts, ~sample of 255-scale contracts, 5 role users.
- [ ] Mock Entra login by role; `requireRole`.
- [ ] CRUD APIs: stores, vendors, bank-accounts, contracts, payment-requests, payment-lines.

**Done when**: Create DRAFT request + add manual lines; total = sum(lines).

---

## Phase 2 — Document layer (§17.2)

- [ ] `Document` model: `request_id` required, `line_id` optional, SHA-256, `storage_uri`, types, processing_status.
- [ ] Upload to S3 (sanitize filename); create Document row; associate request/line.
- [ ] Process queue stub (`UPLOADED` → `QUEUED`).

**Done when**: Upload XML/PDF onto a request; list documents on aggregate GET.

---

## Phase 3 — Extraction (§17.3)

- [ ] `DocumentExtraction` versioned rows (`raw_text`, `structured_fields` JSONB).
- [ ] XML e-invoice parser first (no OCR).
- [ ] PDF text + Textract OCR fallback + Bedrock enrichment.
- [ ] Mark latest successful extraction in app layer (do not delete history).

**Done when**: XML + PDF produce extraction records with structured fields.

---

## Phase 4 — Line proposal + validation (§17.4–5)

- [ ] Propose lines from XML/AI (`source`: `XML_PARSED` / `AI_PROPOSED`); require confirm.
- [ ] `ValidationResult` engine: DUPLICATE, VENDOR_MATCH, BANK_MATCH, CONTRACT_AMOUNT/DATE, AMOUNT_ANOMALY, DOCUMENT_COMPLETENESS, XML_PDF_CONSISTENCY.
- [ ] Blocking severities prevent submit unless override policy.

**Done when**: Propose → confirm → validate returns findings on request aggregate.

---

## Phase 5 — Workflow (§17.6)

- [ ] On submit: lock material edits, instantiate `ApprovalStep` (HOD→FA→CA→CASHIER).
- [ ] Actions: approve / reject / request_changes; signature fields for CA/Cashier.
- [ ] Append-only `AuditEvent`.
- [ ] Request status machine per blueprint (`DRAFT`…`PAID`).

**Done when**: Full 5-role path with audit timeline; wrong role → 403.

---

## Phase 6 — Accounting + payment (§17.7)

- [ ] `JournalEntry` + `JournalEntryLine` (must balance); draft then mock post → `legacy_reference`.
- [ ] `PaymentRecord` for cashier settlement.
- [ ] Export package CSV/JSON.

**Done when**: Approved line → balanced JE → mock post → payment record.

---

## Phase 7 — Analytics + harden

- [ ] F&A text-to-SQL (SELECT-only) over Aurora entities.
- [ ] Jest: validation rules, workflow transitions, SQL safety, journal balance.
- [ ] Fixtures: sample XML + PDF; no secrets in repo.

---

## Suggested file map

```
backend/
├── prisma/schema.prisma
├── prisma/seed.ts
├── src/
│   ├── app.ts
│   ├── controllers/   # auth, masterData, paymentRequest, document, approval, journal, analytics
│   ├── services/      # s3, xmlInvoice, textract, bedrock, extraction, lineProposal,
│   │                  # validation, workflow, signature, journal, payment, textToSql
│   ├── middleware/    # auth, requireRole, errorHandler
│   └── utils/         # sqlSafety, hash, encryptBankAccount
└── fixtures/
```

---

## Out of scope (unless asked)

- Production Entra / real CA vendor (mock OK).
- Live ERP write-back (mock post + export).
- Auto-skipping approval levels (strict 5 for MVP).
- Treating Invoice as a separate root aggregate (use Document + PaymentLine instead).
