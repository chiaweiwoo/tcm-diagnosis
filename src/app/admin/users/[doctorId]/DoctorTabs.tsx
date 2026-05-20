"use client";

import { useRouter, useSearchParams } from "next/navigation";

const TABS = [
  { key: "profile", label: "临床画像" },
  { key: "records", label: "病例列表" },
] as const;

export function DoctorTabs({ doctorId }: { doctorId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "profile";

  function goTab(key: string) {
    router.push(`/admin/users/${doctorId}?tab=${key}`);
  }

  return (
    <div className="doctor-tabs">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`doctor-tab-btn${activeTab === tab.key ? " active" : ""}`}
          onClick={() => goTab(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
