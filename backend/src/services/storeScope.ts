import type { UserRole } from "@prisma/client";

/**
 * Store visibility for list / coverage / approvals.
 * Demo: every role (including HOD) can view and act on all stores.
 * Returns null = no filter (all stores).
 */
export async function accessibleStoreIds(
  _userId: string,
  _role: UserRole,
): Promise<string[] | null> {
  return null;
}

export function storeScopeWhere(storeIds: string[] | null): {
  storeId?: { in: string[] };
} {
  if (storeIds === null) return {};
  return { storeId: { in: storeIds } };
}
