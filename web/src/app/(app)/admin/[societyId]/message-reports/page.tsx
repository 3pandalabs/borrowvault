"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/common";

/** Older report emails link here; messages now live in the console's Reports tab. */
export default function MessageReportsRedirect() {
  const { societyId } = useParams<{ societyId: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/admin/${societyId}?tab=reports&kind=messages`);
  }, [router, societyId]);
  return <Loading />;
}
