"use client";

import { useRouter } from "next/navigation";
import { RequireApproved } from "@/components/AppShell";
import { PageHeader } from "@/components/common";
import { ListingForm } from "@/components/ListingForm";
import { createListing } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function NewListingPage() {
  return (
    <RequireApproved>
      <NewListing />
    </RequireApproved>
  );
}

function NewListing() {
  const router = useRouter();
  const { active } = useSession();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="List something" subtitle={`Visible only to approved residents of ${active!.societyName}.`} />
      <ListingForm
        submitLabel="Publish listing"
        onSubmit={async (v) => {
          const l = await createListing({ ...v, societyId: active!.societyId });
          router.push(`/listings/${l.id}`);
        }}
      />
    </div>
  );
}
