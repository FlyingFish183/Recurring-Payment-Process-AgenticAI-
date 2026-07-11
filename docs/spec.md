# Technical Specification: KFC Vietnam Recurring Payment Process Automation (Agentic AI)

**Problem brief**: [problem-statement.md](./problem-statement.md)

## Objective
KFC Vietnam processes ~300 recurring payment requests monthly across 250+ stores, each bundling multiple line items (rent, water, electricity, service fees). The current manual 5-level paper-based approval workflow is slow (takes 2 days of manual closing work), error-prone, prone to duplicates, and lacks audit trails.

This system will digitize and automate the entire pipeline:
1. **Document Intelligence**: Auto-extract invoice tables and metadata (amount, vendor, tax, line items) from PDF/XML invoices using **AWS Textract** and **Amazon Bedrock (Claude 3.5 Sonnet)**.
2. **Structured Persistence**: Persist extracted fields as **PaymentRequest / PaymentLine / Document / DocumentExtraction** in **Amazon Aurora PostgreSQL**. Raw PDFs/XMLs remain in S3; queryable business fields live in Aurora.
3. **Contract & Master Data Validation**: Automatically cross-reference extracted items against the store's active contract (rent rules, utilities, pricing, etc.) and vendor/bank master data.
4. **Anomaly & Duplicate Detection**: Flag potential duplicate payments (same invoice number, vendor, date, or amount) and anomalies (out-of-budget, price increases).
5. **Digital Workflow**: Orchestrate a 5-level digital approval chain with one responsible actor per step (see **Role actors** below).
6. **ERP Handoff**: Auto-generate mapped journal entries for legacy accounting software (Cashier / F&A after final approval).
7. **Natural-Language Analytics (F&A)**: F&A (and optionally CA) query payment/invoice data in plain language (e.g. *"I want to view the invoices for store X located in District Y"*). **Amazon Bedrock** generates safe, read-only SQL against the **Aurora PostgreSQL** schema; the backend validates and executes it, then returns tabular results.

**Success Metric**: Reduce end-to-end payment request cycle time by **80%** and closing time from **2 days to under 2 hours**.

---

## Role actors (5-step process)

There is **no separate generic Admin role**. System actors are exactly the five process owners. Each step is owned by one role; only that role may act at that step.

| Step | Role enum | Actor | Team (problem) | Responsibility |
|------|-----------|--------|----------------|----------------|
| 1 | `REQUESTER` | Requester | Business / store function | Upload PDF/XML invoice, create multi-line payment request, submit into workflow |
| 2 | `HOD` | Head of Department (HOD) | Business function leadership | First-line business approval / reject |
| 3 | `FA` | Finance & Accounting (F&A) | Finance + Accounting | Finance review, contract/budget confirmation, master data (stores/vendors/banks/contracts), NL analytics |
| 4 | `CA` | Chief Accountant (CA) | Accounting / control | Accounting mapping & journal readiness, digital sign as required |
| 5 | `CASHIER` | Cashier | Accounting / treasury | Final payment authorization, digital sign, payment settlement / journal handoff |

**Flow**: `Requester` → `HOD` → `F&A` → `CA` → `Cashier`

Mock Entra ID login switches among these five roles only for demo/testing.

**Canonical data model**: see [plan.md — Core business entities](./plan.md) (Technical Blueprint v1.1). Aggregate is **PaymentRequest → PaymentLine → Document**; do not model Invoice as a separate root.

---

## Tech Stack
* **Frontend**: Next.js 16 (React 19, TypeScript, TailwindCSS v4, Geist Fonts)
* **Backend**: Node.js, Express.js, TypeScript (using `ts-node` or compilation pipeline)
* **Database**: **Amazon Aurora PostgreSQL** (Prisma ORM for schema and migrations). Stores structured invoice headers/line items, stores, contracts, vendors, workflow state, and audit logs. Local development may use a compatible PostgreSQL instance with the same schema.
* **AWS Services (AI & Cloud)**:
  * **AWS SDK v3**: Core communication client
  * **Amazon Aurora (PostgreSQL-compatible)**: Primary datastore for structured invoice and operational data
  * **Amazon S3**: Secure storage for raw invoice PDFs, XML files, and signed dossiers (binary/source artifacts only)
  * **Amazon Textract**: OCR, form extraction, and table structure detection
  * **Amazon Bedrock (Anthropic Claude 3.5 Sonnet / Haiku)**: Advanced LLM parsing, mapping line items to expense categories, semantic validation against contracts, anomaly analysis, and **text-to-SQL** for F&A analytics queries against Aurora
  * **AWS Step Functions / Backend State Machine**: Localized state engine or AWS Step Functions to manage the 5-level approval state (Requester -> HOD -> F&A -> CA -> Cashier)
  * **AWS KMS**: Cryptographic key service for digital signatures
