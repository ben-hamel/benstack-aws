import { env } from "@benstack-aws/env/web";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronUpIcon, FuelIcon, ReceiptTextIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/receipts")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

const SERVER_URL = env.VITE_SERVER_URL;

function formatCurrency(val: string | null) {
  if (!val) return "$0.00";
  const num = Number.parseFloat(val);
  return num < 0 ? `-$${Math.abs(num).toFixed(2)}` : `$${num.toFixed(2)}`;
}

function formatDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-");
  return `${month}/${day}/${year}`;
}

type Receipt = {
  id: string;
  storeName: string | null;
  storeCity: string | null;
  transactionDate: string;
  total: string;
  subtotal: string | null;
  instantSavings: string | null;
  receiptType: "warehouse" | "gas_station";
};

type ReceiptDetail = Receipt & {
  items: {
    id: string;
    type: string;
    description: string;
    amount: string;
    quantity: number;
    taxFlag: string | null;
    fuelQuantityLitres: string | null;
    fuelPricePerLitre: string | null;
  }[];
  tenders: {
    id: string;
    description: string | null;
    cardLast4: string | null;
    amount: string;
  }[];
  taxes: {
    id: string;
    legend: string;
    percent: string;
    amount: string;
  }[];
};

function receiptsQueryOptions() {
  return {
    queryKey: ["receipts"],
    queryFn: async (): Promise<Receipt[]> => {
      const res = await fetch(`${SERVER_URL}/api/receipts`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch receipts");
      return res.json();
    },
  };
}

function receiptDetailQueryOptions(id: string) {
  return {
    queryKey: ["receipts", id],
    queryFn: async (): Promise<ReceiptDetail> => {
      const res = await fetch(`${SERVER_URL}/api/receipts/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch receipt");
      return res.json();
    },
  };
}

function ReceiptRow({
  receipt,
  isOpen,
  onToggle,
}: {
  receipt: Receipt;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { data: detail, isLoading } = useQuery({
    ...receiptDetailQueryOptions(receipt.id),
    enabled: isOpen,
  });

  const isGas = receipt.receiptType === "gas_station";

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          {isGas ? <FuelIcon className="h-4 w-4" /> : <ReceiptTextIcon className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {receipt.storeName ?? "Unknown Store"}
              {receipt.storeCity && `, ${receipt.storeCity}`}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              {isGas ? "Gas" : "Warehouse"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{formatDate(receipt.transactionDate)}</p>
        </div>
        <span className="text-sm font-semibold tabular-nums">{formatCurrency(receipt.total)}</span>
        {isOpen ? (
          <ChevronUpIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {isOpen && (
        <div className="border-t px-4 py-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : detail ? (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Items</h4>
                <div className="space-y-1">
                  {detail.items
                    .filter((i) => i.type === "item" || i.type === "fuel")
                    .map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <span className="truncate flex-1 min-w-0">
                          {item.description}
                          {item.taxFlag === "Y" && (
                            <span className="ml-1 text-xs text-muted-foreground">T</span>
                          )}
                          {item.quantity !== 1 && (
                            <span className="text-muted-foreground ml-1">x{item.quantity}</span>
                          )}
                          {item.fuelQuantityLitres && (
                            <span className="text-muted-foreground ml-1">
                              ({item.fuelQuantityLitres}L @ ${item.fuelPricePerLitre}/L)
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums ml-2">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                </div>
              </div>

              {detail.items.some((i) => ["discount", "deposit", "eco_fee"].includes(i.type)) && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
                    Adjustments
                  </h4>
                  <div className="space-y-1">
                    {detail.items
                      .filter((i) => ["discount", "deposit", "eco_fee"].includes(i.type))
                      .map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between text-sm text-muted-foreground"
                        >
                          <span className="truncate">{item.description}</span>
                          <span className="tabular-nums ml-2">{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-2 space-y-1 text-sm">
                {detail.subtotal && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="tabular-nums">{formatCurrency(detail.subtotal)}</span>
                  </div>
                )}
                {detail.taxes.map((tax) => (
                  <div key={tax.id} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {tax.legend} ({tax.percent}%)
                    </span>
                    <span className="tabular-nums">{formatCurrency(tax.amount)}</span>
                  </div>
                ))}
                {detail.instantSavings && Number.parseFloat(detail.instantSavings) > 0 && (
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>Instant Savings</span>
                    <span className="tabular-nums">
                      -${Number.parseFloat(detail.instantSavings).toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(detail.total)}</span>
                </div>
              </div>

              {detail.tenders.length > 0 && (
                <div className="border-t pt-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
                    Payment
                  </h4>
                  {detail.tenders.map((t) => (
                    <div key={t.id} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {t.description ?? "Card"}{t.cardLast4 && ` ••••${t.cardLast4}`}
                      </span>
                      <span className="tabular-nums">{formatCurrency(t.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-destructive">Failed to load details</p>
          )}
        </div>
      )}
    </div>
  );
}

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function RouteComponent() {
  const { data: receipts = [], isLoading } = useQuery(receiptsQueryOptions());
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];

    if (!file.name.endsWith(".json")) {
      setUploadState({ status: "error", message: "Only .json files are supported." });
      return;
    }

    setUploadState({ status: "uploading" });

    try {
      const presignRes = await fetch(`${SERVER_URL}/api/receipts/presign`, {
        method: "POST",
        credentials: "include",
      });
      if (!presignRes.ok) throw new Error("Failed to create upload job");
      const { uploadUrl } = (await presignRes.json()) as { jobId: string; uploadUrl: string };

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/json" },
      });
      if (!putRes.ok) throw new Error("Failed to upload file to S3");

      setUploadState({
        status: "success",
        message: "Upload submitted — refresh in a moment to see your receipts.",
      });
    } catch (err) {
      setUploadState({ status: "error", message: err instanceof Error ? err.message : "Upload failed." });
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Receipts</h2>
          <p className="text-sm text-muted-foreground">
            {receipts.length} receipt{receipts.length !== 1 && "s"}
          </p>
        </div>
        <div>
          <button
            type="button"
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded border hover:bg-muted transition-colors disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
            disabled={uploadState.status === "uploading"}
          >
            <UploadIcon className="h-4 w-4" />
            {uploadState.status === "uploading" ? "Uploading..." : "Upload JSON"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>
      </div>

      {(uploadState.status === "success" || uploadState.status === "error") && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            uploadState.status === "error"
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400"
              : "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
          }`}
        >
          {uploadState.message}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading receipts...</p>
      ) : receipts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
          <ReceiptTextIcon className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium">No receipts yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload a JSON export from the Costco Chrome extension
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {receipts.map((r) => (
            <ReceiptRow
              key={r.id}
              receipt={r}
              isOpen={openId === r.id}
              onToggle={() => setOpenId((prev) => (prev === r.id ? null : r.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
