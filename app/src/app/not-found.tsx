import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <div className="num text-sm text-bell">404</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page closed before the bell.</h1>
      <p className="mt-3 text-sm text-muted">The page you asked for doesn&apos;t exist.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="rounded-lg bg-bell px-5 py-2.5 text-sm font-medium text-bg">
          Home
        </Link>
        <Link href="/cover" className="rounded-lg border border-line px-5 py-2.5 text-sm hover:border-faint">
          Gap cover
        </Link>
      </div>
    </div>
  );
}
