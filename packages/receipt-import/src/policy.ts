export interface AdmissionPolicy {
  enabled: boolean;
  organizationIds: readonly string[];
  globalDailyLimit: number;
  organizationDailyLimit: number;
  globalPendingLimit: number;
  organizationPendingLimit: number;
}

export function admissionPolicy(environment: Record<string, string | undefined> = process.env): AdmissionPolicy {
  // Enabling admission only queues jobs. It never enables paid execution.
  return {
    enabled: environment.PRODUCT_RESEARCH_ADMISSION_ENABLED === "true",
    organizationIds: (environment.PRODUCT_RESEARCH_ORGANIZATION_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
    globalDailyLimit: 20, organizationDailyLimit: 20,
    globalPendingLimit: 1_000, organizationPendingLimit: 1_000,
  };
}
