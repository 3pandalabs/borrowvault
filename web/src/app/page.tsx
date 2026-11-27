import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Camera,
  Check,
  Hammer,
  HandCoins,
  IndianRupee,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  Star,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Backdrop } from "@/components/Backdrop";
import { Logo } from "@/components/Wordmark";
import { Button } from "@/components/ui/button";
import "./home.css";

export const metadata = { alternates: { canonical: "/" } };

const FEATURES = [
  {
    icon: Users,
    title: "Only verified neighbours",
    body: "Every member is approved by your society admin against a flat in your society. Nobody from outside the gate can see a listing.",
  },
  {
    icon: Camera,
    title: "Photo-proof handovers",
    body: "Both of you photograph the item at handover and at return, in the app, inside the society. Any disagreement is settled on evidence.",
  },
  {
    icon: IndianRupee,
    title: "Pay over UPI, directly",
    body: "Fees go straight from the borrower's UPI app to the lender's UPI ID. BorrowVault never holds your money.",
  },
  {
    icon: ShieldCheck,
    title: "Fair disputes",
    body: "If something comes back damaged, a society admin who isn't involved compares the photos side by side and rules.",
  },
];

const STEPS = [
  { icon: Hammer, title: "Borrow", body: "The drill, ladder, projector or stroller you need for a weekend, from a few floors away." },
  { icon: HandCoins, title: "Lend", body: "Earn from things that sit in a cupboard. You set the price, the deposit and the checklist." },
  { icon: Users, title: "Share a skill", body: "Offer an hour of tutoring, a bike tune-up or help with a move. Same bookings, same trust score." },
];

// The life of one borrow, in the order the app walks you through it.
const FLOW = [
  { icon: MessageCircle, title: "Request", body: "Pick dates on a neighbour's listing and send a request." },
  { icon: Check, title: "Accept", body: "The lender accepts. You can chat in the app to fix a handover time." },
  { icon: IndianRupee, title: "Pay over UPI", body: "Your UPI app opens with the lender's UPI ID filled in. They confirm receipt." },
  { icon: Camera, title: "Handover photos", body: "Both of you photograph the item in the app's camera when it changes hands." },
  { icon: Camera, title: "Return photos", body: "Same again when it comes back, so the two sets can be compared." },
  { icon: Star, title: "Rate", body: "Rate each other. Good borrows build your trust score in the society." },
];

// Decorative marquee: the kind of things neighbours lend. Not live listings.
const MARQUEE = [
  "🔧 Drills",
  "🪜 Ladders",
  "📽️ Projectors",
  "👶 Strollers",
  "📚 An hour of tutoring",
  "🚲 Bike tune-ups",
  "📦 Help with a move",
  "⛺ Camping gear",
  "🎤 Party speakers",
  "🧳 Suitcases",
];

