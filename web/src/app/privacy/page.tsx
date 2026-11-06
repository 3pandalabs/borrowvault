import type { Metadata } from "next";
import { A, H3, LegalPage, Mail, PRIVACY_EMAIL, Section, SUPPORT_EMAIL, UL } from "@/components/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal data BorrowVault collects, why, who can see it, and your rights under India's DPDP Act 2023.",
  alternates: { canonical: "/privacy" },
};

const TOC = [
  { id: "who-we-are", title: "Who we are" },
  { id: "what-we-collect", title: "What we collect" },
  { id: "what-we-dont", title: "What we don’t collect" },
  { id: "why", title: "Why we use it" },
  { id: "who-sees", title: "Who can see your data" },
  { id: "processors", title: "Service providers and transfers outside India" },
  { id: "retention", title: "How long we keep it" },
  { id: "rights", title: "Your rights" },
  { id: "grievance", title: "Grievance Officer" },
  { id: "security", title: "Security" },
  { id: "children", title: "Children" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact" },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      toc={TOC}
      intro={
        <>
          <p>
            BorrowVault lets verified residents of a gated society borrow, lend and offer skills to each other. To do
            that safely we need some personal data about you. This policy explains what we collect, why, who can see
            it, how long we keep it, and what you can do about it.
          </p>
          <p>
            We wrote it to meet India’s Digital Personal Data Protection Act, 2023 (the “DPDP Act”) and the
            Information Technology Act, 2000 and its rules. When you create an account you consent to the processing
            described here. You can withdraw that consent at any time (see <a href="#rights" className="font-medium text-accent hover:underline">Your rights</a>).
          </p>
        </>
      }
    >
      <Section id="who-we-are" title="1. Who we are">
        <p>
          BorrowVault is run by 3PandaLabs LLC, a limited liability company registered in New Jersey, USA (“3PandaLabs”,
          “we”, “us”). For the DPDP Act, 3PandaLabs is the Data Fiduciary for the personal data described here.
        </p>
        <p>
          Society admins are residents of your society, not 3PandaLabs staff. They see some of your data so they can
          verify members and settle disputes (see <a href="#who-sees" className="font-medium text-accent hover:underline">Who can see your data</a>).
        </p>
      </Section>

      <Section id="what-we-collect" title="2. What we collect">
        <H3>Your account</H3>
        <UL>
          <li>Email address, display name and mobile number.</li>
          <li>Your password, stored only as a one-way hash. We can’t read it.</li>
          <li>Your UPI ID (VPA), if you add one. You need it to lend, so borrowers can pay you.</li>
          <li>Your setting for chat push notifications.</li>
        </UL>

        <H3>Society membership</H3>
        <UL>
          <li>The society, tower and flat number you join, and whether you are an owner, tenant or family member.</li>
          <li>
            A proof-of-residence document, if you upload one (for example a rent agreement, maintenance bill or
            utility bill).
          </li>
          <li>The admin’s decision on your membership (approved, rejected or revoked) and any note they add.</li>
        </UL>

        <H3>If you apply to be a society admin</H3>
        <UL>
          <li>
            Your committee role, an optional statement, and documents: your RWA or society registration certificate (for
            a new society), an authorisation letter or committee resolution, and your own ID or address proof. We ask
            you to upload a masked Aadhaar (only the last 4 digits visible) or a utility bill, not a full Aadhaar.
          </li>
          <li>For a new society: its name, city, address and a map location and radius (the society’s geofence).</li>
        </UL>

        <H3>Listings</H3>
        <UL>
          <li>Titles, descriptions, categories, photos, prices, deposit, replacement value and condition checklists.</li>
        </UL>

        <H3>Bookings and payments</H3>
        <UL>
          <li>Who booked what, when, at what price, and every change of booking status with its time.</li>
          <li>
            Payment confirmations you and the other party record in the app: “I’ve paid”, “Received”, refunds and
            dispute awards, and a UPI transaction reference (UTR) if you choose to enter one.
          </li>
        </UL>

        <H3>Handover and return inspections</H3>
        <UL>
          <li>
            Photos and videos you take in the BorrowVault app at handover and return, and any photos you add to a
            dispute or objection. These can show your home, the item and, sometimes, people.
          </li>
          <li>
            For each capture: your device’s location (latitude, longitude and accuracy) if it has a fix, the time it
            was taken and received, whether it was inside your society’s geofence, and a fingerprint (hash) of the file
            so it can’t be swapped later.
          </li>
          <li>Your checklist answers and notes.</li>
        </UL>
        <p>
          We only read your location when you take an inspection photo or video in the app. We don’t track your
          location in the background.
        </p>

        <H3>Disputes, ratings and trust</H3>
        <UL>
          <li>Dispute claims, descriptions, evidence, responses, offers, rulings and any award recorded as a debt.</li>
          <li>
            Ratings you give and receive (stars, “punctual”, “careful”, “as described” and comments), and the trust
            score we calculate from your bookings, ratings, no-shows and disputes lost.
          </li>
        </UL>

        <H3>Chat</H3>
        <UL>
          <li>
            Messages between a lender and a borrower about a listing, and when you last read them. Messages can’t be
            edited or deleted once sent, because they can be evidence in a dispute.
          </li>
          <li>Reports you make about a message, with your reason, and the admin’s review.</li>
        </UL>

        <H3>Your device and technical data</H3>
        <UL>
          <li>
            If you use the mobile app: a push notification token for your device and its platform (iOS or Android), so
            we can notify you of new messages.
          </li>
          <li>
            Sign-in tokens, stored in your browser’s local storage or on your device, so you stay signed in. We don’t
            use advertising or analytics cookies.
          </li>
          <li>
            Your IP address and basic request details, which our servers use to block abuse (rate limiting) and record
            in short-lived logs for security and debugging.
          </li>
        </UL>
      </Section>

      <Section id="what-we-dont" title="3. What we don’t collect">
        <UL>
          <li>
            We don’t collect or store card numbers, bank account numbers or UPI PINs. Payments happen in your own UPI
            app, directly between you and the other resident. BorrowVault never holds, receives or processes your money.
          </li>
          <li>We don’t sell your personal data, and we don’t use it for advertising.</li>
          <li>We don’t ask for your full Aadhaar number, and we don’t use DigiLocker or any Aadhaar authentication.</li>
        </UL>
      </Section>

      <Section id="why" title="4. Why we use it">
        <p>We use your personal data only for these purposes:</p>
        <UL>
          <li>To create and secure your account, and to let you sign in and reset your password.</li>
          <li>To verify that you live in the society you join, and that society admins are genuinely authorised.</li>
          <li>To show your listings to neighbours, and to run bookings, reminders and deadlines.</li>
          <li>To build UPI payment links to the lender’s UPI ID, and to record the payment confirmations you make.</li>
          <li>To keep tamper-proof evidence of an item’s condition at handover and return.</li>
          <li>To handle disputes, record awards, and pause borrowing for people who owe an unpaid award.</li>
          <li>To calculate and show trust scores and ratings, so neighbours can decide whom to deal with.</li>
          <li>To deliver chat messages and notifications, and to act on reported messages.</li>
          <li>To send service emails (for example password resets and admin-request decisions).</li>
          <li>To prevent fraud and abuse, keep the service secure, and fix problems.</li>
          <li>To comply with the law, respond to lawful requests, and establish or defend legal claims.</li>
        </UL>
        <p>
          We rely on your consent for most of this. Where the DPDP Act allows processing without consent (for example
          to comply with a law or a court order), we rely on that instead. We don’t use your data for any unrelated
          purpose without asking you first.
        </p>
      </Section>

      <Section id="who-sees" title="5. Who can see your data">
        <H3>Approved members of your society</H3>
        <p>
          Your display name, tower, flat number and trust score appear on your listings, bookings and chats. Your
          listings (with photos and prices) are visible to approved members of the same society only. Nobody outside
          your society can see them.
        </p>
        <H3>The other party to a booking</H3>
        <p>
          They see the booking details, inspection photos and videos, checklist answers, dispute details, and the
          ratings you give them. A borrower sees the lender’s UPI ID inside the payment link. The lender sees the
          borrower’s UPI ID when a refund or award is owed.
        </p>
        <H3>Society admins</H3>
        <UL>
          <li>
            Your name, email, mobile number, tower, flat, occupancy and proof-of-residence document, so they can approve
            your membership.
          </li>
          <li>
            For a booking in dispute (or resolved after a dispute): the booking, its evidence, and the whole chat
            between the lender and borrower about that listing. Admins can’t read your chats at any other time.
          </li>
          <li>
            A reported message, with up to 5 messages before and after it for context. Admins who are a party, or who
            live in a party’s flat, are excluded from ruling and from seeing reports about that chat.
          </li>
        </UL>
        <p>Society admins don’t see the documents you upload to apply to become an admin.</p>
        <H3>3PandaLabs platform admins</H3>
        <p>
          A small number of 3PandaLabs staff can review admin applications and their documents, rule on escalated
          disputes, and access data when needed to run, secure or support the service.
        </p>
        <H3>Others</H3>
        <p>
          Our service providers (below), and authorities when the law requires it. If 3PandaLabs is ever merged or
          sold, your data may move to the new owner under this policy.
        </p>
      </Section>

      <Section id="processors" title="6. Service providers and transfers outside India">
        <p>We use these companies to run BorrowVault. They process data on our instructions only.</p>
        <UL>
          <li>
            <strong>Cloudflare, Inc.</strong>: website hosting, DNS, network protection, and file storage (R2) for
            photos, videos and documents.
          </li>
          <li>
            <strong>Hetzner Online GmbH</strong>: the servers that run our API, database and background jobs, in a data
            centre in Germany. Our workflow engine (Temporal) is self-hosted on these same servers.
          </li>
          <li>
            <strong>Resend</strong>: sends our service emails, through a 3PandaLabs mail gateway hosted on Cloudflare.
          </li>
          <li>
            <strong>Expo (650 Industries, Inc.)</strong>, <strong>Apple</strong> and <strong>Google</strong>: deliver
            push notifications to the mobile app. A notification contains the sender’s name, the listing title and the
            first 100 characters of the message.
          </li>
        </UL>
        <p>
          This means your personal data is stored and processed outside India, including in the European Union and the
          United States. The DPDP Act allows this unless the Government of India restricts transfers to a particular
          country. We will follow any such restriction.
        </p>
      </Section>

      {/* TODO(anil): the retention periods below are proposals, not yet enforced
          in code (no R2 lifecycle rule or purge job exists yet; only reset links
          (30 min), upload/download links, invite codes (30 days) and sessions
          (30 days) expire today). Review the numbers and build the purge jobs, or
          edit this section to match what actually happens. */}
      <Section id="retention" title="7. How long we keep it">
        <p>We keep personal data only as long as we need it for the purposes above, or as the law requires.</p>
        <UL>
          <li>Password reset links expire after 30 minutes and work once. Sign-in sessions expire after 30 days.</li>
          <li>Upload and viewing links for files expire within minutes. Society invite codes expire after 30 days.</li>
          <li>Push tokens are deleted when you sign out of the app, reset your password, or the device stops accepting notifications.</li>
          <li>
            Inspection photos and videos: 180 days after the booking ends, or longer while a dispute about it is open
            and until it is settled.
          </li>
          <li>
            Bookings, payment confirmations, disputes, awards, ratings and chat messages: for as long as your account is
            open, and up to 3 years after it closes. This lets us handle late disputes, unpaid awards and legal claims.
          </li>
          <li>
            Proof-of-residence and admin application documents: while your membership or admin role is active, and up to
            1 year after it ends or the application is decided.
          </li>
          <li>Server logs: up to 30 days. Database backups: up to 30 days.</li>
        </UL>
        <p>
          When we no longer need data, we delete it or make it anonymous. If we must keep something longer because of a
          law, a court order or an open legal claim, we keep only what is needed and only for that reason.
        </p>
      </Section>

      <Section id="rights" title="8. Your rights">
        <p>Under the DPDP Act you have the right to:</p>
        <UL>
          <li>
            <strong>Access</strong>: get a summary of the personal data we hold about you, what we do with it, and who
            we have shared it with.
          </li>
          <li>
            <strong>Correction and updating</strong>: fix inaccurate or incomplete data. You can change your name, phone
            and UPI ID yourself in your profile.
          </li>
          <li>
            <strong>Erasure</strong>: ask us to delete your data. There is no delete button in the app yet, so email us
            from the address on your account. We will delete your account and data, except what we must keep (see below).
          </li>
          <li>
            <strong>Withdraw consent</strong>: as easily as you gave it, by emailing us. Withdrawing consent means we
            close your account, because we can’t run bookings without your data. It doesn’t affect processing that
            happened before.
          </li>
          <li>
            <strong>Grievance redressal</strong>: complain to our Grievance Officer (below), and then to the Data
            Protection Board of India if you are not satisfied.
          </li>
          <li>
            <strong>Nominate</strong>: name someone who can exercise these rights for you if you die or become unable to
            do so. Email us with their name and contact details.
          </li>
        </UL>
        <p>
          <strong>What we may keep after a deletion request.</strong> Chat messages, inspection evidence, booking
          history, disputes and awards also belong to the other resident’s record. We may keep them while a booking or
          dispute is open, while an award is unpaid, or as the law requires. We remove them once those reasons end, in
          line with the retention periods above.
        </p>
        <p>
          To use any right, email <Mail to={PRIVACY_EMAIL} /> from the email address on your account. We may ask you to
          confirm your identity. We don’t charge for this.
        </p>
      </Section>

      {/* TODO(anil): name a real person as Grievance Officer if counsel advises it,
          and confirm the response times below (IT Rules 2021 / DPDP Rules 2025). */}
      <Section id="grievance" title="9. Grievance Officer">
        <p>If you have a complaint about how we handle your personal data or about content on BorrowVault, contact:</p>
        <p className="rounded-2xl border border-line bg-bg-subtle p-4">
          Grievance Officer, 3PandaLabs
          <br />
          Email: <Mail to={PRIVACY_EMAIL} />
        </p>
        <p>
          We acknowledge complaints within 24 hours and aim to resolve them within 15 days. If you are not satisfied
          with our response, you can complain to the Data Protection Board of India.
        </p>
      </Section>

      <Section id="security" title="10. Security">
        <p>
          We protect your data with encryption in transit (HTTPS), hashed passwords, short-lived sign-in tokens, private
          file storage that is only reachable through links that expire in minutes, and access rules that keep each
          society’s data inside that society. No system is perfectly secure. If a personal data breach affects you, we
          will tell you and the Data Protection Board of India as the law requires.
        </p>
      </Section>

      <Section id="children" title="11. Children">
        <p>
          BorrowVault is only for people aged 18 or over. We don’t knowingly collect data from children. If you think a
          child has signed up, email <Mail to={PRIVACY_EMAIL} /> and we will delete the account.
        </p>
      </Section>

      <Section id="changes" title="12. Changes to this policy">
        <p>
          We may update this policy as the service changes. We will change the “last updated” date above, and for
          significant changes we will tell you by email or in the app before they apply. If a change needs fresh consent,
          we will ask for it.
        </p>
      </Section>

      <Section id="contact" title="13. Contact">
        <p>
          Privacy questions and requests: <Mail to={PRIVACY_EMAIL} />. Anything else: <Mail to={SUPPORT_EMAIL} />.
        </p>
        <p>
          See also our <A href="/terms">Terms of Service</A>.
        </p>
      </Section>
    </LegalPage>
  );
}
