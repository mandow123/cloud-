import type { Metadata } from "next";
import Link from "next/link";
import { ManagedGpuCatalog } from "@/components/managed-gpu-catalog";
import styles from "@/components/managed-gpu.module.css";

export const metadata: Metadata = { title: "GPU 云托管", description: "购买独立确权的实体 GPU，选择机房托管或全球寄送。" };

export default function ManagedGpuPage() {
  return <div className={styles.page}>
    <header className={styles.hero}><div className={`shell ${styles.heroInner}`}>
      <div><p className={styles.eyebrow}>MANAGED PHYSICAL GPU</p><h1>GPU 云托管</h1><p>向认证供应商购买整张实体 GPU，选择北斗机房托管或全球寄送。托管设备只按真实成交产生不可提现、不可转让的 KAI 标准卡时。</p></div>
      <nav className={styles.routeLinks} aria-label="GPU 云托管快捷入口"><Link href="/member/gpu-assets">我的 GPU</Link><Link href="/member/gpu-hosting/orders">购买订单</Link><Link href="/member/gpu-hosting/earnings">托管产出卡时</Link><Link href="/buy">租用 GPU 算力</Link></nav>
    </div></header>
    <main className={`shell ${styles.workspace}`}>
      <nav className={styles.modeTabs} aria-label="GPU 服务类型"><Link href="/buy">租用 GPU</Link><Link className={styles.active} aria-current="page" href="/managed-gpu">GPU 云托管</Link></nav>
      <ManagedGpuCatalog />
    </main>
  </div>;
}
