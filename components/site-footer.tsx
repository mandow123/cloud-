import { marketSeries } from "@/lib/data";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";
import { readMarketSnapshot } from "@/lib/server/market-snapshot";
import { SiteFooterView } from "@/components/site-footer-view";

export async function SiteFooter() {
  const { snapshot } = await readMarketSnapshot();
  const hostingV2 = isHostingV2Enabled();
  const infrastructureUpdatedAt = marketSeries.reduce(
    (latest, series) => series.updatedAt > latest ? series.updatedAt : latest,
    "",
  );
  return <SiteFooterView hostingV2={hostingV2} infrastructureUpdatedAt={infrastructureUpdatedAt} publishedAt={snapshot.publishedAt} />;
}
