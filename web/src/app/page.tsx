import { Camera, Hammer, HandCoins, IndianRupee, ShieldCheck, Smartphone, Users } from "lucide-react";
import Link from "next/link";
import { Backdrop } from "@/components/Backdrop";
import { Logo } from "@/components/Wordmark";
import { Button } from "@/components/ui/button";

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

export default function Landing() {
  return (
    <div className="relative">
      <Backdrop />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
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

      <main className="mx-auto max-w-6xl px-4">
        <section className="py-16 text-center sm:py-24">
          <p className="mb-4 inline-block rounded-full border border-line bg-white/70 px-3 py-1 text-xs font-medium text-fg-muted">
            For gated societies in India
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
            Borrow, lend and share skills with the neighbours inside your gate.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-fg-muted">
            BorrowVault is a rental and micro-gig marketplace for one society at a time. Verified residents, photo-proof
            handovers, and payments straight over UPI.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup">
              <Button size="lg">Sign up free</Button>
            </Link>
            <a href="#get-the-app">
              <Button size="lg" variant="outline">
                <Smartphone /> Get the app
              </Button>
            </a>
          </div>
        </section>

        <section className="grid gap-4 pb-16 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-line bg-white/80 p-6 backdrop-blur-sm">
              <Icon className="size-6 text-accent" />
              <h2 className="mt-3 font-semibold text-fg">{title}</h2>
              <p className="mt-1 text-sm text-fg-muted">{body}</p>
            </div>
          ))}
        </section>

        <section className="pb-16">
          <h2 className="mb-6 text-center text-2xl font-semibold tracking-tight text-fg">Built for trust between neighbours</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-4 rounded-2xl border border-line bg-white/80 p-6 backdrop-blur-sm">
                <Icon className="size-6 shrink-0 text-accent" />
                <div>
                  <h3 className="font-semibold text-fg">{title}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="get-the-app" className="mb-20 rounded-3xl border border-line bg-white/80 p-8 text-center backdrop-blur-sm">
          <Smartphone className="mx-auto size-8 text-accent" />
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg">Get the BorrowVault app</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-fg-muted">
            Handover and return photos are taken in the app&apos;s camera, inside your society, so they can&apos;t be
            swapped for old pictures. The Android and iOS apps are coming soon. Until then, sign up here and get
            verified so you&apos;re ready on day one.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button variant="outline" disabled>
              Google Play: coming soon
            </Button>
            <Button variant="outline" disabled>
              App Store: coming soon
            </Button>
            <Link href="/signup">
              <Button>Sign up now</Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
