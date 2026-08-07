"use client";

import { useEffect } from "react";

const REFERRAL_COOKIE = "kai_ref";
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export function ReferralCapture() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const submittedCode = url.searchParams.get("ref")?.trim();
    if (!submittedCode) return;

    const cookieValue = encodeURIComponent(submittedCode.slice(0, 128));
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${REFERRAL_COOKIE}=${cookieValue}; Path=/; Max-Age=${THIRTY_DAYS_SECONDS}; SameSite=Lax${secure}`;

    url.searchParams.delete("ref");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return null;
}
