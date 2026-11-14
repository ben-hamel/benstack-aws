import { productFields, safeSourceUrl, type ResearchResult } from "@benstack-aws/product-research/contracts";

export function ResearchEvidence({ sources, demo = false }: { sources: ResearchResult["sources"]; demo?: boolean }) {
  return <>{sources.map((source) => <div key={source.id} className="text-sm rounded border p-2 space-y-1">
    {demo ? <span>Synthetic source, not fetched: {source.url}</span> : safeSourceUrl(source.url) ? <a className="underline break-all" href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a> : <span>Unsupported source link withheld</span>}
    <p>{source.kind.replaceAll("_", " ")} · observed {source.observedAt} · SKU {source.sku}</p>
    {productFields.filter((field) => source.quotes[field]).map((field) => <p key={field}>{field}: “{source.quotes[field]}”</p>)}
  </div>)}</>;
}
