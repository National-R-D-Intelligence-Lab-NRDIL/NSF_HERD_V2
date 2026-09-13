"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isAuthConfigured } from "@/lib/supabase";
import { listAdminUsers, inviteAdminUser, removeAdminUser, updateAdminUser } from "@/lib/api";
import type { AdminUser } from "@/lib/types";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

// <input type="date"> needs YYYY-MM-DD; access_expires_at is stored as a
// full ISO timestamp (end-of-day UTC on the selected date).
function toDateInputValue(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function isExpired(value: string | null) {
  return !!value && new Date(value).getTime() < Date.now();
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteInfo, setInviteInfo] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthConfigured() || !supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push("/login");
    });
  }, [router]);

  const loadUsers = () => {
    setError("");
    listAdminUsers()
      .then(setUsers)
      .catch((e: Error) => {
        if (e.message.startsWith("403")) setForbidden(true);
        else setError(e.message);
      });
  };

  useEffect(loadUsers, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setError("");
    setInviteInfo("");
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      await inviteAdminUser(inviteEmail, redirectTo);
      setInviteInfo(`Invite sent to ${inviteEmail}.`);
      setInviteEmail("");
      loadUsers();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInviting(false);
    }
  };

  const handleToggleAi = async (user: AdminUser) => {
    setSavingId(user.id);
    setError("");
    try {
      await updateAdminUser(user.id, { ai_enabled: !user.ai_enabled });
      loadUsers();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const handleSetExpiration = async (user: AdminUser, dateValue: string) => {
    setSavingId(user.id);
    setError("");
    try {
      // End-of-day UTC on the selected date, so access lasts through the
      // whole day the admin picked, not just until midnight it starts.
      const iso = dateValue ? `${dateValue}T23:59:59Z` : null;
      await updateAdminUser(user.id, { access_expires_at: iso });
      loadUsers();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const handleRemove = async (user: AdminUser) => {
    if (!confirm(`Remove ${user.email}? They will lose access immediately.`)) return;
    setRemovingId(user.id);
    setError("");
    try {
      await removeAdminUser(user.id);
      loadUsers();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemovingId(null);
    }
  };

  if (forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">You don&apos;t have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-lg font-bold text-slate-900">Beta User Admin</h1>
          <p className="text-xs text-slate-500">Invite-only beta — manage seats here instead of the manual curl command.</p>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <form onSubmit={handleInvite} className="mb-6 flex items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-700">Invite a new user</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@university.edu"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={inviting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </form>

        {inviteInfo && <p className="mb-4 text-xs text-green-600">{inviteInfo}</p>}
        {error && <p className="mb-4 text-xs text-red-600">{error}</p>}

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Invited</th>
                <th className="px-4 py-2">Last sign-in</th>
                <th className="px-4 py-2">AI Q&amp;A</th>
                <th className="px-4 py-2">Access expires</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {users === null && (
                <tr><td className="px-4 py-3 text-slate-400" colSpan={6}>Loading…</td></tr>
              )}
              {users?.length === 0 && (
                <tr><td className="px-4 py-3 text-slate-400" colSpan={6}>No users yet.</td></tr>
              )}
              {users?.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 text-slate-900">
                    {u.email}
                    {isExpired(u.access_expires_at) && (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Expired</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{formatDate(u.invited_at ?? u.created_at)}</td>
                  <td className="px-4 py-2 text-slate-500">{formatDate(u.last_sign_in_at)}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleToggleAi(u)}
                      disabled={savingId === u.id}
                      role="switch"
                      aria-checked={u.ai_enabled}
                      className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${
                        u.ai_enabled ? "bg-blue-600" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                          u.ai_enabled ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={toDateInputValue(u.access_expires_at)}
                        onChange={(e) => handleSetExpiration(u, e.target.value)}
                        disabled={savingId === u.id}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
                      />
                      {u.access_expires_at && (
                        <button
                          onClick={() => handleSetExpiration(u, "")}
                          disabled={savingId === u.id}
                          className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleRemove(u)}
                      disabled={removingId === u.id}
                      className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      {removingId === u.id ? "Removing…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
