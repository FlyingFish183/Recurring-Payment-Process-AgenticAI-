# ChatGPT Canvas — Hackathon Slide Deck Prompt

**How to use**
1. Open ChatGPT (with Canvas / slides capability).
2. Paste everything under **PROMPT (copy from here)** into a new chat.
3. Optionally attach your demo screenshots or architecture images afterward and ask Canvas to place them on the matching slides.

---

## PROMPT (copy from here)

```text
Create a polished hackathon presentation in Canvas (slide deck), not a long essay.

PROJECT TITLE
KFC Vietnam — Recurring Payment Process Automation (Agentic AI)

CONTEXT
KFC Vietnam processes ~300 recurring payment requests per month across 250+ restaurants. Each request bundles multiple line items (rent, electricity, water, service fees). Today the process is a fully manual 5-level paper chain:

Requester → HOD → F&A → CA → Cashier

Pain: invoice re-keying, duplicate-payment risk, weak audit trail, ~2 days of monthly closing work.

GOAL / SUCCESS METRIC
Digitize and automate the pipeline to cut end-to-end cycle time by ~80% and closing time from ~2 days to under ~2 hours.

WHAT WE BUILT (DEMO PRODUCT — emphasize these as shipped capabilities)
1) Multi-line payment requests with PDF/XML invoice upload
2) Document intelligence: AWS Textract OCR + XML e-invoice parsing → structured PaymentRequest / PaymentLine fields in Aurora PostgreSQL (raw files in S3)
3) Rule-based validation engine (no LLM for validation):
   - Duplicate invoice detection (BLOCKING)
   - Vendor match (seller name / tax ID vs master)
   - Bank match (OCR account vs vendor bank master; ownership, active/validity, beneficiary name)
   - Contract checks (store–vendor contract presence, expense↔contract type, amount ±15%, invoice date in period, anomalies)
   - Document completeness + tax arithmetic
4) Blocking findings hold the request out of auto-approval routing
5) Digital approval workflow: HOD → F&A → CA → Cashier
6) Digital signatures for CA & Cashier (HMAC demo / optional AWS KMS), with verifyable signature records
7) Monthly coverage board: compulsory RENT / ELECTRICITY / WATER / SERVICE_FEE — paid vs missing per store/month
8) Master data for F&A + CA: add/delete vendors, bank accounts, contracts (safe deactivate when in use)
9) Analytics chat for CA & Cashier (OpenAI): natural-language Q&A + safe read-only SQL / coverage analytics (e.g. “what has store HN01 paid vs not paid in 2026-06?”)
10) Full audit trail of actions

TECH STACK (one architecture slide)
Frontend: Next.js + React + TypeScript + Tailwind
Backend: Node.js + Express + TypeScript + Prisma
Data: Amazon Aurora PostgreSQL (IAM auth)
AWS: S3, Textract, SQS worker, optional KMS
Auth: mock Entra roles for demo (Requester / HOD / FA / CA / Cashier)
AI: OpenAI for analytics chat (text-to-SQL + narrative); Textract for OCR; deterministic rules for validation

ROLES (keep visible on workflow slide)
1 Requester — create request, upload invoices, submit
2 HOD — business approve / reject / request changes
3 F&A — finance review + master data
4 CA — accounting control + digital sign + analytics chat
5 Cashier — final authorize + digital sign + settlement handoff

SLIDE STRUCTURE (exactly 10–12 slides — concise)
1. Title + tagline (Agentic AI for recurring store payments)
2. Problem — scale, paper chain, 2-day close, risks
3. Vision & success metrics
4. Solution overview — end-to-end pipeline diagram (upload → extract → validate → approve → pay/export)
5. Architecture — frontend / API / Aurora / S3 / Textract / worker / OpenAI chat
6. Document intelligence — OCR/XML → structured lines (before/after story)
7. Rule-based validation — highlight bank + contract + duplicate (show severity: INFO/WARNING/HIGH/BLOCKING)
8. Approval workflow + digital signature (CA/Cashier)
9. Monthly coverage + analytics chat (NL → answer + data)
10. Master data & control (vendors / banks / contracts)
11. Demo flow (60–90 second script bullets)
12. Impact, next steps, ask / thank you

DESIGN DIRECTIONS FOR CANVAS
- Brand feel: KFC-inspired but professional finance/ops (deep red accent #E4002B, dark ink, warm off-white paper background — NOT purple AI cliché, NOT cream+terracotta cliché)
- Clean corporate hackathon style: large headlines, short bullets (max 5 per slide), generous whitespace
- Prefer simple diagrams and process arrows over dense text
- Use icons sparingly; no emoji spam
- Each slide: one clear message in the title
- Include speaker notes under each slide (2–4 sentences) so I can present without reading bullets

DEMO SCRIPT (put on slide 11)
1. Login as Requester → create multi-line request → upload invoices → auto extract/validate
2. Show validation banners (duplicate / bank / contract)
3. Login as HOD → approve → F&A approve
4. Login as CA → Sign & approve (digital signature)
5. Cashier → Sign & approve
6. Open Monthly coverage
7. Open analytics chat: “What has store HN01 paid vs not paid in 2026-06?”
8. Master Data: add a bank account / contract as FA or CA

CONSTRAINTS
- Do not invent enterprise features we did not list (no live ERP connector, no real Entra SSO in MVP)
- Prefer “built / demo-ready” language over vaporware
- Keep technical accuracy: validation is rule-based; chat uses OpenAI; OCR uses Textract

OUTPUT
Generate the full slide deck in Canvas now. After the deck is ready, also give me a one-paragraph pitch I can say in 30 seconds.
```

---

## Optional follow-ups (paste after the deck exists)

**Tighten for judges**
```text
Shorten every slide to ≤4 bullets and make slide titles more outcome-oriented for business judges (ops + finance), not engineers.
```

**Add architecture visual**
```text
On the architecture slide, redraw a left-to-right flow: Browser → Next.js → Express API → Aurora; parallel paths S3+Textract worker and OpenAI analytics chat; mark rule engine beside validation.
```

**Speaker-only mode**
```text
Expand speaker notes into a 3-minute talk track with timing cues per slide.
```