* **Authentication**: Microsoft Entra ID (Azure AD) via OpenID Connect (OIDC) / MSAL for SSO
* **Testing**: Jest for backend logic, React Testing Library for frontend components

---

## Commands
### Backend Commands
* **Install dependencies**: `npm install`
* **Run Dev Server**: `npm run dev` or `node ./bin/www` (Express)
* **Run Linter**: `npm run lint`
* **Database Migration**: `npx prisma migrate dev`
* **Seed Database**: `npx prisma db seed`
* **Run Tests**: `npm test`

### Frontend Commands
* **Install dependencies**: `npm install`
* **Run Dev Server**: `npm run dev` (starts on port 3000)
* **Build Production Bundle**: `npm run build`
* **Run Linter**: `npm run lint`
* **Run Tests**: `npm test`

---

## Project Structure
We will organize the code using a monorepo-like layout.
```
/
├── backend/
│   ├── bin/
│   │   └── www             # Server bootstrapper
│   ├── src/
│   │   ├── controllers/    # Express route handlers
│   │   ├── services/       # Core business logic (AWS Textract, Bedrock, Workflow, Duplicates, Text-to-SQL)
│   │   ├── middleware/     # Auth (Entra ID), validation, errors
│   │   ├── models/         # Database models/Prisma schema
│   │   └── utils/          # Helper utilities
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   └── my-app/
│       ├── app/            # Next.js App Router
│       │   ├── layout.tsx  # Root Layout
│       │   ├── page.tsx    # Dashboard / Login page
│       │   ├── payment-requests/  # Create, detail, line proposal, dossier
│       │   ├── approvals/  # Pending queue for current step actor (HOD / F&A / CA / Cashier)
│       │   ├── master-data/ # Stores, vendors, bank accounts, contracts (F&A)
│       │   ├── analytics/  # F&A NL query UI: prompt → generated SQL → result table
│       │   └── globals.css # CSS Styles
│       ├── components/     # Reusable UI components
│       ├── lib/            # API client and helper functions
│       └── package.json
├── docs/
│   ├── problem-statement.md # Hackathon problem brief (P1)
│   ├── KFC_Recurring_Payment_System_Technical_Blueprint_v1.1.docx  # Core entities blueprint
│   ├── ChatGPT Image Jul 11, 2026, 02_59_09 PM.png  # ER / data categories visual
│   ├── ChatGPT Image Jul 11, 2026, 03_25_29 PM.png  # Architecture + ER visual
│   ├── spec.md             # This document
│   ├── plan.md             # Shared plan + entities + API contract
│   ├── plan-backend.md     # Backend developer plan
│   └── plan-frontend.md    # Frontend developer plan
└── README.md
```

---

## Code Style
* **TypeScript First**: Strict typing enabled. Avoid using `any`.
* **Functional Programming**: Prefer pure functions, immutable state updates, and async/await for asynchronous operations.
* **UI Style**: Modern, sleek dark/light mode, card-based metrics, progress-based workflow bars.
* **Example Snippet (Backend Service)**:
```typescript
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

export async function analyzeInvoiceWithBedrock(extractedText: string, contractTerms: string): Promise<InvoiceAnalysisResult> {
  const client = new BedrockRuntimeClient({ region: "us-east-1" });
  const prompt = `Analyze the following invoice text against contract terms.
  Invoice: ${extractedText}
  Contract Terms: ${contractTerms}
  Return a JSON object matching the format: { matchesTerms: boolean, discrepancyReason?: string }`;

  const response = await client.send(new InvokeModelCommand({
    modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  }));
  
  const responseData = JSON.parse(new TextDecoder().decode(response.body));
  return JSON.parse(responseData.content[0].text);
}
```

