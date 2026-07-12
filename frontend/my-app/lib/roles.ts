import type { UserRole } from "./types";

export const WORKFLOW_ROLES: UserRole[] = [
  "REQUESTER",
  "HOD",
  "FA",
  "CA",
  "CASHIER",
];

export const ROLE_LABELS: Record<UserRole, { title: string; team: string }> = {
  REQUESTER: { title: "Requester", team: "Store Ops" },
  HOD: { title: "Head of Department", team: "Business" },
  FA: { title: "Finance & Accounting", team: "Finance" },
  CA: { title: "Chief Accountant", team: "Accounting" },
  CASHIER: { title: "Cashier", team: "Treasury" },
};

export type NavItem = {
  href: string;
  label: string;
  roles?: UserRole[];
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/coverage", label: "Monthly coverage" },
  { href: "/payment-requests", label: "Payment Inbox" },
  { href: "/approvals", label: "Approvals", roles: ["HOD", "FA", "CA", "CASHIER"] },
  { href: "/payment-requests/new", label: "Create Request", roles: ["REQUESTER"] },
  { href: "/master-data", label: "Master Data", roles: ["FA", "CA"] },
];

export function canAccess(role: UserRole, item: NavItem): boolean {
  if (!item.roles) return true;
  return item.roles.includes(role);
}
