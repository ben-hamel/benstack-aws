import { MAX_PAGE_BYTES } from "./product-evidence.ts";
import { UserError } from "./state.ts";

const LIMIT = 200_000;
const unresolved = () => new UserError("Incomplete raw page response from the page reader; product evidence is unresolved.");

/** Decode the pinned 0.41.0 MCP text contract. Continuations read subprocess memory,
 * not the network. Validate offsets/lengths so display truncation cannot become evidence.
 * MCP does not expose HTTP status or MIME metadata; do not invent either.
 */
export async function readMcpPage(
  texts: string[],
  continuation: (args: { responseId: string; urlIndex: number; offset: number; limit: number }) => Promise<string>,
): Promise<string> {
  const output = texts.join("\n");
  const reference = /responseId: "([A-Za-z0-9_-]+)", urlIndex: 0, offset: (\d+) \}\) (?:for the next slice|to retrieve it)\.\s*$/.exec(output);
  if (!reference) throw unresolved();
  const id = reference[1]!;
  const truncated = /\n\n---\nShowing (\d+) of (\d+) chars, \d+ of \d+ bytes, and \d+ of \d+ lines\. Use get_search_content\(/.exec(output);
  let html: string;
  let total: number;
  if (truncated) {
    // Only accept a metadata marker whose end offset agrees with the terminal hint.
    html = output.slice(0, truncated.index);
    total = Number(truncated[2]);
    if (html.length !== Number(truncated[1]) || html.length !== Number(reference[2]) || total <= html.length) throw unresolved();
  } else {
    // Untruncated results use a separate content item for the library's retrieval hint.
    const footer = texts.at(-1) ?? "";
    if (texts.length !== 2 || footer !== `\n---\nFull content is stored as responseId "${id}". Use get_search_content({ responseId: "${id}", urlIndex: 0, offset: 0 }) to retrieve it.`) throw unresolved();
    html = texts[0]!;
    total = html.length;
  }
  if (!Number.isSafeInteger(total) || total < 1 || total > MAX_PAGE_BYTES) throw unresolved();
  let pages = 0;
  while (html.length < total) {
    if (++pages > 384) throw unresolved();
    const offset = html.length;
    const page = await continuation({ responseId: id, urlIndex: 0, offset, limit: LIMIT });
    const headerEnd = page.indexOf("\n\n");
    const footer = /\n\n---\nShowing chars (\d+)-(\d+) of (\d+)\.(?: Use get_search_content\(\{ responseId: "([A-Za-z0-9_-]+)", urlIndex: 0, offset: (\d+), limit: 200000 \}\) for the next slice\.)?$/.exec(page);
    if (!page.startsWith("# ") || headerEnd < 0 || !footer) throw unresolved();
    const body = page.slice(headerEnd + 2, footer.index);
    const end = Number(footer[2]);
    if (Number(footer[1]) !== offset || Number(footer[3]) !== total || end <= offset || end > total
      || body.length !== end - offset || (end < total && (footer[4] !== id || Number(footer[5]) !== end))) throw unresolved();
    html += body;
    if (Buffer.byteLength(html, "utf8") > MAX_PAGE_BYTES) throw unresolved();
  }
  if (Buffer.byteLength(html, "utf8") > MAX_PAGE_BYTES) throw unresolved();
  return html;
}
