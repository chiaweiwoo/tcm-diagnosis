"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/admin/assessments", label: "评估记录" },
  { href: "/admin/activity",    label: "用户活动" },
  { href: "/admin/examples",    label: "样本库" },
  { href: "/admin/usage",       label: "Token 用量" },
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
