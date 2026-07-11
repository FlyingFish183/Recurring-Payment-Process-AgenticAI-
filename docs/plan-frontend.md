# Frontend Implementation Plan

**Owner**: Frontend developer  
**Blueprint**: [KFC_Recurring_Payment_System_Technical_Blueprint_v1.1.docx](./KFC_Recurring_Payment_System_Technical_Blueprint_v1.1.docx) §16  
**Entity map**: [plan.md — Core business entities](./plan.md) · **Pair**: [plan-backend.md](./plan-backend.md)

Stack: Next.js 16 (App Router), React 19, TypeScript, TailwindCSS v4, Geist fonts.

---

## UI must reflect blueprint aggregate

Show **Payment Request → Payment Lines → Documents** (not a flat “invoice-only” page).

| Blueprint screen (§16) | Route (suggested) | Primary role |
|------------------------|-------------------|--------------|
| Payment Inbox | `/` or `/payment-requests` | All |
| Create Request | `/payment-requests/new` | Requester |
| AI Line Proposal Review | `/payment-requests/[id]/lines` | Requester |
| Request Detail | `/payment-requests/[id]` | All |
| Line Review Drawer | drawer on detail | All |
| Approval Workspace | `/approvals` | HOD, F&A, CA, Cashier |
| Accounting Workspace | `/accounting` or tab on detail | CA, F&A |
| Audit Timeline | panel on detail | All |
| Master data | `/master-data` | F&A |
| Analytics | `/analytics` | F&A |

---

## Role actors (UI)

| Enum | Actor | Team | Nav / actions |
|------|--------|------|---------------|
| `REQUESTER` | Requester | Business / store | Create, upload, confirm lines, submit |
| `HOD` | HOD | Business leadership | Approvals |
| `FA` | F&A | Finance + Accounting | Approvals, master data, analytics |
| `CA` | **Chief Accountant** | Accounting | Approvals, journal readiness, sign |
| `CASHIER` | Cashier | Treasury | Approvals, payment confirm, sign |

Hide nav the current actor cannot use.

---

## Phase 1 — Shell + inbox + draft request

- [x] Role switcher (5 actors); team labels.
- [x] Payment Inbox: filter store, period, status, risk, amount.
- [x] Create Request: store + period → DRAFT.
- [x] Request Detail shell: header, empty line grid, totals.

**Done when**: Can create/list/open a DRAFT (mock or API). ✅ live API

---

## Phase 2 — Documents

- [ ] Upload XML/PDF on request; show processing status chips.
- [ ] Document list with type (E_INVOICE, CONTRACT, …) and request vs line association.

**Done when**: Uploaded files appear on request detail.

---

## Phase 3–4 — Extraction + line proposal + validation

- [ ] Extraction preview: structured fields + searchable full text.
- [ ] AI Line Proposal Review: side-by-side fields / confidence / confirm-edit.
- [ ] Line grid: expense type, vendor, contract, gross, status, risk.
- [ ] Validation banners from `VALIDATION_RESULT` (severity colors; blocking explained).

**Done when**: Confirm lines → total recalculates → validations visible before submit.

---

## Phase 5 — Approval workspace

- [ ] Pending queue by role.
- [ ] Actions: Approve, Reject, Request changes; signature UX for CA/Cashier.
- [ ] Workflow progress: Requester → HOD → F&A → CA → Cashier.
- [ ] Audit Timeline from `AUDIT_EVENT`.

**Done when**: Role-switch demo clears one request through five steps.

---

## Phase 6 — Accounting + payment

- [ ] Accounting workspace: GL suggestions, debit/credit balance check.
- [ ] Export download; Cashier payment confirm → PaymentRecord display.
- [ ] Dashboard widgets by role (pending, high-risk, ready-to-pay).

---

## Phase 7 — Analytics + polish

- [ ] F&A NL analytics (SQL preview + results).
- [ ] MSW fixtures matching blueprint aggregate JSON (see plan.md example PR-2026-07152).
- [ ] Demo script by role.

---

## Suggested file map

```
frontend/my-app/
├── app/
│   ├── page.tsx                      # Payment Inbox
│   ├── payment-requests/
│   │   ├── new/page.tsx
│   │   └── [id]/page.tsx            # Detail + drawers
│   ├── approvals/page.tsx
│   ├── accounting/page.tsx           # optional dedicated
│   ├── master-data/page.tsx
│   ├── analytics/page.tsx
│   └── login/page.tsx
├── components/
│   ├── RoleSwitcher.tsx
│   ├── PaymentLineGrid.tsx
│   ├── DocumentList.tsx
│   ├── ExtractionPreview.tsx
│   ├── LineProposalReview.tsx
│   ├── ValidationBanner.tsx
│   ├── WorkflowProgress.tsx
│   ├── AuditTimeline.tsx
│   ├── JournalBalance.tsx
│   └── …
├── lib/ { api.ts, auth.tsx, roles.ts, types.ts }
└── mocks/
```

---

## Types to mirror (from blueprint)

Prefer names: `PaymentRequest`, `PaymentLine`, `Document`, `DocumentExtraction`, `ValidationResult`, `ApprovalStep`, `JournalEntry`, `PaymentRecord`, `AuditEvent` — **not** a separate root `Invoice` entity in the UI model.

Expense types: `RENT | ELECTRICITY | WATER | SERVICE_FEE | MAINTENANCE | OTHER`.

---

## Out of scope

- Sixth Admin-only console (unless product later adds blueprint `ADMIN`).
- Calling AWS from the browser.
- Authoritative editing of bank account plaintext (mask; authorized roles only).
