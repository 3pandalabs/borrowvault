import Link from "next/link";

/** BorrowVault app icon (same artwork as the favicon, src/app/icon.svg).
 * aria-hidden: the wordmark beside it carries the name. */
export function BrandMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed
    <img src="/icon.svg" alt="" aria-hidden="true" width={28} height={28} className="size-7 shrink-0 rounded-md" />
  );
}

/** One word, one colour: a two-tone name read as "Borrow Vault". */
export function WordmarkName() {
  return <>BorrowVault</>;
}

/** "| by 3PandaLabs" attribution tag (brand/attribution). A sibling of the home
 * link, never nested inside it. */
export function WordmarkTag() {
  return (
    <>
      <span
        aria-hidden
        className="mx-2 inline-block h-3.5 w-px translate-y-[1px] bg-current align-middle opacity-20"
      />
      <a
        href="https://3pandalabs.com"
        target="_blank"
        rel="noopener noreferrer"
        className="align-middle font-mono text-[10px] font-normal uppercase tracking-widest text-fg-muted hover:text-fg hover:underline"
      >
        by 3PandaLabs
      </a>
    </>
  );
}

/** Header logo: mark + name linking home, attribution as a sibling. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <span className="inline-flex items-center">
      <Link href={href} className="inline-flex items-center gap-2 text-lg font-semibold text-fg">
        <BrandMark />
        <WordmarkName />
      </Link>
      <WordmarkTag />
    </span>
  );
}
