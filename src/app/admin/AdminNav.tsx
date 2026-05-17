"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/admin/users", label: "用户" },
  { href: "/admin/prompt-reviews", label: "提示词评估" },
];

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-bar-nav">
      {NAV_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`admin-bar-link${pathname.startsWith(href) ? " admin-bar-link--active" : ""}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
