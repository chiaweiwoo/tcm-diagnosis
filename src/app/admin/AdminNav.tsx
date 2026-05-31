"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/admin/users", label: "用户" },
  { href: "/admin/output-audits", label: "AI 输出审查" },
  { href: "/admin/prompts", label: "提示词" },
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
