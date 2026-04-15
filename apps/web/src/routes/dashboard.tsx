import { createFileRoute, redirect } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { env } from "@benstack-aws/env/web";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
    return { session };
  },
  loader: async () => {
    const res = await fetch(`${env.VITE_SERVER_URL}/api/receipts`, {
      credentials: "include",
    });
    if (!res.ok) return { receipts: [] };
    return { receipts: (await res.json()) as Receipt[] };
  },
});

interface Receipt {
  id: string;
  transactionDate: string;
  storeName: string;
  storeCity: string;
  storeProvince: string;
  total: string;
  receiptType: string;
}

function RouteComponent() {
  const { session } = Route.useRouteContext();
  const { receipts } = Route.useLoaderData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Select a JSON file first.");
      return;
    }

    setUploading(true);
    try {
      // 1. Get presigned URL + jobId
      const presignRes = await fetch(`${env.VITE_SERVER_URL}/api/receipts/presign`, {
        method: "POST",
        credentials: "include",
      });
      if (!presignRes.ok) throw new Error("Failed to create upload job");
      const { uploadUrl } = (await presignRes.json()) as { jobId: string; uploadUrl: string };

      // 2. PUT file directly to S3
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/json" },
      });
      if (!putRes.ok) throw new Error("Failed to upload file to S3");

      setSubmitted(true);
      toast.success("Upload submitted — refresh the page in a moment to see your receipts.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="text-sm text-muted-foreground">Welcome, {session.data?.user.name}</p>

      {/* Upload */}
      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="font-medium">Upload Receipts</h2>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="text-sm"
            disabled={uploading}
          />
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        {submitted && (
          <p className="text-sm text-muted-foreground">
            File submitted. Refresh the page once processing is complete.
          </p>
        )}
      </section>

      {/* Receipts table */}
      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="font-medium">Receipts</h2>
        {receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No receipts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Store</th>
                  <th className="pb-2 pr-4">Location</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{r.transactionDate}</td>
                    <td className="py-2 pr-4">{r.storeName}</td>
                    <td className="py-2 pr-4">
                      {r.storeCity}, {r.storeProvince}
                    </td>
                    <td className="py-2 pr-4 capitalize">{r.receiptType.replace("_", " ")}</td>
                    <td className="py-2 text-right">${r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
