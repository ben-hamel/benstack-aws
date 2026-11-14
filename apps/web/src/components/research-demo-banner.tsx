import { useState } from "react";
import { isResearchDemo } from "@/lib/demo-mode";

export function ResearchDemoBanner() {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!isResearchDemo()) return null;
  return <aside aria-label="Disposable demo" className="border-b border-amber-500 bg-amber-100 text-amber-950 p-3 text-sm space-y-2">
    <p><strong>DISPOSABLE DEMO — FICTIONAL DATA ONLY.</strong> Fake owner session, in-memory database, simulated research. No real login, AWS upload, paid AI, or source-page fetching. Do not upload real receipts.</p>
    <p>1. Download the sample. 2. Upload that JSON on Receipts. 3. Review both fictional proposals in Product research.</p>
    <div className="flex items-center gap-4">
      <a className="underline font-semibold" href="/api/demo/sample" download="demo-receipts.json">Download demo receipt</a>
      <button className="border rounded px-2 py-1 disabled:opacity-50" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try {
          const response = await fetch("/api/demo/reset", { method: "POST" });
          if (!response.ok) throw new Error();
          window.location.assign("/receipts");
        } catch { setBusy(false); setError("Could not reset the demo. Restart the local demo process."); }
      }}>{busy ? "Resetting…" : "Reset demo"}</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </aside>;
}
