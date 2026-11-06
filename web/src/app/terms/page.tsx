import type { Metadata } from "next";
import { A, H3, LegalPage, Mail, PRIVACY_EMAIL, Section, SUPPORT_EMAIL, UL } from "@/components/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The rules for borrowing, lending and offering skills to neighbours on BorrowVault.",
  alternates: { canonical: "/terms" },
};

const TOC = [
  { id: "about", title: "About these terms" },
  { id: "eligibility", title: "Who can use BorrowVault" },
  { id: "account", title: "Your account" },
  { id: "marketplace", title: "What BorrowVault is, and isn’t" },
  { id: "payments", title: "Payments, fees and UPI" },
  { id: "listings", title: "Listings and prohibited items" },
  { id: "bookings", title: "Bookings" },
  { id: "deposits", title: "Deposits, damage and late returns" },
  { id: "inspections", title: "Inspections as evidence" },
  { id: "disputes", title: "Disputes and rulings" },
  { id: "trust", title: "Ratings and trust score" },
  { id: "chat", title: "Chat and conduct" },
  { id: "admins", title: "Society admins" },
  { id: "suspension", title: "Suspension and termination" },
  { id: "content", title: "Your content" },
  { id: "disclaimers", title: "Disclaimers" },
  { id: "liability", title: "Limitation of liability" },
  { id: "indemnity", title: "Indemnity" },
  { id: "changes", title: "Changes to these terms" },
  { id: "law", title: "Governing law" },
  { id: "contact", title: "Contact and grievances" },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      toc={TOC}
      intro={
        <p>
          These terms are the agreement between you and 3PandaLabs LLC for using BorrowVault, on the web and in the
          mobile app. Please read them. They explain what we do, what we don’t do, and what you agree to when you borrow,
          lend or offer a skill to a neighbour.
        </p>
      }
    >
      <Section id="about" title="1. About these terms">
        <p>
          BorrowVault is run by 3PandaLabs LLC, a New Jersey (USA) limited liability company (“3PandaLabs”, “we”, “us”).
          By creating an account or using BorrowVault you agree to these terms and to our{" "}
          <A href="/privacy">Privacy Policy</A>. If you don’t agree, don’t use BorrowVault.
        </p>
      </Section>

      <Section id="eligibility" title="2. Who can use BorrowVault">
        <UL>
          <li>You must be at least 18 years old and able to enter a binding contract under Indian law.</li>
          <li>
            You must be a genuine resident (owner, tenant or family member) of a society that is live on BorrowVault, and
            your membership must be approved by that society’s admin before you can list or book.
          </li>
          <li>You must not have been removed from BorrowVault before, unless we have agreed to let you back.</li>
        </UL>
      </Section>

      <Section id="account" title="3. Your account">
        <UL>
          <li>Give accurate details: your real name, your own mobile number and email, and your actual flat.</li>
          <li>One person, one account. Don’t share it, sell it, or sign in as someone else.</li>
          <li>Keep your password safe. You are responsible for what happens on your account.</li>
          <li>Tell us straight away at <Mail to={SUPPORT_EMAIL} /> if you think someone else has access to it.</li>
          <li>
            If you move out, tell your society admin. They can revoke your membership. You still have to finish any
            booking, refund or award that is already open.
          </li>
        </UL>
      </Section>

      <Section id="marketplace" title="4. What BorrowVault is, and isn’t">
        <p>
          BorrowVault is an online marketplace. It lets residents find each other, agree a booking, record the handover
          and return, and settle disagreements. It is an intermediary.
        </p>
        <UL>
          <li>
            <strong>We are not a party to any rental or skill booking.</strong> The agreement is between the lender (or
            skill provider) and the borrower.
          </li>
          <li>
            <strong>We don’t own, inspect, store, insure or deliver any item</strong>, and we don’t employ or vouch for
            anyone offering a skill.
          </li>
          <li>
            <strong>We never hold, receive or move money.</strong> We are not a bank, payment aggregator, escrow agent or
            insurer.
          </li>
          <li>
            Verification confirms that a society admin approved your membership. It is not a background check, and it
            doesn’t guarantee anyone’s honesty, skill or the condition of an item.
          </li>
        </UL>
      </Section>

      <Section id="payments" title="5. Payments, fees and UPI">
        <UL>
          <li>
            All payments are over UPI, directly between residents. BorrowVault creates a UPI payment link to the
            lender’s UPI ID. You pay in your own UPI app. The lender then confirms in BorrowVault that they received it.
          </li>
          <li>
            Check the payee name and amount in your UPI app before you pay. A UPI payment can’t be reversed by us. If you
            pay the wrong person or amount, sort it out with them or your bank.
          </li>
          <li>
            Lenders must confirm receipt honestly and promptly. Falsely denying a payment you received is a serious
            breach of these terms.
          </li>
          <li>
            <strong>BorrowVault is free to use today.</strong> We don’t charge a platform fee on bookings. If we
            introduce one, we will tell you in advance and it will only apply to bookings made after it starts.
          </li>
          <li>
            Lenders are responsible for any tax on what they earn. Neither party can ask the other to pay outside the
            amount shown on the booking.
          </li>
        </UL>
      </Section>

      <Section id="listings" title="6. Listings and prohibited items">
        <H3>If you lend an item</H3>
        <UL>
          <li>You must own it, or have the owner’s permission to lend it.</li>
          <li>
            It must be safe, legal, clean, in working order and as described in your listing and photos. Mention any
            defect, missing part or special handling.
          </li>
          <li>Set an honest deposit and replacement value. The replacement value caps damage claims (see section 8).</li>
          <li>Hand it over on time, with any accessories, manuals or safety gear it needs.</li>
        </UL>
        <H3>If you offer a skill</H3>
        <UL>
          <li>
            Describe it honestly, perform it with reasonable care and skill, and hold any licence or qualification the
            law requires for it.
          </li>
          <li>
            You are an independent person helping a neighbour, not an employee or contractor of 3PandaLabs. Arrangements
            involving children (such as tutoring) need the parent or guardian to book and to be responsible for
            supervision.
          </li>
        </UL>
        <H3>If you borrow</H3>
        <UL>
          <li>Use the item only for its normal purpose, carefully, and only yourself or your household.</li>
          <li>Don’t lend it on, sell it, pawn it, take it outside India, or modify it.</li>
          <li>Return it on time, in the condition you got it (allowing for normal wear), with everything that came with it.</li>
        </UL>
        <H3>You must not list</H3>
        <UL>
          <li>Weapons, firearms, ammunition, explosives, fireworks or replicas that look real.</li>
          <li>Drugs, alcohol, tobacco or vaping products, prescription medicines, or anything to use them with.</li>
          <li>Hazardous goods: gas cylinders, fuel, chemicals, pesticides, or anything flammable, toxic or corrosive.</li>
          <li>
            Motor vehicles (cars, motorcycles, scooters) or anything that needs a licence, registration or insurance to
            use legally.
          </li>
          <li>Stolen, counterfeit or recalled goods, or anything you don’t have the right to lend.</li>
          <li>Animals, food, cosmetics or used personal-hygiene products.</li>
          <li>
            Medical devices that need a professional to use or fit them, and child car seats or safety gear that has
            been in an accident or is past its expiry.
          </li>
          <li>Anything illegal in India or your state, or any service that is illegal, adult or unsafe.</li>
        </UL>
        <p>We or your society admin can remove a listing that breaks these rules, without notice.</p>
      </Section>

      <Section id="bookings" title="7. Bookings">
        <UL>
          <li>
            A booking is an agreement between the lender and the borrower, on the price, dates, deposit and checklist
            shown when it was made. Later edits to the listing don’t change an existing booking.
          </li>
          <li>Bookings run on deadlines. For example:</li>
        </UL>
        <UL>
          <li>A request the lender doesn’t answer within 12 hours expires.</li>
          <li>An accepted booking the lender doesn’t mark as paid within 2 hours expires.</li>
          <li>A handover that doesn’t happen within 24 hours of the start time is cancelled, and counts against the lender.</li>
          <li>An item not returned by the end time is overdue. You will get reminders, and the society admin is alerted.</li>
          <li>
            If the lender doesn’t review a return within 24 hours, the booking completes as if they agreed with the
            return.
          </li>
        </UL>
        <p>
          Either party can cancel before the handover. If the lender had already confirmed payment, they must refund the
          borrower over UPI within 24 hours. If they don’t, a dispute opens automatically.
        </p>
      </Section>

      <Section id="deposits" title="8. Deposits, damage and late returns">
        <UL>
          <li>
            Each society chooses how deposits work. In a <strong>declared</strong> society, no deposit money changes
            hands. The deposit is a promise, and an award against you is recorded as a debt you must pay. In a{" "}
            <strong>p2p</strong> society, the borrower pays the deposit to the lender over UPI, and the lender refunds it
            over UPI after a clean return.
          </li>
          <li>
            Lenders in p2p societies must refund the deposit within 24 hours of a clean return. If they don’t, a dispute
            opens automatically on the borrower’s behalf.
          </li>
          <li>
            If you damage, lose or fail to return an item, or return it late, you are responsible to the lender for the
            loss, as decided through the dispute process or agreed between you.
          </li>
          <li>
            <strong>Claim cap.</strong> A lender’s claim on a booking can’t be more than the greater of the deposit and
            the replacement value shown on the booking. A borrower’s claim can’t be more than the fee plus the deposit.
            An award can be more than the deposit. Any amount above what the lender already holds is a debt.
          </li>
          <li>
            Normal wear and tear is not damage. A lender can’t claim for defects that were visible in the handover
            inspection.
          </li>
        </UL>
      </Section>

      <Section id="inspections" title="9. Inspections as evidence">
        <UL>
          <li>
            At handover and return, take the photos (or videos) the listing asks for, in the BorrowVault app, and answer
            the checklist honestly. The app records the time, your location if your device has one, and whether you
            were inside your society.
          </li>
          <li>
            Each party submits from their own account. Never submit for the other person, and never use old, edited or
            borrowed photos.
          </li>
          <li>
            Inspection media can’t be changed or deleted after it is uploaded. You agree that it can be used as evidence
            in any dispute about that booking, and seen by the other party and the admin ruling on it.
          </li>
          <li>
            If you agree to the other party’s inspection, you accept that it shows the item’s condition at that time. If
            you disagree, object in the app with your own photos.
          </li>
        </UL>
      </Section>

      <Section id="disputes" title="10. Disputes and rulings">
        <UL>
          <li>
            Either party can raise a dispute during an active booking, or within 24 hours of a return, for damage, a
            missing part, non-return, an item not as described, or lateness. Add a clear description and evidence.
          </li>
          <li>
            The other party can respond and make one offer. If the person who raised the dispute accepts it, the dispute
            is settled at that amount.
          </li>
          <li>
            Otherwise a society admin who isn’t a party, and doesn’t live in a party’s flat, reviews the evidence and the
            chat for that listing and rules on an award. If no ruling is made within 72 hours, it escalates to a
            3PandaLabs platform admin, who can also rule.
          </li>
          <li>
            <strong>Rulings are binding within BorrowVault.</strong> You agree to pay any award against you over UPI and
            mark it paid in the app. While you owe an unpaid award, you can’t make new bookings.
          </li>
          <li>
            A ruling is a community decision, not a court judgment or an arbitration award. It doesn’t stop either of you
            from going to a consumer forum, the police or a court. We aren’t responsible for collecting any award.
          </li>
        </UL>
      </Section>

      <Section id="trust" title="11. Ratings and trust score">
        <UL>
          <li>
            After a booking, both parties can rate each other once. Ratings must be honest and about that booking. Don’t
            offer or demand anything for a rating.
          </li>
          <li>
            Your trust score is calculated from your bookings, ratings, lender no-shows and disputes lost. It is shown to
            neighbours on your listings, bookings and chats.
          </li>
          <li>If your trust score falls below 2.0, you can’t make new bookings until it recovers.</li>
          <li>We may change how the score is calculated to keep it fair. Trying to manipulate it breaks these terms.</li>
        </UL>
      </Section>

      <Section id="chat" title="12. Chat and conduct">
        <UL>
          <li>
            Chat is for arranging bookings. Be polite. No harassment, threats, hate, sexual content, spam, scams or
            requests to pay outside the booking.
          </li>
          <li>
            <strong>Messages can’t be edited or deleted.</strong> They can be read by the society admin and platform
            admins if a booking with that person goes into dispute, and used as evidence.
          </li>
          <li>Report a message that breaks these rules from the chat. Society admins review reports.</li>
          <li>
            Don’t misuse other residents’ personal details (phone, flat, UPI ID) for anything other than the booking.
          </li>
        </UL>
      </Section>

      <Section id="admins" title="13. Society admins">
        <UL>
          <li>
            Society admins are residents or committee members of your society, authorised by your RWA or committee and
            approved by 3PandaLabs after a document check. <strong>They are not 3PandaLabs staff or agents.</strong>
          </li>
          <li>
            They approve and revoke memberships, set the society’s deposit mode and boundary, review reported messages,
            and rule on disputes they aren’t involved in.
          </li>
          <li>
            Admins must act fairly and use residents’ data only for these tasks. If you think an admin acted unfairly,
            contact us at <Mail to={SUPPORT_EMAIL} />. We can review escalated disputes and remove an admin’s role.
          </li>
        </UL>
      </Section>

      <Section id="suspension" title="14. Suspension and termination">
        <UL>
          <li>
            We or your society admin may limit, suspend or remove your access if you break these terms, put residents at
            risk, give false information, or if the law requires it. Where it is safe and lawful, we will tell you why.
          </li>
          <li>
            You can stop using BorrowVault at any time and ask us to close your account by emailing{" "}
            <Mail to={PRIVACY_EMAIL} />.
          </li>
          <li>
            Closing or losing an account doesn’t cancel what you already owe: open bookings, refunds and awards still
            have to be completed. Sections 8, 10 and 15 to 20 continue to apply.
          </li>
        </UL>
      </Section>

      <Section id="content" title="15. Your content">
        <UL>
          <li>
            You keep ownership of the photos, videos, descriptions, messages and ratings you add (“your content”).
          </li>
          <li>
            You give 3PandaLabs a non-exclusive, royalty-free, worldwide licence to store, copy, display and process your
            content only to run BorrowVault: showing listings to your society, keeping evidence, handling disputes, and
            meeting legal duties. We don’t use your photos in advertising without asking.
          </li>
          <li>
            You promise you have the right to share your content, and that it doesn’t include other people’s faces or
            private details without their permission, beyond what is needed for an inspection.
          </li>
          <li>The BorrowVault name, logo, design and software belong to 3PandaLabs. Don’t copy, scrape or reverse-engineer them.</li>
        </UL>
      </Section>

      <Section id="disclaimers" title="16. Disclaimers">
        <p>
          BorrowVault is provided “as is” and “as available”. We work to keep it running and accurate, but we don’t
          promise it will always be available or error-free. We don’t guarantee any item, skill, resident, listing,
          rating or ruling. You decide whom to deal with and you use items and services at your own risk. Inspect items
          before use and follow their safety instructions.
        </p>
      </Section>

      {/* TODO(anil): the liability cap (₹5,000) is a placeholder; have counsel set it. */}
      <Section id="liability" title="17. Limitation of liability">
        <UL>
          <li>
            3PandaLabs is not liable for anything that happens between residents: damage, loss, injury, theft, late or
            missing payments, the quality of a skill, or a resident’s behaviour.
          </li>
          <li>
            We are not liable for indirect or consequential losses, such as lost income or opportunities, or for losses
            caused by events outside our control (for example outages at our providers, UPI or your bank).
          </li>
          <li>
            If we are found liable to you for anything else, our total liability is limited to ₹5,000 or the fees you
            paid us in the 12 months before the claim, whichever is greater.
          </li>
          <li>
            Nothing in these terms limits liability that the law doesn’t allow to be limited, such as for fraud, or for
            death or personal injury caused by our negligence.
          </li>
        </UL>
      </Section>

      <Section id="indemnity" title="18. Indemnity">
        <p>
          If someone makes a claim against 3PandaLabs because of your listing, item, skill, content, or your breach of
          these terms or the law, you agree to cover our reasonable losses and costs from that claim. This doesn’t apply
          to the extent the claim was caused by our own fault.
        </p>
      </Section>

      <Section id="changes" title="19. Changes to these terms">
        <p>
          We may update these terms as BorrowVault changes. We will update the “last updated” date, and for significant
          changes we will tell you by email or in the app at least 15 days before they apply. Changes don’t affect
          bookings already in progress. If you keep using BorrowVault after a change applies, you accept the new terms.
        </p>
      </Section>

      {/* TODO(anil): have counsel confirm the New Jersey choice of law and forum
          is enforceable against Indian consumers alongside the CPA 2019 carve-out. */}
      <Section id="law" title="20. Governing law">
        <UL>
          <li>
            These terms are governed by the laws of the State of New Jersey, USA, and disputes with 3PandaLabs are heard
            in the courts of New Jersey.
          </li>
          <li>
            If you live in India, this doesn’t take away any protection you have under Indian law that can’t be excluded
            by contract, including the Consumer Protection Act, 2019, the Information Technology Act, 2000 and the
            Digital Personal Data Protection Act, 2023. You can still bring a complaint to an Indian consumer commission
            or authority where that law allows.
          </li>
          <li>
            Disputes between residents about a booking are between them, under the law that applies to them, and are not
            governed by this section.
          </li>
          <li>
            Before starting any formal claim against us, please contact us first. We will try to resolve it within 30
            days.
          </li>
          <li>
            If any part of these terms is unenforceable, the rest still applies. If we don’t enforce a term straight
            away, we can still enforce it later.
          </li>
        </UL>
      </Section>

      <Section id="contact" title="21. Contact and grievances">
        <p>
          Questions about these terms: <Mail to={SUPPORT_EMAIL} />.
        </p>
        <p>
          To complain about content on BorrowVault or how we handled your data, contact the Grievance Officer,
          3PandaLabs, at <Mail to={PRIVACY_EMAIL} />. We acknowledge complaints within 24 hours and aim to resolve them
          within 15 days. Details are in our <A href="/privacy#grievance">Privacy Policy</A>.
        </p>
      </Section>
    </LegalPage>
  );
}
