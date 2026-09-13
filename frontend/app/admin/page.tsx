"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isAuthConfigured } from "@/lib/supabase";
import AdminUsersTab from "@/components/AdminUsersTab";
import AdminDataTab from "@/components/AdminDataTab";

const TABS = ["Users", "Data"] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("Users");

  useEffect(() => {
    if (!isAuthConfigured() || !supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push("/login");
    });
  }, [router]);

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-lg font-bold text-slate-900">Beta Admin</h1>
          <p className="text-xs text-slate-500">Invite-only beta — manage seats and check on data loads here.</p>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm w-fit">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "Users" && <AdminUsersTab />}
        {activeTab === "Data" && <AdminDataTab />}
      </div>
    </div>
  );
}
