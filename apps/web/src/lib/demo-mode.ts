/** Only the isolated launcher defines this flag. Require a same-origin API
 * on loopback or a specific Tailscale IPv4 address.
 */
export function isResearchDemo(): boolean {
  if (typeof window === "undefined" || import.meta.env?.VITE_RESEARCH_DEMO !== "true") return false;
  try {
    const host = window.location.hostname;
    const octets = host.split(".").map(Number);
    const tailscale = octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
      && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
    return (host === "127.0.0.1" || tailscale)
      && new URL(import.meta.env.VITE_SERVER_URL).origin === window.location.origin;
  } catch { return false; }
}
