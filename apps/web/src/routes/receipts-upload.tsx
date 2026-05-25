import { env } from "@benstack-aws/env/web";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/receipts-upload")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

const SERVER_URL = env.VITE_SERVER_URL;

type UploadResult = { imported: number; skipped: number; total: number };

type State =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "done"; result: UploadResult }
  | { status: "error"; message: string };

function RouteComponent() {
  const [state, setState] = useState<State>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];

    if (!file.name.endsWith(".json")) {
      setState({ status: "error", message: "Only .json files are supported." });
      return;
    }

    setState({ status: "uploading" });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${SERVER_URL}/api/receipts/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Upload failed");
      }

      const result = (await res.json()) as UploadResult;
      setState({ status: "done", result });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Upload failed." });
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  const busy = state.status === "uploading";

  return (
    <div className="mx-auto max-w-lg p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Direct Receipt Upload</h2>
        <p className="text-sm text-muted-foreground">Dev tool — uploads directly to the server (no S3).</p>
      </div>

      <button
        type="button"
        className="flex items-center gap-2 text-sm px-3 py-1.5 rounded border hover:bg-muted transition-colors disabled:opacity-50"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        <UploadIcon className="h-4 w-4" />
        {busy ? "Uploading..." : "Upload JSON"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />

      {state.status === "done" && (
        <div className="rounded-lg border p-3 text-sm border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
          {state.result.imported} imported, {state.result.skipped} skipped (of {state.result.total} total).
        </div>
      )}

      {state.status === "error" && (
        <div className="rounded-lg border p-3 text-sm border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {state.message}
        </div>
      )}
    </div>
  );
}
