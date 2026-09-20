"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";

export default function Header() {
  const { data: session } = useSession();

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-brand-500 flex items-center justify-center font-bold text-sm">
            O
          </div>
          <span className="font-semibold">Outbox Scheduler</span>
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/settings"
            className="text-sm text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
          >
            Settings
          </Link>

          {session?.user && (
            <div className="flex items-center gap-3 pl-4 border-l border-[var(--border)]">
              {session.user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name || "User"}
                  className="h-8 w-8 rounded-full"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-brand-600 flex items-center justify-center text-xs">
                  {session.user.name?.[0] ?? "U"}
                </div>
              )}
              <div className="text-sm leading-tight hidden sm:block">
                <div className="font-medium">{session.user.name}</div>
                <div className="text-[var(--text-dim)] text-xs">{session.user.email}</div>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-sm text-[var(--text-dim)] hover:text-red-400 transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
