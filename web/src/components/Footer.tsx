import { FollowUs } from "@/components/FollowUs";
import Link from "next/link";

// Sitewide footer, copy from brand/footer/footer.css, plus the legal links.
// The tagline line is brand `.footer-tagline` (DECIDED 2026-11-22).
export function Footer() {
  return (
    <footer className="border-t border-line px-6 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
        <FollowUs />
        <span>&copy; 3PandaLabs LLC, USA.</span>
        <nav aria-label="Legal" className="flex gap-4">
          <Link href="/privacy" className="hover:text-fg hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-fg hover:underline">
            Terms
          </Link>
          <Link href="/delete-account" className="hover:text-fg hover:underline">
            Delete account
          </Link>
        </nav>
        <span>All rights reserved.</span>
        <p className="mt-1 basis-full text-xs text-fg-muted">Built by pandas. Loved by people.</p>
      </div>
    </footer>
  );
}
