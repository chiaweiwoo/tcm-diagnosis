"use client";

import Link from "next/link";

export function ViewAsBanner({
  doctorId,
  email,
}: {
  doctorId: string;
  email: string;
}) {
  return (
    <div className="view-as-banner" role="status" aria-live="polite">
      <span className="view-as-banner__text">
        工作台预览：以 {email} 身份查看（只读模式）
      </span>
      <Link href={`/admin/users/${doctorId}`} className="view-as-banner__exit">
        退出
      </Link>
    </div>
  );
}
