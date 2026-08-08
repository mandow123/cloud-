import Link from "next/link";

const SLOT_FLAG = "KAI_STANDARD_FRONTEND_SLOTS";

const slotDefinitions = {
  "market-standard-card-hour-v1": {
    href: "/market/card-hour",
    label: "查看 KAI 标准卡时",
    className: "mt-5 inline-flex text-sm font-semibold text-[var(--accent)] underline underline-offset-4",
  },
  "member-kai-hours-v1": {
    href: "/member/kai-hours",
    label: "查看我的 KAI 卡时",
    className: "ml-1 font-semibold text-[var(--accent)] underline underline-offset-4",
  },
  "partners-supply-entry-v1": {
    href: "/supply",
    label: "进入资源上架",
    className: "ml-3 inline-flex text-sm font-semibold text-[var(--accent)] underline underline-offset-4",
  },
} as const;

export type KaiStandardSlotId = keyof typeof slotDefinitions;

export function kaiStandardFrontendSlotsEnabled() {
  return process.env[SLOT_FLAG] === "1";
}

export function KaiStandardSlot({ slot }: { slot: KaiStandardSlotId }) {
  if (!kaiStandardFrontendSlotsEnabled()) return null;

  const definition = slotDefinitions[slot];
  return (
    <Link
      className={definition.className}
      data-kai-slot={slot}
      href={definition.href}
      prefetch={false}
    >
      {definition.label}
    </Link>
  );
}
