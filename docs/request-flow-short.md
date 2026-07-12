# Request flow (short)

## 1. Create & submit
Requester creates a payment request (store + period + lines), uploads invoice PDF/XML per line, then submits.

## 2. Extract
An async worker picks up the job:
- **XML** → parse e-invoice fields  
- **PDF/image** → AWS Textract OCR  

Extracted amounts, invoice number/date, seller, tax ID, bank hints are written onto each payment line.

## 3. Rule-based validation (`base_rule`)
Deterministic checks (no LLM) against master data and history:

| Rule | What it checks |
|------|----------------|
| Duplicate | Same invoice already paid / in another request |
| Vendor match | OCR seller / tax ID vs selected vendor |
| Bank match | OCR account vs vendor bank master (link, ownership, active) |
| Contract | Store–vendor contract, expense type, amount ±15%, invoice date in period |
| Completeness / tax | Missing fields, net + tax ≠ gross |
| Amount anomaly | Far from contract base or paid history |

**BLOCKING** (e.g. duplicate) → request stays **READY**, not sent to approval.  
Otherwise → auto-routes to **HOD**.

## 4. Approval chain
`HOD → F&A → CA → Cashier`  
CA and Cashier must **digitally sign** when approving.

## 5. Analytics chat (CA & Cashier only)
Right-side chat (icon → panel):
- Ask in plain English (e.g. “What has store HN01 paid vs not paid in 2026-06?”)
- OpenAI answers in text
- Uses coverage board and/or safe read-only SQL
- Shows supporting table (+ SQL when used)

**Not for** Requester / HOD / F&A — only the last two roles.
