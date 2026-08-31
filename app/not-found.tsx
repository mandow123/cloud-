import Link from "next/link";
import { getRequestLocale } from "@/lib/server/request-locale";

const copy = {
  "zh-CN": ["没有找到这项资源", "资源可能已被筛选条件隐藏，或当前链接不在已发布数据集中。", "返回资源市场", "返回首页"],
  "zh-TW": ["找不到這項資源", "資源可能被篩選條件隱藏，或目前連結不在已發布資料集中。", "返回資源市場", "返回首頁"],
  en: ["Resource not found", "The resource may be hidden by your filters, or this link is not in the published catalog.", "Back to marketplace", "Back to home"],
  ja: ["リソースが見つかりません", "絞り込み条件で非表示になっているか、このリンクが公開カタログにありません。", "リソース市場へ", "ホームへ"],
  ko: ["리소스를 찾을 수 없습니다", "필터로 숨겨졌거나 이 링크가 공개 카탈로그에 없을 수 있습니다.", "리소스 시장으로", "홈으로"],
  fr: ["Ressource introuvable", "La ressource est peut-être masquée par vos filtres ou absente du catalogue publié.", "Retour au marché", "Retour à l’accueil"],
  th: ["ไม่พบทรัพยากร", "ทรัพยากรอาจถูกซ่อนด้วยตัวกรอง หรือลิงก์นี้ไม่อยู่ในแค็ตตาล็อกที่เผยแพร่", "กลับไปตลาดทรัพยากร", "กลับหน้าแรก"],
  vi: ["Không tìm thấy tài nguyên", "Tài nguyên có thể bị ẩn bởi bộ lọc hoặc liên kết này không có trong danh mục đã công bố.", "Về thị trường", "Về trang chủ"],
  id: ["Sumber daya tidak ditemukan", "Sumber daya mungkin tersembunyi oleh filter atau tautan ini tidak ada di katalog terbitan.", "Kembali ke pasar", "Kembali ke beranda"],
  ms: ["Sumber tidak ditemui", "Sumber mungkin disembunyikan oleh penapis atau pautan ini tiada dalam katalog diterbitkan.", "Kembali ke pasaran", "Kembali ke laman utama"],
} as const;

export default async function NotFound() {
  const [title, description, marketplace, home] = copy[await getRequestLocale()];
  return (
    <section className="narrow-shell py-24 lg:py-32">
      <p className="kicker">404 / Resource Not Found</p>
      <h1 className="text-4xl leading-tight sm:text-5xl">{title}</h1>
      <p className="mt-5 max-w-2xl text-lg">{description}</p>
      <div className="mt-9 flex flex-wrap gap-3">
        <Link className="button button-primary" href="/resources">{marketplace}</Link>
        <Link className="button button-secondary" href="/">{home}</Link>
      </div>
    </section>
  );
}
