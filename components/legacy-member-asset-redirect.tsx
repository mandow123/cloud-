"use client";

import { useEffect } from "react";

export function LegacyMemberAssetRedirect() {
  useEffect(() => {
    if (window.location.hash === "#card-hours") window.location.replace("/member/assets");
  }, []);
  return null;
}
