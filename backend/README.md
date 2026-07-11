# Backend — KFC Recurring Payment API

Node.js + Express + TypeScript + Prisma → **Amazon Aurora PostgreSQL** with **IAM DB authentication**.

## Secure connection (recommended)

See **[docs/aurora-iam.md](./docs/aurora-iam.md)** for the full checklist (DB user, `rds-db:connect`, TLS CA, migrate script).

```bash
cd backend
cp .env.example .env
# set DB_USER / DB_NAME to your IAM-enabled Postgres role + database
aws sts get-caller-identity
npx tsx scripts/test-iam-connection.ts
chmod +x scripts/prisma-iam.sh
./scripts/prisma-iam.sh migrate dev --name init
./scripts/prisma-iam.sh db seed
npm run dev
```

- Health: `GET http://localhost:3001/health`
- API base (Phase 1+): `http://localhost:3001/api`

Runtime uses `@aws-sdk/rds-signer` + `pg` Pool (`password: () => getAuthToken()`) + `@prisma/adapter-pg`. No static DB password is stored for Aurora.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Watch mode (`tsx`) |
| `npm run build` / `npm start` | Compile + run |
| `npm run lint` | `tsc --noEmit` |
| `npm run db:test-iam` | Probe Aurora IAM + TLS |
| `npm run prisma:migrate:iam` | Migrate with a fresh IAM token |
| `npm run prisma:seed:iam` | Seed with a fresh IAM token |
| `npm test` | Jest |

## Phase status

See [docs/plan-backend.md](../docs/plan-backend.md). Current slice: environment + IAM Aurora connection + Prisma schema + `/health`.
