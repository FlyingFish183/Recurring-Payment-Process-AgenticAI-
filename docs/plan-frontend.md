# Frontend Implementation Plan

**Owner**: Frontend developer  
**Spec**: [spec.md](./spec.md) · **Shared**: [plan.md](./plan.md) · **Pair**: [plan-backend.md](./plan-backend.md)

Stack: Next.js 16 (App Router), React 19, TypeScript, TailwindCSS v4, Geist fonts.

---

## Goals

1. Role-based UI for Requester, HOD, F&A, CA, Cashier, Admin (mock Entra via role switcher).
2. Screens for upload → request dossier → 5-level approvals → admin master data → NL analytics.
3. Consume backend API; use **MSW** mocks so UI progress is not blocked by AWS/backend.

---

## Phase 1 — Foundation

### Tasks
- [ ] App shell: `layout.tsx`, nav by role, dark/light toggle, Geist typography.
- [ ] `lib/api.ts`: base URL from `NEXT_PUBLIC_API_URL`, typed fetch helpers, error handling.
- [ ] `lib/auth.tsx` (or similar): login, store token, `useUser()`, role switcher for demo.
- [ ] Pages scaffolding (empty states OK):
  - `/` dashboard
  - `/requests`, `/requests/new`, `/requests/[id]`
  - `/approvals`
  - `/admin` (stores, vendors, contracts)
  - `/analytics`
- [ ] Shared UI: status badges, loading/error states, page headers.
- [ ] MSW handlers mirroring [plan.md](./plan.md) contract with fake data.

### Done when
- Can switch roles and navigate all routes; API client hits mock or live backend via env.

---

## Phase 2 — Invoice upload & payment requests

### Tasks
- [ ] `/requests/new`: drag-drop PDF/XML upload, store picker, submit.
- [ ] Upload progress + extraction result summary (amount, tax, line items table).
- [ ] Validation / anomaly callouts (match, mismatch, duplicate, over-budget).
- [ ] `/requests`: list with filters (status, store).
- [ ] `/requests/[id]`: dossier view — invoice fields, line items, S3/source link, flags, workflow progress bar (5 steps).
- [ ] Submit request CTA (Requester).

### Done when
- Happy path UI: upload → see structured invoice → create/submit request (mock or real API).

---

## Phase 3 — Approvals UX

### Tasks
- [ ] `/approvals`: pending queue for current role (empty state when none).
- [ ] Detail actions: Approve (optional comment), Reject (required reason), Sign when applicable.
- [ ] Workflow progress component: highlight current step; history timeline from audit events.
- [ ] Disable actions if user role ≠ current step.
- [ ] Toast / inline feedback on success/failure.

### Done when
- Demo can switch roles and clear one request through all five levels in the UI.

---

## Phase 4 — Admin & analytics

### Tasks
- [ ] `/admin`: tabs or sections for Stores, Vendors, Contracts (list + create/edit forms).
- [ ] `/analytics`:
  - Prompt input (example chips: store + location invoices).
  - Show **generated SQL** (read-only code block).
  - Confirm/run if product decision requires it; else show results after backend gate.
  - Results table (columns + rows); empty/error states for rejected SQL.
- [ ] Export button on completed request → download CSV/JSON.
- [ ] Dashboard widgets: counts by status, pending for my role (from list APIs).

### Done when
- Admin can manage master data and run an NL analytics query with visible SQL + table.

---

## Phase 5 — Polish & demo

### Tasks
- [ ] Responsive layout (desktop-first, usable on laptop for demo).
- [ ] RTL/loading skeletons on slow extract.
- [ ] Component tests for status badge + workflow progress (Jest + RTL).
- [ ] Keep MSW as fallback when `NEXT_PUBLIC_USE_MOCKS=true`.
- [ ] Short demo script in `frontend/my-app/README.md` (click path by role).

### Done when
- Full UI walkthrough works against mocks alone; flips to live API with one env change.

---

## Suggested file map

```
frontend/my-app/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # Dashboard
│   ├── login/page.tsx
│   ├── requests/
│   │   ├── page.tsx
│   │   ├── new/page.tsx
│   │   └── [id]/page.tsx
│   ├── approvals/page.tsx
│   ├── admin/page.tsx
│   ├── analytics/page.tsx
│   └── globals.css
├── components/
│   ├── AppNav.tsx
│   ├── RoleSwitcher.tsx
│   ├── WorkflowProgress.tsx
│   ├── InvoiceLineTable.tsx
│   ├── AnomalyBanner.tsx
│   ├── StatusBadge.tsx
│   ├── SqlPreview.tsx
│   └── ResultsTable.tsx
├── lib/
│   ├── api.ts
│   ├── auth.tsx
│   └── types.ts                 # Align with backend DTOs
└── mocks/
    ├── handlers.ts
    └── data.ts
```

---

## UI notes (from spec)

- Modern dark/light mode; progress-based workflow bars.
- Card-based metrics on dashboard (OK for app UI; this is an internal tool, not a marketing landing page).
- Show validation/anomaly states clearly (match vs flag).
- Analytics: always surface generated SQL next to results.

---

## Dependency on backend

| You need | Backend phase | Until then |
|----------|---------------|------------|
| Auth token + roles | 1 | MSW login |
| Seeded stores/vendors | 1 | MSW lists |
| Upload + invoice JSON | 2 | MSW extract fixture |
| Approvals + audit | 3 | MSW state machine in memory |
| Analytics `{ sql, rows }` | 4 | MSW fixed SQL + sample rows |
| Export blob | 4 | MSW CSV string |

At each sync checkpoint in [plan.md](./plan.md), replace MSW handlers with live calls for that slice.

---

## Out of scope (unless asked)

- Real Microsoft Entra MSAL production wiring (role switcher is enough).
- Building Prisma/schema or calling AWS from the browser.
- Designing the SQL safety rules (backend-owned; UI only displays outcomes).
