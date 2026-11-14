import { createFileRoute, redirect } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { productFields, type InboxDetail, type InboxPage, type ProductField } from "@benstack-aws/product-research/contracts";
import { authClient } from "@/lib/auth-client";
import { researchApi, useResearchScope } from "@/lib/product-research";
import { ResearchEvidence } from "@/components/product-research-evidence";
import { isResearchDemo } from "@/lib/demo-mode";
import { randomId } from "@/lib/random-id";

export const Route = createFileRoute("/product-research")({ component: ResearchInbox,
  validateSearch: (input: Record<string, unknown>) => ({ request: typeof input.request === "string" && /^[0-9a-f-]{36}$/i.test(input.request) ? input.request : undefined }),
  beforeLoad: async () => { if (!(await authClient.getSession()).data) redirect({ to: "/login", throw: true }); } });
const labels: Record<ProductField, string> = { name: "Product name", brand: "Brand", variant: "Variant", sizeText: "Size (quoted)", packText: "Pack (quoted)" };
const button = "rounded border px-3 py-2 text-sm disabled:opacity-50 hover:bg-muted";

function ResearchInbox() {
  const scope = useResearchScope(), search = Route.useSearch();
  const [state, setState] = useState("awaiting_review"), [selected, setSelected] = useState<string | null>(search.request ?? null);
  useEffect(() => { setSelected(search.request ?? null); }, [scope.scopeKey, search.request]);
  const list = useInfiniteQuery({
    queryKey: ["product-research", scope.scopeKey, "list", state], initialPageParam: "",
    queryFn: ({ pageParam }) => researchApi<InboxPage>(`?${new URLSearchParams({ ...(state ? { state } : {}), ...(pageParam ? { cursor: pageParam } : {}) })}`),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(scope.scopeKey) && !scope.isError, refetchInterval: 5_000,
  });
  const detail = useQuery({ queryKey: ["product-research", scope.scopeKey, "detail", selected],
    queryFn: () => researchApi<InboxDetail>(`/${selected}`), enabled: Boolean(selected && scope.scopeKey) && !scope.isError, refetchInterval: 5_000 });
  if (scope.isError) return <p className="p-6 text-destructive">Unable to verify your organization. Refresh or sign in again.</p>;
  if (!scope.data) return <p className="p-6">Checking your organization…</p>;
  return <main className="p-6 max-w-6xl mx-auto space-y-4">
    <h1 className="text-2xl font-semibold">Product research</h1>
    <p className="text-sm text-muted-foreground">Research produces proposals, not approved facts. Original receipts and spending categories are unchanged.</p>
    <p className="text-sm">{list.data?.pages[0]?.counts.awaiting_review ?? 0} awaiting review. {isResearchDemo() ? "This demo automatically supplies fictional research results; no AI or websites are called." : "Queued requests run when the Research Worker is enabled. Paused requests need an explicit research request. Results always require your review."}</p>
    <label className="flex gap-2 items-center">Show
      <select className={button} value={state} onChange={(event) => { setState(event.target.value); setSelected(null); }}>
        <option value="">All requests</option>
        {["awaiting_review", "queued", "paused", "running", "unresolved", "failed", "approved", "rejected", "cancelled"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
      </select>
    </label>
    {list.isError && <p role="alert" className="text-destructive">Could not load research. <button className={button} onClick={() => void list.refetch()}>Retry</button></p>}
    <div className="grid md:grid-cols-[18rem_1fr] gap-6">
      <section aria-label="Research requests" className="space-y-2">
        {list.data?.pages.flatMap((page) => page.items).map((item) => <button key={item.id} className={`${button} w-full text-left ${selected === item.id ? "bg-muted" : ""}`} onClick={() => setSelected(item.id)}>
          <strong>SKU {item.sku}</strong><span className="block">{item.name ?? "No proposed identification"}</span>
          <span className="block text-muted-foreground">{item.state.replaceAll("_", " ")} · attempt {item.generation}</span>
        </button>)}
        {!list.isPending && !list.data?.pages[0]?.items.length && <p className="text-sm">No requests in this view.</p>}
        {list.hasNextPage && <button className={button} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</button>}
      </section>
      <section aria-label="Research details">
        {!selected ? <p>Select a request to see evidence and decisions.</p> : detail.isError ? <p role="alert">Could not load this request. Refresh the list.</p>
          : detail.data ? <ReviewDetail key={`${scope.scopeKey}:${detail.data.id}:${detail.data.revision}:${detail.data.state}`} detail={detail.data} /> : <p>Loading request…</p>}
      </section>
    </div>
  </main>;
}

function ReviewDetail({ detail }: { detail: InboxDetail }) {
  const client = useQueryClient();
  const [fields, setFields] = useState<ProductField[]>([]), [reason, setReason] = useState(""), [weak, setWeak] = useState(false), [cost, setCost] = useState(false);
  const [keys] = useState(() => ({ approve: randomId(), reject: randomId(), "research-again": randomId() }));
  const mutation = useMutation({ mutationFn: (action: "approve" | "reject" | "research-again") => researchApi<{ state: string }>(`/${detail.id}/${action}`,
    action === "research-again" ? { idempotencyKey: keys[action], acknowledgeCost: true }
      : { revision: detail.revision, expectedProductVersion: detail.expectedProductVersion, idempotencyKey: keys[action],
        ...(action === "approve" ? { fields, acknowledgeWeakEvidence: weak } : { reason }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["product-research"] }); await client.invalidateQueries({ queryKey: ["receipts"] }); },
    onError: () => { void client.invalidateQueries({ queryKey: ["product-research"] }); },
  });
  const result = detail.result, canReview = detail.canDecide && detail.state === "awaiting_review";
  return <div className="space-y-4 rounded border p-4">
    <h2 className="text-lg font-semibold">SKU {detail.sku}</h2>
    <p>Status: {detail.state.replaceAll("_", " ")}{detail.reason ? ` (${detail.reason})` : ""}</p>
    {detail.receipts.map((receipt, index) => <p key={`${receipt.receiptId}:${index}`} className="text-sm">Receipt description: {receipt.description}</p>)}
    {result && <>
      <p>Evidence: {result.evidenceStatus.replaceAll("_", " ")}. Human review is required.</p>
      <ul className="list-disc pl-5 text-sm">{result.flags.map((flag, i) => <li key={i}>{flag}</li>)}</ul>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th>Select</th><th>Field</th><th>Approved now</th><th>Proposed</th></tr></thead>
        <tbody>{productFields.map((field) => <tr key={field} className="border-t">
          <td><input type="checkbox" aria-label={`Approve ${labels[field]}`} checked={fields.includes(field)} disabled={!canReview || !result.fields[field] || mutation.isPending}
            onChange={(event) => setFields(event.target.checked ? [...fields, field] : fields.filter((value) => value !== field))} /></td>
          <td className="p-2">{labels[field]}</td><td className="p-2">{detail.current?.[field] ?? "Unknown"}</td><td className="p-2">{result.fields[field]?.value ?? "Unknown / unresolved"}</td>
        </tr>)}</tbody></table></div>
      <h3 className="font-semibold">Sources and quotes</h3>
      <ResearchEvidence sources={result.sources} demo={isResearchDemo()} />
    </>}
    {canReview && <div className="space-y-3 border-t pt-3">
      {result?.evidenceStatus !== "direct_sku_match" && <label className="block text-sm"><input type="checkbox" checked={weak} onChange={(e) => setWeak(e.target.checked)} /> I understand this identification lacks direct-page SKU evidence.</label>}
      {detail.expectedProductVersion !== detail.proposalProductVersion && <p className="text-sm">Approved data changed after this research. Reject the stale proposal, then request fresh research; it cannot overwrite the newer product.</p>}
      <button className={button} disabled={!fields.length || mutation.isPending || detail.expectedProductVersion !== detail.proposalProductVersion || (result?.evidenceStatus !== "direct_sku_match" && !weak)} onClick={() => mutation.mutate("approve")}>Approve selected fields</button>
      <label className="block text-sm">Reason for rejection<textarea className="block border rounded w-full p-2" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button className={button} disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate("reject")}>Reject proposal</button>
    </div>}
    {detail.canDecide && ["paused", "failed", "unresolved", "rejected", "approved", "cancelled"].includes(detail.state) && <div className="border-t pt-3 space-y-2">
      <label className="block text-sm"><input type="checkbox" checked={cost} onChange={(e) => setCost(e.target.checked)} /> Research consumes model/search allowance when a worker is running. I want to queue this request.</label>
      <button className={button} disabled={!cost || mutation.isPending} onClick={() => mutation.mutate("research-again")}>{detail.state === "paused" ? "Queue research" : "Request research again"}</button>
    </div>}
    {!detail.canDecide && <p className="text-sm">Only your organization’s owner or admin can approve, reject, or request research.</p>}
    {mutation.isError && <p role="alert" className="text-destructive">{mutation.error.message} Refresh if the proposal changed; no automatic retry was sent.</p>}
    {mutation.isSuccess && <p role="status">Saved: {mutation.data.state.replaceAll("_", " ")}</p>}
    {!!detail.decisions.length && <><h3 className="font-semibold">Decision history</h3>{detail.decisions.map((decision, i) => <p key={i} className="text-sm">{decision.action} · {decision.createdAt} · actor {decision.actorUserId ?? "deleted user"} · {decision.selectedFields.join(", ")}{decision.reason ? ` · ${decision.reason}` : ""}</p>)}</>}
  </div>;
}
