import { createHash, createCipheriv, randomBytes } from "node:crypto";
import {
  ContractType,
  PrismaClient,
  UserRole,
  VendorType,
} from "@prisma/client";
import { Signer } from "@aws-sdk/rds-signer";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

function encryptAccount(plain: string): { enc: string; hash: string } {
  const keyHex =
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY ??
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const key = Buffer.from(keyHex.slice(0, 64), "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const enc = Buffer.concat([iv, tag, encrypted]).toString("base64");
  const hash = createHash("sha256").update(plain).digest("hex");
  return { enc, hash };
}

async function createPrisma(): Promise<{ prisma: PrismaClient; pool: Pool }> {
  const host = process.env.DB_HOST!;
  const port = Number(process.env.DB_PORT ?? 5432);
  const user = process.env.DB_USER!;
  const database = process.env.DB_NAME!;
  const region = process.env.AWS_REGION ?? "us-east-1";

  const signer = new Signer({ hostname: host, port, username: user, region });
  const pool = new Pool({
    host,
    port,
    user,
    database,
    password: () => signer.getAuthToken(),
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  return { prisma: new PrismaClient({ adapter: new PrismaPg(pool) }), pool };
}

const STORE_SEEDS = [
  { storeCode: "HN001", storeName: "KFC Hoan Kiem", region: "Hanoi", costCenterCode: "CC-HN-001", address: "Hoan Kiem, Ha Noi" },
  { storeCode: "HN002", storeName: "KFC Cau Giay", region: "Hanoi", costCenterCode: "CC-HN-002", address: "Cau Giay, Ha Noi" },
  { storeCode: "HN003", storeName: "KFC Long Bien", region: "Hanoi", costCenterCode: "CC-HN-003", address: "Long Bien, Ha Noi" },
  { storeCode: "HCM001", storeName: "KFC District 1", region: "HCMC", costCenterCode: "CC-HCM-001", address: "District 1, HCMC" },
  { storeCode: "HCM002", storeName: "KFC Thu Duc", region: "HCMC", costCenterCode: "CC-HCM-002", address: "Thu Duc, HCMC" },
  { storeCode: "HCM003", storeName: "KFC Tan Binh", region: "HCMC", costCenterCode: "CC-HCM-003", address: "Tan Binh, HCMC" },
  { storeCode: "DN001", storeName: "KFC Hai Chau", region: "Da Nang", costCenterCode: "CC-DN-001", address: "Hai Chau, Da Nang" },
  { storeCode: "DN002", storeName: "KFC Son Tra", region: "Da Nang", costCenterCode: "CC-DN-002", address: "Son Tra, Da Nang" },
  { storeCode: "HP001", storeName: "KFC Le Chan", region: "Hai Phong", costCenterCode: "CC-HP-001", address: "Le Chan, Hai Phong" },
  { storeCode: "CT001", storeName: "KFC Ninh Kieu", region: "Can Tho", costCenterCode: "CC-CT-001", address: "Ninh Kieu, Can Tho" },
];

const ROLE_USERS: Array<{ email: string; displayName: string; role: UserRole; department: string }> = [
  { email: "requester@kfc.vn", displayName: "Demo Requester", role: "REQUESTER", department: "Store Ops" },
  { email: "hod@kfc.vn", displayName: "Demo HOD", role: "HOD", department: "Business" },
  { email: "fa@kfc.vn", displayName: "Demo F&A", role: "FA", department: "Finance" },
  { email: "ca@kfc.vn", displayName: "Demo Chief Accountant", role: "CA", department: "Accounting" },
  { email: "cashier@kfc.vn", displayName: "Demo Cashier", role: "CASHIER", department: "Treasury" },
];

const VENDOR_SEEDS: Array<{
  vendorCode: string;
  legalName: string;
  normalizedName: string;
  taxId: string;
  vendorType: VendorType;
  bankName: string;
  accountNumber: string;
  accountName: string;
}> = [
  { vendorCode: "V-LAND-001", legalName: "Saigon Property Co.", normalizedName: "saigon property co", taxId: "0312345678", vendorType: "LANDLORD", bankName: "Vietcombank", accountNumber: "001100223344", accountName: "SAIGON PROPERTY CO" },
  { vendorCode: "V-LAND-002", legalName: "Hanoi Retail Land Ltd", normalizedName: "hanoi retail land ltd", taxId: "0109876543", vendorType: "LANDLORD", bankName: "Techcombank", accountNumber: "190335566778", accountName: "HANOI RETAIL LAND" },
  { vendorCode: "V-UTIL-001", legalName: "EVN Hanoi", normalizedName: "evn hanoi", taxId: "0100109106", vendorType: "UTILITY", bankName: "BIDV", accountNumber: "211100998877", accountName: "EVN HANOI" },
  { vendorCode: "V-UTIL-002", legalName: "Saigon Water Corp", normalizedName: "saigon water corp", taxId: "0301143785", vendorType: "UTILITY", bankName: "VietinBank", accountNumber: "102334455667", accountName: "SAIGON WATER CORP" },
  { vendorCode: "V-SVC-001", legalName: "CleanPro Services", normalizedName: "cleanpro services", taxId: "0311122233", vendorType: "SERVICE", bankName: "ACB", accountNumber: "188299001122", accountName: "CLEANPRO SERVICES" },
  { vendorCode: "V-SVC-002", legalName: "SecureGuard VN", normalizedName: "secureguard vn", taxId: "0314455667", vendorType: "SERVICE", bankName: "MB Bank", accountNumber: "066778899001", accountName: "SECUREGUARD VN" },
];

function contractTypeFor(vendorType: VendorType): ContractType {
  if (vendorType === "LANDLORD") return "RENT";
  if (vendorType === "UTILITY") return "UTILITY";
  if (vendorType === "SERVICE") return "SERVICE";
  return "OTHER";
}

function baseAmountFor(vendorType: VendorType, storeIndex: number): number {
  const jitter = (storeIndex % 5) * 500_000;
  if (vendorType === "LANDLORD") return 80_000_000 + jitter;
  if (vendorType === "UTILITY") return 10_000_000 + jitter;
  return 15_000_000 + jitter;
}

async function main() {
  const { prisma, pool } = await createPrisma();
  console.log("Seeding master data via IAM…");

  try {
    const stores = [];
    for (const s of STORE_SEEDS) {
      stores.push(
        await prisma.store.upsert({
          where: { storeCode: s.storeCode },
          create: s,
          update: s,
        }),
      );
    }

    for (const u of ROLE_USERS) {
      await prisma.user.upsert({
        where: { email: u.email },
        create: u,
        update: { displayName: u.displayName, role: u.role, department: u.department },
      });
    }

    const vendors = [];
    for (const v of VENDOR_SEEDS) {
      const { bankName, accountNumber, accountName, ...vendorData } = v;
      const vendor = await prisma.vendor.upsert({
        where: { vendorCode: vendorData.vendorCode },
        create: vendorData,
        update: vendorData,
      });
      vendors.push(vendor);

      const { enc, hash } = encryptAccount(accountNumber);
      const existing = await prisma.bankAccount.findFirst({
        where: { vendorId: vendor.id, accountNumberHash: hash },
      });
      if (!existing) {
        await prisma.bankAccount.create({
          data: {
            vendorId: vendor.id,
            bankName,
            bankCode: "VND",
            accountNumberEnc: enc,
            accountNumberHash: hash,
            accountName,
            isActive: true,
            verificationStatus: "VERIFIED",
            validFrom: new Date("2025-01-01"),
          },
        });
      }
    }

    // ~store × vendor sample contracts (demo scale toward ~255)
    let contractCount = 0;
    for (let si = 0; si < stores.length; si++) {
      const store = stores[si]!;
      for (let vi = 0; vi < vendors.length; vi++) {
        const vendor = vendors[vi]!;
        contractCount += 1;
        const contractNumber = `CTR-${store.storeCode}-${vendor.vendorCode}`;
        await prisma.contract.upsert({
          where: { contractNumber },
          create: {
            contractNumber,
            storeId: store.id,
            vendorId: vendor.id,
            contractType: contractTypeFor(vendor.vendorType),
            startDate: new Date("2025-01-01"),
            endDate: new Date("2027-12-31"),
            baseAmount: baseAmountFor(vendor.vendorType, si),
            currency: "VND",
            billingRules: { frequency: "MONTHLY", dueDay: 5 },
            taxRules: { vatRate: 0.1 },
            status: "ACTIVE",
            currentVersion: 1,
          },
          update: {
            baseAmount: baseAmountFor(vendor.vendorType, si),
            status: "ACTIVE",
          },
        });
      }
    }

    console.log(
      `Seeded ${stores.length} stores, ${ROLE_USERS.length} users, ${vendors.length} vendors, ` +
        `${vendors.length} bank accounts, ${contractCount} contracts`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
