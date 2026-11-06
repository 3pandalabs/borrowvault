import Link from "next/link";

// Sitewide footer, copy from brand/footer/footer.css, plus the legal links.
export function Footer() {
  return (
    <footer className="border-t border-line px-6 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
        <span>&copy; 3PandaLabs LLC, USA.</span>
        <nav aria-label="Legal" className="flex gap-4">
          <Link href="/privacy" className="hover:text-fg hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-fg hover:underline">
            Terms
          </Link>
        </nav>
        <span>All rights reserved.</span>
      </div>
    </footer>
  );
}