---

## Testing Strategy
* **Backend Unit Tests**: Jest. Verify logic for duplicate checks, invoice extraction mapping, budget verification, workflow state transition constraints, and text-to-SQL safety (reject non-SELECT / multi-statement / schema-mutating queries).
* **Frontend Component Tests**: Jest + React Testing Library. Test validation state indicators, progress workflows, and visual statuses.
* **E2E Testing**: MSW (Mock Service Worker) to mock AWS Textract and Bedrock responses during development and testing to control cost and dependencies.

---

## Boundaries
* **Always**:
  * Sanitize all uploaded document filenames before saving to S3.
  * Log all workflow state changes with the ID of the operator (audit trail).
  * Wrap external AWS API calls in robust try-catch blocks with retry logic.
  * For F&A text-to-SQL: only allow **read-only SELECT** queries; validate/parse generated SQL before execution; never run raw LLM output without a safety gate; restrict to analytics-relevant tables; show the generated SQL for review before or alongside results.
  * Enforce role-per-step: only the actor for the current workflow step may approve/reject/sign.
* **Ask first**:
  * Modifying Prisma/Database schema.
  * Adding new external packages to `package.json`.
* **Never**:
  * Hardcode AWS secret keys or Entra ID credentials in the source code.
  * Allow bypassing of any of the 5 approval levels unless explicitly flagged for automated auto-approvals (e.g., small amounts below threshold, though default is strict 5-level).

---

## Success Criteria
1. **Extraction Accuracy**: Extract invoice amount, tax, date, and line-item details with >95% confidence from standard PDFs/XMLs.
2. **Structured Persistence**: After extraction, invoice header and line-item fields are written as structured rows in Aurora PostgreSQL (with S3 object keys linking back to the source file).
3. **Execution Time**: The system can parse an uploaded invoice, run validations, check duplicates, and display the dossier in under **10 seconds**.
4. **Workflow Routing**: Payment requests correctly progress through: `Requester` -> `HOD` -> `F&A` -> `CA` -> `Cashier` without skipping states; each step is actionable only by its role actor.
5. **Audit Trail**: Every action (upload, verify, approve, sign, reject) writes a signed/secured entry in the database audit log with the acting role.
6. **Legacy Accounting Export**: Downloadable/API-ready format (e.g. CSV or JSON) matches the database records exactly (Cashier after final step; F&A may also download for review).
7. **F&A Text-to-SQL Analytics**: Given a natural-language prompt (e.g. invoices for a named store and location), Bedrock produces valid PostgreSQL `SELECT` SQL against the Aurora schema; the UI shows the SQL and query results. Unsafe or non-SELECT SQL is rejected.

---

## Open Questions & Assumptions

### Assumptions
1. **Environment Setup**: We are using standard AWS Node.js SDK (`@aws-sdk/client-...`). AWS credentials will be loaded from environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`).
2. **Aurora PostgreSQL**: Production/demo targets **Amazon Aurora PostgreSQL**. Local/dev can use standard PostgreSQL with the same Prisma schema and connection string via `DATABASE_URL`.
3. **Entra ID Authentication**: Integration with Entra ID will be mocked locally with the five process roles only (`REQUESTER`, `HOD`, `FA`, `CA`, `CASHIER`), allowing developers to switch actors to test each step.
4. **No direct ERP connection**: Handoff to the legacy accounting system will be simulated via an export page providing standard CSV or JSON journal entries.

### Clarifications Needed from User
1. **XML E-Invoices**: Are these standard Vietnamese e-invoices (usually XML format with VNPT or Viettel signatures)? If so, we should build a parser for XML in addition to AWS Textract OCR for PDF.
2. **Digital Signatures**: Do we need to integrate with external CA (like VNPT-CA, Viettel-CA, SmartSign) or is an internal cryptographic signing (e.g. via private keys or AWS KMS) sufficient for the hackathon?
3. **Auto-Approval Thresholds**: Are there recurring utility payments (e.g., electricity bills below a certain amount) that can bypass some approval levels, or must all payments go through all 5 levels?
4. **Text-to-SQL UX**: Should F&A always review/confirm the generated SQL before it runs, or auto-run after the safety gate passes?
5. **CA analytics access**: Should CA also have read access to NL analytics, or F&A only?
