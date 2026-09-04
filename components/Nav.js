"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/tool", label: "Extract" },
  { href: "/benchmark", label: "Benchmark" },
  { href: "/explain", label: "How it works" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/3d-map", label: "3D Map" },
  { href: "/assistant", label: "AI Assistant" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-line px-6 py-3 flex items-center justify-between gap-4 sticky top-0 bg-ink/95 backdrop-blur z-30">
      <Link href="/" className="font-display font-extrabold text-sm tracking-tight flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-accent" />
        GeoGovGadget
      </Link>
      <div className="flex items-center gap-1 font-mono text-xs">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 rounded-full transition ${
                active ? "bg-surface2 text-accent2 border border-accent2/40" : "text-muted hover:text-[#e7ebf2]"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
