"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/common";

/**
 * Report emails link here (ROUTES.md "Reports review"). The console shows
 * message, user and listing reports together in its Reports tab.
 */
export default function ReportsRedirect() {
  const { societyId } = useParams<{ societyId: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/admin/${societyId}?tab=reports`);
  }, [router, societyId]);
  return <Loading />;
}
