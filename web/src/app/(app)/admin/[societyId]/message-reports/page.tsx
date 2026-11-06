"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/common";

/** The report email links here (ROUTES.md "Reported messages"); the console shows it as a tab. */
export default function MessageReportsRedirect() {
  const { societyId } = useParams<{ societyId: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/admin/${societyId}?tab=message-reports`);
  }, [router, societyId]);
  return <Loading />;
}
