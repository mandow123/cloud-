"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const legacyRoutes: Record<string, string> = {
  "#personal-gpu": "/hosting/personal-gpu",
  "#cloud-provider": "/hosting/cloud",
  "#earnings": "/hosting/earnings",
};

export function HostingLegacyHashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const destination = legacyRoutes[window.location.hash];
    if (destination) router.replace(destination);
  }, [router]);

  return null;
}
