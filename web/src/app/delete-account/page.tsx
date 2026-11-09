import type { Metadata } from "next";
import { DeleteAccountPanel } from "@/components/DeleteAccount";
import { A, H3, LegalPage, Mail, PRIVACY_EMAIL, Section, UL } from "@/components/legal";

// Public on purpose (Google Play needs a web URL for account deletion that works
// signed out). The form itself is the client component; the API checks
// everything (ROUTES.md "Account deletion").
export const metadata: Metadata = {
  title: "Delete your account",
  description: "How to delete your BorrowVault account, what is deleted, and what is kept.",
  alternates: { canonical: "/delete-account" },
};

const TOC = [
  { id: "delete", title: "Delete your account" },
  { id: "first", title: "What you need to finish first" },
  { id: "deleted", title: "What is deleted" },
  { id: "kept", title: "What is kept, and why" },
];

export default function DeleteAccountPage() {
  return (
    <LegalPage
      title="Delete your BorrowVault account"
      toc={TOC}
      intro={
        <>
          <p>
            You can delete your account here, or in the app under Profile → Delete account. You confirm with your
            password. It happens straight away and can’t be undone.
          </p>
          <p>
            If you can’t sign in, email <Mail to={PRIVACY_EMAIL} /> from the address on your account and we will do it
            for you.
          </p>
        </>
      }
    >
      <Section id="delete" title="1. Delete your account">
        <DeleteAccountPanel />
      </Section>

      <Section id="first" title="2. What you need to finish first">
        <p>Other residents may be counting on you. You can’t delete your account while you have:</p>
        <UL>
          <li>a booking in progress (requested, accepted, paid, handed over, overdue or being returned);</li>
          <li>an open dispute;</li>
          <li>a dispute award that hasn’t been paid and confirmed;</li>
          <li>a refund that is still owed to you or by you.</li>
        </UL>
        <p>Signed in, this page lists each one with a link to the booking.</p>
      </Section>

      <Section id="deleted" title="3. What is deleted">
        <UL>
          <li>Your name is replaced with “Deleted user”.</li>
          <li>Your email, mobile number, UPI ID and password are removed. You are signed out everywhere.</li>
          <li>Your listings are taken down and their photos deleted.</li>
          <li>Your society memberships end, and your proof of residence is deleted.</li>
          <li>Any admin application is closed, and its ID documents are deleted.</li>
          <li>Your app notification tokens and your block list are deleted.</li>
        </UL>
        <p>Your email address is free again, so you can sign up later as a new account.</p>
      </Section>

      <Section id="kept" title="4. What is kept, and why">
        <p>
          Some records are shared with other residents, so we don’t delete them. We remove your name and details from
          them instead. They show you as “Deleted user”.
        </p>
        <UL>
          <li>Past bookings, payment confirmations, disputes, awards and ratings.</li>
          <li>Chat messages. Messages can’t be changed or deleted, because they can be evidence in a dispute.</li>
          <li>
            Handover and return photos and videos. These are write-once evidence that both sides rely on, so they are
            kept, but no longer linked to your name.
          </li>
          <li>Reports you made or that were made about you, so society admins keep their records.</li>
        </UL>
        <H3>How long</H3>
        <p>
          These records follow the 3-year rule in our <A href="/privacy#retention">Privacy Policy</A>. Server logs and
          backups roll over within 30 days.
        </p>
      </Section>
    </LegalPage>
  );
}
