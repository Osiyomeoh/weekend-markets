"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong.</h1>
      <p className="mt-3 text-sm text-muted">
        {error.message || "An unexpected error occurred."} Your funds are on-chain and unaffected.
      </p>
      <button onClick={() => retry()} className="mt-6 rounded-lg bg-bell px-5 py-2.5 text-sm font-medium text-bg">
        Try again
      </button>
    </div>
  );
}
