"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { EmptyState, LoadError, Loading, PageHeader } from "@/components/common";
import { ListingForm } from "@/components/ListingForm";
import { Button } from "@/components/ui/button";
import { getListing, updateListing } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";

export default function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  const listing = useAsync(() => getListing(id), `listing:${id}`);

  if (listing.error) return <LoadError error={listing.error} onRetry={listing.reload} />;
  if (!listing.data) return <Loading />;
  if (listing.data.owner.id !== user.id) {
    return (
      <EmptyState
        title="Only the owner can edit this listing"
        action={
          <Link href={`/listings/${id}`}>
            <Button size="sm">Back to listing</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit listing" subtitle={listing.data.title} />
      <ListingForm
        initial={listing.data}
        submitLabel="Save changes"
        onSubmit={async (v) => {
          await updateListing(id, v);
          router.push(`/listings/${id}`);
        }}
      />
    </div>
  );
}
