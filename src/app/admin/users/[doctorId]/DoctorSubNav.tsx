"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DoctorSubNav({ doctorId }: { doctorId: string }) {
  const pathname = usePathname();
  const isProfile = pathname.endsWith("/profile");

  return (
    <div className="doctor-subnav">
      <Link
        href={`/admin/users/${doctorId}`}
        className={`doctor-subnav__tab${!isProfile ? " doctor-subnav__tab--active" : ""}`}
      >
        病案列表
      </Link>
      <Link
        href={`/admin/users/${doctorId}/profile`}
        className={`doctor-subnav__tab${isProfile ? " doctor-subnav__tab--active" : ""}`}
      >
        评估快照
      </Link>
    </div>
  );
}