/** Animated phone mock: one example borrow cycling through four scenes. */
function HeroPhone() {
  return (
    <div className="bv-stage relative mx-auto w-full max-w-[340px]" aria-hidden>
      {/* Tower block behind the phone, windows lighting up in turn. */}
      <div className="bv-tower">
        {Array.from({ length: 24 }).map((_, i) => (
          <i key={i} style={{ "--i": i } as React.CSSProperties} />
        ))}
      </div>

      <div className="bv-float relative">
        <div className="bv-phone">
          <div className="bv-notch" />
          <div className="bv-screen">
            <div className="flex items-center justify-between px-4 pt-3 text-[11px] font-semibold text-fg">
              <span className="flex items-center gap-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- static SVG */}
                <img src="/icon.svg" alt="" width={16} height={16} className="size-4 rounded" />
                BorrowVault
              </span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-800">
                Example
              </span>
            </div>

            <div className="relative mt-3 h-[352px] px-3">
              {/* Scene 1: a neighbour's listing */}
              <div className="bv-scene">
                <div className="bv-card">
                  <div className="bv-photo bg-gradient-to-br from-emerald-200 to-teal-100">
                    <span className="text-5xl">🔧</span>
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-semibold text-fg">Cordless drill + bit set</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-muted">
                      <BadgeCheck className="size-3 text-accent" /> Verified neighbour · Tower B
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-fg">₹80 / day</span>
                      <span className="text-[11px] text-fg-muted">Deposit ₹500</span>
                    </div>
                    <div className="bv-btn mt-3">Request Sat – Sun</div>
                  </div>
                </div>
              </div>

              {/* Scene 2: accepted + chat */}
              <div className="bv-scene">
                <div className="bv-card p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-accent">Request accepted</p>
                  <p className="mt-1 text-sm font-semibold text-fg">Cordless drill · Sat – Sun</p>
                  <div className="mt-3 space-y-2 text-[12px]">
                    <p className="bv-bubble bv-bubble-in">Sure! I&apos;m home after 6.</p>
                    <p className="bv-bubble bv-bubble-out">Great, I&apos;ll come down to B-12.</p>
                    <p className="bv-bubble bv-bubble-in">See you at the lobby 👋</p>
                  </div>
                </div>
              </div>

              {/* Scene 3: pay over UPI */}
              <div className="bv-scene">
                <div className="bv-card p-3 text-center">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">Pay the lender</p>
                  <p className="mt-2 text-3xl font-semibold text-fg">₹160</p>
                  <p className="text-[11px] text-fg-muted">2 days · straight to their UPI ID</p>
                  <div className="mx-auto mt-3 grid w-28 grid-cols-6 gap-0.5 rounded-lg bg-white p-2 ring-1 ring-line">
                    {Array.from({ length: 36 }).map((_, i) => (
                      <span key={i} className={(i * 7) % 5 < 2 ? "aspect-square bg-fg" : "aspect-square"} />
                    ))}
                  </div>
                  <div className="bv-btn mt-3">
                    <IndianRupee className="size-3.5" /> Open UPI app
                  </div>
                  <p className="mt-2 text-[10px] text-fg-muted">BorrowVault never holds the money</p>
                </div>
              </div>

              {/* Scene 4: handover photos */}
              <div className="bv-scene">
                <div className="bv-card p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-accent">Handover photos</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {["Lender", "Borrower"].map((who) => (
                      <div key={who} className="rounded-xl bg-bg-subtle p-2 text-center">
                        <div className="bv-snap">
                          <span className="text-3xl">🔧</span>
                          <span className="bv-flash" />
                        </div>
                        <p className="mt-1 flex items-center justify-center gap-1 text-[11px] font-medium text-fg">
                          <Check className="size-3 text-accent" /> {who}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 rounded-lg bg-emerald-50 px-2 py-1.5 text-center text-[11px] font-medium text-emerald-800">
                    Both sides photographed in the app
                  </p>
                </div>
              </div>
            </div>

            {/* Progress through the four scenes */}
            <div className="flex justify-center gap-1.5 pb-4">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="bv-dot" />
              ))}
            </div>
          </div>
        </div>

        <div className="bv-chip bv-chip-a">
          <BadgeCheck className="size-4 text-accent" /> Verified by your society
        </div>
        <div className="bv-chip bv-chip-b">
          <Camera className="size-4 text-accent" /> Photo-proof
        </div>
      </div>
    </div>
  );
}

