"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { marketplaceErrorMessage } from "@/lib/client/marketplace-client";
import { getSupplyOffers, supplyApiUnavailable, type SupplyOffer } from "@/components/supply-api-client";

const supplierLabels: Record<SupplyOffer["supplierType"], string> = {
  INDIVIDUAL: "个人",
  COMPANY: "企业",
  IDC: "IDC",
  CLOUD_VENDOR: "云厂商",
};

const resourceLabels: Record<SupplyOffer["resourceType"], string> = {
  GPU_CARD: "GPU 显卡",
  GPU_SERVER: "GPU 服务器",
  CPU_SERVER: "CPU 服务器",
  MAC_COMPUTE: "Mac 算力",
  TOKEN_CAPACITY: "Token 容量",
  MODEL_INSTANCE: "模型实例",
  NAS_STORAGE: "NAS 存储",
  RACK_CAPACITY: "机柜容量",
  CLOUD_RESOURCE: "云厂商资源",
};

const unitLabels: Record<SupplyOffer["quantityUnit"], string> = {
  CARD: "卡",
  NODE: "节点",
  SERVER: "服务器",
  M_TOKENS_PER_HOUR: "百万 Token/小时",
  MODEL_INSTANCE: "模型实例",
  TIB: "TiB",
  RACK: "机柜",
  KW: "kW",
  QUOTA_UNIT: "配额单位",
};

const pricingLabels: Record<SupplyOffer["pricingUnit"], string> = {
  CARD_HOUR: "卡时",
  NODE_HOUR: "节点时",
  SERVER_HOUR: "服务器时",
  TOKEN_CAPACITY_HOUR: "Token 容量时",
  MODEL_INSTANCE_HOUR: "模型实例时",
  TIB_HOUR: "TiB时",
  RACK_MONTH: "柜月",
  KW_MONTH: "kW月",
  QUOTA_HOUR: "配额时",
};

function availability(offer: SupplyOffer) {
  if (!offer.availabilityStartAt && !offer.availabilityEndAt) return "长期 / 待确认";
  const start = offer.availabilityStartAt ? new Date(offer.availabilityStartAt).toLocaleString("zh-CN") : "未指定";
  const end = offer.availabilityEndAt ? new Date(offer.availabilityEndAt).toLocaleString("zh-CN") : "未指定";
  return `${start} — ${end}`;
}

export function SupplyOffersList() {
  const [offers, setOffers] = useState<SupplyOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setOffers(await getSupplyOffers());
    } catch (loadError) {
      setError(supplyApiUnavailable(loadError)
        ? "通用上架记录 API 尚未就绪；本页不会用本地样本代替。"
        : marketplaceErrorMessage(loadError, "暂时无法读取通用上架记录。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getSupplyOffers()
      .then((items) => { if (!cancelled) setOffers(items); })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(supplyApiUnavailable(loadError)
          ? "通用上架记录 API 尚未就绪；本页不会用本地样本代替。"
          : marketplaceErrorMessage(loadError, "暂时无法读取通用上架记录。"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="border-b border-[var(--border)] pb-12" aria-labelledby="general-offers-title">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="kicker">General supply records</p>
          <h2 className="section-heading" id="general-offers-title">通用上架记录</h2>
          <p className="section-lead text-base">展示 `/api/v1/supply/offers` 返回的真实记录；它们是供给申报，不等同于已成交。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="button button-secondary" disabled={loading} onClick={() => void load()} type="button">{loading ? "正在刷新…" : "刷新记录"}</button>
          <Link className="button button-primary" href="/supply/new">新增资源上架</Link>
        </div>
      </div>

      {error ? <div className="mt-6 border-l-4 border-[var(--error)] bg-[var(--error-bg)] p-5 text-[var(--error)]" role="alert">{error}</div> : null}
      {loading && offers.length === 0 ? <p className="mt-6 border-l-2 border-[var(--accent)] pl-4" role="status">正在读取通用上架记录…</p> : null}
      {!loading && !error && offers.length === 0 ? (
        <div className="mt-7 bg-[var(--info-bg)] p-8 text-center">
          <h3 className="m-0 text-2xl">尚无服务端上架记录</h3>
          <p className="mt-2 text-sm text-[var(--text)]">可从 GPU、服务器、Token、模型、存储、机柜或云资源开始登记。</p>
          <Link className="button button-primary mt-5" href="/supply/new">上架第一条资源</Link>
        </div>
      ) : null}

      {offers.length > 0 ? (
        <div className="mt-7 overflow-x-auto border border-[var(--border)]">
          <table className="data-table min-w-[1120px]">
            <caption className="sr-only">通用资源上架记录</caption>
            <thead><tr><th scope="col">产品 / 规格</th><th scope="col">供应方 / 类型</th><th className="num" scope="col">数量</th><th scope="col">计价口径</th><th scope="col">地区 / 交付</th><th scope="col">可用时间</th><th scope="col">状态</th></tr></thead>
            <tbody>{offers.map((offer) => (
              <tr key={offer.id}>
                <th scope="row"><strong className="block text-[var(--ink)]">{offer.productName}</strong><span className="mt-1 block max-w-sm text-xs font-normal text-[var(--muted)]">{offer.specification}</span><span className="mt-1 block font-mono text-xs text-[var(--muted)]">{offer.id}</span></th>
                <td>{supplierLabels[offer.supplierType]}<span className="mt-1 block text-xs text-[var(--muted)]">{resourceLabels[offer.resourceType]}</span></td>
                <td className="num">{offer.quantity.toLocaleString("zh-CN")} {unitLabels[offer.quantityUnit]}</td>
                <td>{pricingLabels[offer.pricingUnit]}<span className="mt-1 block font-mono text-xs text-[var(--muted)]">{offer.quantityUnit} / {offer.pricingUnit}</span></td>
                <td>{offer.region}<span className="mt-1 block text-xs text-[var(--muted)]">{offer.deliveryForm}</span></td>
                <td className="text-xs">{availability(offer)}</td>
                <td><strong className="text-[var(--ink)]">{offer.status}</strong></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
