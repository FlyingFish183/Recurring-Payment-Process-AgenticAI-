# Problem Statement: Recurring Payment Processing for a 250+ Store QSR Chain

**Project**: KFC Vietnam — Recurring Payment Process Automation (Agentic AI)  
**Related**: [spec.md](./spec.md) · [plan.md](./plan.md)

---

## Create project

**P1) Recurring payment processing for a 250+ store QSR chain**

Recurring store payments are handled through a manual paper-based approval chain, with invoice re-keying, duplicate-payment risk, and limited audit trail.

---

## Problem statement

KFC Vietnam processes about **300 recurring payment requests per month** across **250+ restaurants**. Each request bundles multiple expense items such as rental, electricity, water, service fees and more, so the line-item volume is much higher than the request count.

Everything runs through a fully manual, **5-level paper-based approval chain**:

**Requester → HOD → F&A → CA → Cashier**

Invoice data is re-keyed by hand, duplicate payments are hard to detect, and journal entries are manually mapped into the legacy accounting system.

The process is slow, error-prone, leaves no audit trail, and overloads the finance team during the monthly cycle. **Closing the monthly payment cycle takes about 2 days of manual work.**

---

## Relevant AI technologies

- Computer Vision / OCR
- Document Intelligence for PDFs, forms, contracts and invoices
- Anomaly Detection / Fraud Detection
- Robotic Process Automation

---

## Expected outcomes / success metrics

Cut end-to-end payment-request cycle time by about **80%** by replacing the paper-based 5-level approval chain with a digital workflow.

Additional targets (see [spec.md](./spec.md)):

- Reduce closing time from **~2 days to under 2 hours**
- Structured invoice persistence (no re-keying)
- Duplicate and anomaly flags before approval
- Full digital audit trail per actor
- Accounting handoff via mapped journal export

---

## Current solutions

The current process is fully manual. Payment dossiers are printed and physically signed in sequence by 5 roles, invoice data is re-keyed by hand, and journal entries are manually mapped into legacy accounting software.

The team relies on **Excel and email** with no dedicated workflow tool.

---

## Target users / teams impacted

- Accounting team
- Finance team
- Business function teams

Mapped to process actors in the product (see [plan.md](./plan.md)):

| Step | Actor | Team context | Product ownership |
|------|--------|----------------|-------------------|
| 1 | Requester | Business / store function | Upload invoice (PDF/XML), create & submit payment request |
| 2 | HOD | Business function leadership | Business approve / reject |
| 3 | F&A | Finance + Accounting | Finance approve / reject; master data; NL analytics |
| 4 | CA | Chief Accountant | Accounting mapping & journal readiness; digital sign |
| 5 | Cashier | Accounting / treasury | Final pay authorization; payment settlement; journal handoff |

There is **no separate Admin role for the MVP workflow** — these five actors are the process roles. Full entity model: [plan.md](./plan.md) (from Technical Blueprint v1.1).

---

## Data availability & readiness

### Structured data

- About **255 active contracts**
- Vendor and bank-account master data
- About **300 payment requests per month** for rental, electricity, water and service fees

### Unstructured data

- E-invoices in **XML** format, about **100 per month**
- Contracts and supporting documents stored as **PDFs**

### Readiness

The data is **internal**, available today, and organized per store using **StoreID**, so it is ready for AI document extraction, duplicate detection, and anomaly analysis.

---

## Integration, deployment, and infrastructure requirements

- Microsoft Entra ID integration
- Digital Signature integration
- Customer data protection compliance

See [spec.md](./spec.md) for tech stack (Aurora PostgreSQL, S3, Textract, Bedrock, etc.).

---

## Build direction

Build a **document-intelligence and workflow automation** system for:

1. Payment request creation and digital dossier
2. Invoice extraction (PDF / XML) into structured data
3. Approval routing across the 5 actors
4. Duplicate checks and anomaly analysis
5. Accounting handoff (journal export to legacy systems)

Implementation plans: [plan-backend.md](./plan-backend.md) · [plan-frontend.md](./plan-frontend.md)
