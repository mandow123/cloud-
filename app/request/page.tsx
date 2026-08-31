import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { RequestWorkbench, type RequestPrefill } from "@/components/request-workbench";
import { resourceListings, serviceAliases } from "@/lib/data";
import type { Locale } from "@/lib/i18n";
import { categoryPricingUnits, marketplaceCategories } from "@/lib/marketplace";
import { getRequestLocale } from "@/lib/server/request-locale";
import type { DealMode, PricingUnit, ResourceCategory } from "@/lib/types";

type RequestPageCopy = Readonly<{
  metadataTitle: string;
  metadataDescription: string;
  kicker: string;
  title: string;
  lead: string;
  retentionTitle: string;
  retentionBody: string;
}>;

const PAGE_COPY = {
  "zh-CN": { metadataTitle: "提交算力需求", metadataDescription: "提交 GPU、Token、模型、整机柜与云厂商资源的租赁、服务采购或双边置换需求。", kicker: "需求工作台", title: "把需求说清楚，再比较标准化方案", lead: "租赁或服务采购可直接描述目标资源；置换则分别填写“我可提供”和“我需要”。", retentionTitle: "登录主体 · 服务端留存", retentionBody: "提交后会生成需求编号并绑定当前交易主体，供工作台两侧继续流转；正式采购、合同与资源开通需双方另行确认。" },
  "zh-TW": { metadataTitle: "提交算力需求", metadataDescription: "提交 GPU、Token、模型、整機櫃與雲端供應商資源的租賃、服務採購或雙邊置換需求。", kicker: "需求工作台", title: "說清楚需求，再比較標準化方案", lead: "租賃或服務採購可直接描述目標資源；置換則分別填寫「我可提供」與「我需要」。", retentionTitle: "登入主體 · 服務端留存", retentionBody: "提交後會產生需求編號並綁定目前交易主體，供工作台雙方繼續流轉；正式採購、合約與資源開通需雙方另行確認。" },
  en: { metadataTitle: "Submit a compute request", metadataDescription: "Submit rental, service procurement or bilateral exchange requirements for GPUs, tokens, models, full racks and cloud-provider resources.", kicker: "DEMAND WORKBENCH", title: "Describe the requirement clearly, then compare standardized solutions", lead: "For rentals or service procurement, describe the target resource directly. For exchanges, complete both “What I can offer” and “What I need.”", retentionTitle: "Signed-in entity · Stored on server", retentionBody: "Submission creates a request ID tied to the current trading entity so both sides can continue the workflow. Formal procurement, contracts and resource activation require separate confirmation by both parties." },
  ja: { metadataTitle: "算力要件を送信", metadataDescription: "GPU、Token、モデル、ラック全体、クラウド事業者リソースのレンタル、サービス調達、双方向交換要件を送信します。", kicker: "要件ワークベンチ", title: "要件を明確にしてから標準化された提案を比較", lead: "レンタルまたはサービス調達では対象リソースを直接記述します。交換では「提供できるもの」と「必要なもの」をそれぞれ入力します。", retentionTitle: "ログイン主体 · サーバー保存", retentionBody: "送信すると現在の取引主体に紐づく要件番号が生成され、双方のワークベンチで処理を継続できます。正式な調達、契約、リソース開通は双方の別途確認が必要です。" },
  ko: { metadataTitle: "컴퓨팅 요구사항 제출", metadataDescription: "GPU, Token, 모델, 전체 랙 및 클라우드 공급업체 리소스의 대여, 서비스 조달 또는 양자 교환 요구사항을 제출합니다.", kicker: "요구사항 워크벤치", title: "요구사항을 명확히 설명한 후 표준화된 방안을 비교하세요", lead: "대여 또는 서비스 조달은 대상 리소스를 직접 설명하고, 교환은 ‘제공 가능’과 ‘필요 리소스’를 각각 작성합니다.", retentionTitle: "로그인 주체 · 서버 저장", retentionBody: "제출하면 현재 거래 주체에 연결된 요구사항 번호가 생성되어 양측 워크벤치에서 계속 처리할 수 있습니다. 정식 조달, 계약 및 리소스 개통은 양측의 별도 확인이 필요합니다." },
  fr: { metadataTitle: "Soumettre un besoin de calcul", metadataDescription: "Soumettez un besoin de location, d’achat de services ou d’échange bilatéral pour des GPU, tokens, modèles, baies complètes et ressources cloud.", kicker: "ESPACE DES BESOINS", title: "Décrivez clairement le besoin, puis comparez les solutions standardisées", lead: "Pour une location ou un achat de services, décrivez directement la ressource cible. Pour un échange, renseignez séparément « Ce que je propose » et « Ce dont j’ai besoin ».", retentionTitle: "Entité connectée · Conservation serveur", retentionBody: "L’envoi crée un identifiant de demande lié à l’entité de transaction actuelle afin que les deux parties poursuivent le traitement. L’achat officiel, le contrat et l’activation des ressources nécessitent une confirmation distincte des deux parties." },
  th: { metadataTitle: "ส่งความต้องการพลังประมวลผล", metadataDescription: "ส่งความต้องการเช่า จัดซื้อบริการ หรือแลกเปลี่ยนสองฝ่ายสำหรับ GPU, Token, โมเดล, ตู้เต็ม และทรัพยากรผู้ให้บริการคลาวด์", kicker: "พื้นที่จัดการความต้องการ", title: "อธิบายความต้องการให้ชัดเจน แล้วเปรียบเทียบแนวทางมาตรฐาน", lead: "การเช่าหรือจัดซื้อบริการสามารถอธิบายทรัพยากรเป้าหมายได้โดยตรง ส่วนการแลกเปลี่ยนให้กรอกทั้ง “สิ่งที่ฉันเสนอได้” และ “สิ่งที่ฉันต้องการ”", retentionTitle: "บัญชีที่เข้าสู่ระบบ · เก็บบนเซิร์ฟเวอร์", retentionBody: "เมื่อส่ง ระบบจะสร้างหมายเลขความต้องการและผูกกับคู่สัญญาปัจจุบัน เพื่อให้ทั้งสองฝ่ายดำเนินงานต่อได้ การจัดซื้อ สัญญา และเปิดใช้ทรัพยากรอย่างเป็นทางการต้องได้รับการยืนยันแยกจากทั้งสองฝ่าย" },
  vi: { metadataTitle: "Gửi nhu cầu tính toán", metadataDescription: "Gửi nhu cầu thuê, mua dịch vụ hoặc hoán đổi song phương đối với GPU, Token, mô hình, tủ máy nguyên bộ và tài nguyên nhà cung cấp đám mây.", kicker: "KHÔNG GIAN NHU CẦU", title: "Mô tả rõ nhu cầu rồi so sánh các giải pháp chuẩn hóa", lead: "Đối với thuê hoặc mua dịch vụ, hãy mô tả trực tiếp tài nguyên mục tiêu. Đối với hoán đổi, điền riêng “Tôi có thể cung cấp” và “Tôi cần”.", retentionTitle: "Chủ thể đã đăng nhập · Lưu trên máy chủ", retentionBody: "Sau khi gửi, hệ thống tạo mã nhu cầu gắn với chủ thể giao dịch hiện tại để hai bên tiếp tục xử lý. Việc mua chính thức, hợp đồng và kích hoạt tài nguyên cần hai bên xác nhận riêng." },
  id: { metadataTitle: "Ajukan kebutuhan komputasi", metadataDescription: "Ajukan kebutuhan sewa, pengadaan layanan, atau pertukaran bilateral untuk GPU, Token, model, rak penuh, dan sumber daya penyedia cloud.", kicker: "RUANG KERJA KEBUTUHAN", title: "Jelaskan kebutuhan, lalu bandingkan solusi terstandar", lead: "Untuk sewa atau pengadaan layanan, jelaskan sumber daya target secara langsung. Untuk pertukaran, isi “Yang dapat saya tawarkan” dan “Yang saya butuhkan” secara terpisah.", retentionTitle: "Entitas masuk · Disimpan di server", retentionBody: "Pengajuan membuat ID kebutuhan yang terikat pada entitas transaksi saat ini agar kedua pihak dapat melanjutkan alur kerja. Pengadaan resmi, kontrak, dan aktivasi sumber daya memerlukan konfirmasi terpisah dari kedua pihak." },
  ms: { metadataTitle: "Hantar keperluan pengkomputeran", metadataDescription: "Hantar keperluan sewaan, perolehan perkhidmatan atau pertukaran dua hala untuk GPU, Token, model, rak penuh dan sumber pembekal awan.", kicker: "RUANG KERJA KEPERLUAN", title: "Terangkan keperluan dengan jelas, kemudian bandingkan penyelesaian piawai", lead: "Untuk sewaan atau perolehan perkhidmatan, terangkan sumber sasaran secara langsung. Untuk pertukaran, isi “Yang boleh saya tawarkan” dan “Yang saya perlukan” secara berasingan.", retentionTitle: "Entiti dilog masuk · Disimpan pada pelayan", retentionBody: "Penghantaran mencipta ID keperluan yang terikat pada entiti transaksi semasa supaya kedua-dua pihak dapat meneruskan aliran kerja. Perolehan rasmi, kontrak dan pengaktifan sumber memerlukan pengesahan berasingan daripada kedua-dua pihak." },
} as const satisfies Record<Locale, RequestPageCopy>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const copy = PAGE_COPY[locale];
  return { title: copy.metadataTitle, description: copy.metadataDescription };
}

type RequestPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RequestPage({ searchParams }: RequestPageProps) {
  const locale = await getRequestLocale();
  const copy = PAGE_COPY[locale];
  const params = await searchParams;
  const listingId = first(params.listing) ?? first(params.resource);
  const serviceSlug = first(params.service) ?? first(params.alias);
  const requestedMode = first(params.mode) ?? first(params.deal);
  const requestedCategory = first(params.category);
  const requestedUnit = first(params.unit);
  const requestedTitle = first(params.title);
  const requestedRegion = first(params.region);
  const listing = listingId ? resourceListings.find((item) => item.id === listingId) : undefined;
  const service = serviceSlug ? serviceAliases.find((item) => item.slug === serviceSlug) : undefined;
  const directCategory = marketplaceCategories.includes(requestedCategory as ResourceCategory)
    ? requestedCategory as ResourceCategory
    : undefined;
  const directUnit = directCategory && categoryPricingUnits[directCategory].includes(requestedUnit as PricingUnit)
    ? requestedUnit as PricingUnit
    : undefined;

  const mode: DealMode =
    requestedMode === "swap" || requestedMode === "service" || requestedMode === "rental"
      ? requestedMode
      : service?.dealMode ?? listing?.dealModes[0] ?? "rental";
  const prefill: RequestPrefill | undefined = listing
    ? { title: listing.title, category: listing.category, pricingUnit: listing.pricingUnit, region: listing.region }
    : service
      ? { title: service.label, category: service.category, pricingUnit: service.pricingUnit }
      : directCategory
        ? { title: requestedTitle, category: directCategory, pricingUnit: directUnit ?? categoryPricingUnits[directCategory][0], region: requestedRegion }
        : undefined;

  return (
    <AccountRequired purpose="提交算力需求" redirectOnSignedOut>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-12 sm:py-16">
          <p className="kicker">{copy.kicker}</p>
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div><h1 className="m-0 max-w-4xl text-4xl leading-tight sm:text-5xl">{copy.title}</h1><p className="section-lead">{copy.lead}</p></div>
            <div className="border-l-2 border-[var(--accent)] pl-5 text-sm text-[var(--text)]"><strong className="block text-[var(--ink)]">{copy.retentionTitle}</strong>{copy.retentionBody}</div>
          </div>
        </div>
      </header>
      <div className="shell py-12 sm:py-16"><RequestWorkbench initialMode={mode} initialPrefill={prefill} /></div>
    </AccountRequired>
  );
}