/** Handover vs return photo comparison, the evidence a dispute is ruled on. */
function CompareDemo() {
  return (
    <div className="bv-compare rounded-3xl border border-line bg-white/85 p-5 shadow-sm backdrop-blur-sm" aria-hidden>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-fg">Side-by-side check</p>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800">
          Example
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          { label: "At handover", tone: "from-emerald-100 to-teal-50" },
          { label: "At return", tone: "from-amber-100 to-emerald-50" },
        ].map(({ label, tone }) => (
          <div key={label}>
            <div className={`bv-evidence bg-gradient-to-br ${tone}`}>
              <span className="text-5xl">🪜</span>
              <span className="bv-scan" />
            </div>
            <p className="mt-2 text-center text-xs font-medium text-fg-muted">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2 text-xs">
        <p className="flex items-center gap-2 text-fg">
          <Check className="size-4 text-accent" /> Taken in the app&apos;s camera, not the gallery
        </p>
        <p className="flex items-center gap-2 text-fg">
          <Check className="size-4 text-accent" /> Taken by each party from their own account
        </p>
        <p className="flex items-center gap-2 text-fg">
          <Check className="size-4 text-accent" /> Reviewed by an admin who isn&apos;t involved
        </p>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="relative overflow-x-clip">
      <Backdrop />
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2 px-4 py-4">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Join your society</Button>
          </Link>
        </nav>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-16 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:pb-24">
          <div className="text-center lg:text-left">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-white/70 px-3 py-1 text-xs font-medium text-fg-muted">
              <span className="bv-pulse" /> For gated societies in India
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-fg sm:text-5xl lg:text-[3.4rem] lg:leading-[1.08]">
              Borrow, lend and share skills with the{" "}
              <span className="bv-accent">neighbours inside your gate.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-fg-muted lg:mx-0">
              BorrowVault is a rental and micro-gig marketplace for one society at a time. Verified residents, photo-proof
              handovers, and payments straight over UPI.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
              <Link href="/signup">
                <Button size="lg">
                  Sign up free <ArrowRight />
                </Button>
              </Link>
              <a href="#get-the-app">
                <Button size="lg" variant="outline">
                  <Smartphone /> Get the app
                </Button>
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-fg-muted lg:justify-start">
              <li className="flex items-center gap-1.5">
                <BadgeCheck className="size-4 text-accent" /> Admin-verified members
              </li>
              <li className="flex items-center gap-1.5">
                <Camera className="size-4 text-accent" /> Photo-proof handovers
              </li>
              <li className="flex items-center gap-1.5">
                <IndianRupee className="size-4 text-accent" /> UPI, direct
              </li>
            </ul>
          </div>
          <HeroPhone />
        </section>

        {/* ---------- Marquee ---------- */}
        <section className="bv-marquee border-y border-line bg-white/60 py-4 backdrop-blur-sm" aria-label="Things neighbours lend">
          <div className="bv-track">
            {[...MARQUEE, ...MARQUEE].map((item, i) => (
              <span key={i} aria-hidden={i >= MARQUEE.length} className="bv-pill">
                {item}
              </span>
            ))}
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4">
          {/* ---------- Borrow / Lend / Share ---------- */}
          <section className="py-16 sm:py-20">
            <p className="text-center text-xs font-semibold uppercase tracking-widest text-accent">Three ways to use it</p>
            <h2 className="mx-auto mt-2 max-w-2xl text-center text-3xl font-semibold tracking-tight text-fg">
              One society, one marketplace
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <div key={title} className="bv-lift rounded-2xl border border-line bg-white/85 p-6 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <span className="grid size-11 place-items-center rounded-xl bg-emerald-50 text-accent">
                      <Icon className="size-6" />
                    </span>
                    <span className="font-mono text-xs text-fg-muted">0{i + 1}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-fg">{title}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ---------- How a borrow works ---------- */}
          <section className="pb-16 sm:pb-20">
            <p className="text-center text-xs font-semibold uppercase tracking-widest text-accent">How a borrow works</p>
            <h2 className="mx-auto mt-2 max-w-2xl text-center text-3xl font-semibold tracking-tight text-fg">
              From request to rating, all in the app
            </h2>
            <ol className="bv-flow mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              {FLOW.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="bv-flow-step relative rounded-2xl border border-line bg-white/85 p-5 backdrop-blur-sm">
                  <span className="bv-flow-num">{i + 1}</span>
                  <Icon className="mt-3 size-5 text-accent" />
                  <h3 className="mt-2 font-semibold text-fg">{title}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{body}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* ---------- Trust ---------- */}
          <section className="grid items-center gap-10 pb-16 sm:pb-20 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-accent">Trust, by design</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-fg">Built for trust between neighbours</h2>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {FEATURES.map(({ icon: Icon, title, body }) => (
                  <div key={title} className="bv-lift rounded-2xl border border-line bg-white/85 p-5 backdrop-blur-sm">
                    <Icon className="size-6 text-accent" />
                    <h3 className="mt-3 font-semibold text-fg">{title}</h3>
                    <p className="mt-1 text-sm text-fg-muted">{body}</p>
                  </div>
                ))}
              </div>
            </div>
            <CompareDemo />
          </section>

          {/* ---------- Register a society ---------- */}
          <section className="mb-10 flex flex-col items-start justify-between gap-4 rounded-3xl border border-line bg-white/85 p-6 backdrop-blur-sm sm:flex-row sm:items-center sm:p-8">
            <div className="flex gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-accent">
                <Building2 className="size-6" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-fg">Your society isn&apos;t on BorrowVault yet?</h2>
                <p className="mt-1 max-w-xl text-sm text-fg-muted">
                  Any resident can register it. Upload your ID and a proof that you live there. We check them, then open it
                  as a pilot society with you as its admin.
                </p>
              </div>
            </div>
            <Link href="/signup?next=/societies/register" className="shrink-0">
              <Button variant="outline">Register your society</Button>
            </Link>
          </section>

          {/* ---------- Get the app (closing CTA) ---------- */}
          <section id="get-the-app" className="bv-cta relative mb-20 overflow-hidden rounded-3xl p-8 text-center text-white sm:p-12">
            <div className="bv-cta-glow" aria-hidden />
            <div className="relative">
              <Smartphone className="mx-auto size-9 text-emerald-200" />
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">Get the BorrowVault app</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-emerald-50/90">
                Handover and return photos are taken in the app&apos;s camera, inside your society, so they can&apos;t be
                swapped for old pictures. The Android and iOS apps are coming soon. Until then, sign up here and get
                verified so you&apos;re ready on day one.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button variant="outline" disabled className="border-white/30 bg-white/10 text-white">
                  Google Play: coming soon
                </Button>
                <Button variant="outline" disabled className="border-white/30 bg-white/10 text-white">
                  App Store: coming soon
                </Button>
                <Link href="/signup">
                  <Button className="bg-white text-emerald-900 hover:bg-emerald-50 hover:opacity-100">
                    Sign up now <ArrowRight />
                  </Button>
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
