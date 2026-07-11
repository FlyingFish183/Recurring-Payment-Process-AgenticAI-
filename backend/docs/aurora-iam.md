# Aurora IAM (hackathon)

Use your AWS credentials (`aws configure`). App gets a short-lived DB token — no DB password in `.env`.

```bash
cd backend
cp .env.example .env   # already points at your cluster + postgres user
npx tsx scripts/test-iam-connection.ts
npm run dev
```
