import Link from "next/link";

/** Three-panda mark (brand/logo/panda-mark.html). aria-hidden: the wordmark
 * beside it carries the name. */
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span>🐼</span>
      <span>🐼</span>
      <span>🐼</span>
    </span>
  );
}

export function WordmarkName() {
  return (
    <>
      Borrow<span className="text-accent">Vault</span>
    </>
  );
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
      <Link href={href} className="inline-flex items-center gap-1.5 text-lg font-semibold text-fg">
        <BrandMark />
        <WordmarkName />
      </Link>
      <WordmarkTag />
    </span>
  );
}
