import { Link } from "@tanstack/react-router";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";
import { useResearchBadge } from "@/lib/product-research";
import { isResearchDemo } from "@/lib/demo-mode";
import { ResearchDemoBanner } from "./research-demo-banner";

export default function Header() {
  const pending = useResearchBadge();
  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/receipts", label: "Receipts" },
    { to: "/receipts-upload", label: "Upload (dev)" },
    { to: "/chat", label: "Chat" },
    { to: "/product-research", label: "Product research" },
  ] as const;

  return (
    <div>
      <ResearchDemoBanner />
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {links.filter(({ to }) => !isResearchDemo() || ["/receipts", "/receipts-upload", "/product-research"].includes(to)).map(({ to, label }) => {
            return (
              <Link key={to} to={to} className="cursor-pointer">
                {label}{to === "/product-research" && pending > 0 ? ` (${pending})` : ""}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}
