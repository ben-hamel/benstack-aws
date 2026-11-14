import { isIP } from "node:net";

// Fake-auth demo: accept loopback or a specific Tailscale IPv4, never wildcard/public bindings.
export function demoHost(host: string): string {
  const octets = host.split(".").map(Number);
  if (host === "127.0.0.1" || (isIP(host) === 4 && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127)) return host;
  throw new Error("Choose 127.0.0.1 or a specific Tailscale IPv4 address for the demo host.");
}
