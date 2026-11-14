import { env } from "@benstack-aws/env/web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { authClient } from "./auth-client";
import type { InboxPage } from "@benstack-aws/product-research/contracts";

export async function researchApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${env.VITE_SERVER_URL}/api/product-research${path}`, {
    credentials: "include", ...(body !== undefined ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Research request failed.");
  return data as T;
}
export function useResearchScope() {
  const session = authClient.useSession(), client = useQueryClient();
  const rawSession = session.data?.session;
  const active = rawSession && "activeOrganizationId" in rawSession ? String(rawSession.activeOrganizationId ?? "") : "";
  const context = useQuery({
    queryKey: ["research-context", session.data?.user.id, rawSession?.id, active],
    queryFn: () => researchApi<{ userId: string; organizationId: string; canDecide: boolean }>("/context"),
    enabled: Boolean(session.data?.user), staleTime: 0, refetchInterval: 15_000, retry: false,
  });
  const key = context.data ? `${context.data.userId}:${context.data.organizationId}` : null;
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current && previous.current !== key) {
      void client.cancelQueries({ queryKey: ["product-research", previous.current] });
      client.removeQueries({ queryKey: ["product-research", previous.current] });
      void client.cancelQueries({ queryKey: ["receipts"] });
      client.removeQueries({ queryKey: ["receipts"] });
    }
    previous.current = key;
  }, [key, client]);
  return { ...context, scopeKey: key, authenticated: Boolean(session.data?.user) };
}
export function useResearchBadge() {
  const scope = useResearchScope();
  const query = useQuery({ queryKey: ["product-research", scope.scopeKey, "badge"],
    queryFn: () => researchApi<InboxPage>("?state=awaiting_review"),
    enabled: Boolean(scope.scopeKey) && !scope.isError, refetchInterval: 10_000, retry: false });
  return scope.authenticated && !scope.isError ? query.data?.counts.awaiting_review ?? 0 : 0;
}
