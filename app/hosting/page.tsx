import type { Metadata } from "next";
import Link from "next/link";
import { HostingLegacyHashRedirect } from "@/components/hosting-legacy-hash-redirect";
import { HostingLaunchpad } from "@/components/hosting-launchpad";
import {
  HostingPublicShell,
  SectionHeader,
  hostingPublicStyles as styles,
} from "@/components/hosting-public-shell";
import type { Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/server/request-locale";

type HostingPageCopy = {
  metadata: readonly [string, string]; hero: readonly [string, string, string, string];
  section: readonly [string, string, string]; process: ReadonlyArray<readonly [string, string, string]>;
  notice: readonly [string, string, string, string];
};

const HOSTING_PAGE_COPY: Record<Locale, HostingPageCopy> = {
  "zh-CN": { metadata: ["Hosting 算力上架", "个人 GPU、云服务器与数据中心统一上架、验真、交付与结算。"], hero: ["KAI HOSTING · 已验证算力网络", "让闲置算力，安全地开始工作。", "Put verified compute to work.", "从一张 GPU 到一笔真实订单：平台完成验真、挂牌、交付、按秒计量、卡时结算与清理再售。"], section: ["合同状态机", "每一阶段都由前后端共同确认", "成交时冻结规格与费率；交付、计量、验收和清理都由后端状态机约束。"], process: [["登记资源", "提交设备、网络、权属与可用时间。", "供应方"], ["平台验真", "Agent 签名上报硬件证据并运行受控负载。", "自动 + 人审"], ["发布报价", "冻结规格、卡时单价、最低时长与费率版本。", "供应方"], ["锁定卡时", "买家余额先锁定，避免库存和余额并发超卖。", "平台账本"], ["实例交付", "创建独立容器、注入临时 SSH 密钥并确认可连接。", "Host Agent"], ["计量结算", "按实际秒数扣减，释放余量并生成租金与佣金。", "平台账本"], ["撤权清理", "撤销密钥、删除工作区；证据完整后恢复可售。", "Host Agent"]], notice: ["首期只开放单张 RTX 4090 / H100", "先完成一台机器、一份报价、一笔三分钟订单和一次彻底清理。公开充值、卡时回购和未验收连接器继续关闭。", "开始上架", "Host Agent 教程"] },
  "zh-TW": { metadata: ["Hosting 算力上架", "個人 GPU、雲端伺服器與資料中心統一上架、驗真、交付與結算。"], hero: ["KAI HOSTING · 已驗證算力網路", "讓閒置算力安全開始工作。", "Put verified compute to work.", "從一張 GPU 到一筆真實訂單：平台完成驗真、掛牌、交付、按秒計量、卡時結算與清理再售。"], section: ["合約狀態機", "每個階段都由前後端共同確認", "成交時凍結規格與費率；交付、計量、驗收與清理由後端狀態機約束。"], process: [["登記資源", "提交裝置、網路、權屬與可用時間。", "供應方"], ["平台驗真", "Agent 簽名上報硬體證據並執行受控負載。", "自動 + 人審"], ["發布報價", "凍結規格、卡時單價、最低時長與費率版本。", "供應方"], ["鎖定卡時", "先鎖定買家餘額，避免並行超賣。", "平台帳本"], ["執行個體交付", "建立獨立容器、注入臨時 SSH 金鑰並確認連線。", "Host Agent"], ["計量結算", "依實際秒數扣減、釋放餘量並產生租金與佣金。", "平台帳本"], ["撤權清理", "撤銷金鑰並刪除工作區；證據完整後恢復可售。", "Host Agent"]], notice: ["首期僅開放單張 RTX 4090 / H100", "先完成一台機器、一份報價、一筆三分鐘訂單與一次徹底清理。公開儲值、卡時回購與未驗收連接器繼續關閉。", "開始上架", "Host Agent 教學"] },
  en: { metadata: ["List compute on Hosting", "A unified path to list, verify, deliver, and settle personal GPUs, cloud servers, and data centers."], hero: ["KAI HOSTING · VERIFIED COMPUTE NETWORK", "Put idle compute safely to work.", "Put verified compute to work.", "From one GPU to a real order: verification, listing, delivery, per-second metering, card-hour settlement, cleanup, and resale."], section: ["CONTRACT STATE MACHINE", "Frontend and backend confirm every stage", "Specifications and fees are frozen at purchase; a backend state machine governs delivery, metering, acceptance, and cleanup."], process: [["Register resource", "Submit device, network, ownership, and availability details.", "Supplier"], ["Platform verification", "The Agent signs hardware evidence and runs a controlled workload.", "Automated + manual"], ["Publish offer", "Freeze specifications, card-hour price, minimum duration, and fee version.", "Supplier"], ["Hold card-hours", "Hold the buyer balance first to prevent concurrent overselling.", "Platform ledger"], ["Deliver instance", "Create an isolated container, inject a temporary SSH key, and confirm access.", "Host Agent"], ["Meter and settle", "Charge actual seconds, release the remainder, and record rent and commission.", "Platform ledger"], ["Revoke and clean", "Revoke keys and delete the workspace; relist only after complete evidence.", "Host Agent"]], notice: ["Initial release: single RTX 4090 / H100 only", "First complete one machine, one offer, one three-minute order, and one thorough cleanup. Public top-ups, card-hour buyback, and unaccepted connectors remain closed.", "Start listing", "Host Agent guide"] },
  ja: { metadata: ["Hosting 計算資源掲載", "個人GPU、クラウドサーバー、データセンターを統一して掲載、検証、納品、決済します。"], hero: ["KAI HOSTING · 検証済み計算ネットワーク", "余剰計算資源を安全に稼働させる。", "Put verified compute to work.", "1枚のGPUから実注文まで：検証、掲載、納品、秒単位計測、カード時間決済、清掃、再販を行います。"], section: ["契約ステートマシン", "各段階をフロントエンドとバックエンドで確認", "成約時に仕様と手数料を固定し、納品、計測、検収、清掃をバックエンドが制約します。"], process: [["資源登録", "デバイス、ネットワーク、所有権、利用時間を提出。", "供給者"], ["プラットフォーム検証", "Agent が証拠に署名し、制御負荷を実行。", "自動 + 手動"], ["見積公開", "仕様、カード時間価格、最低時間、手数料版を固定。", "供給者"], ["カード時間確保", "買い手残高を先に確保し、並行超過販売を防止。", "台帳"], ["インスタンス納品", "隔離コンテナと一時SSH鍵を作成し接続確認。", "Host Agent"], ["計測と決済", "実秒数を課金し、余剰を解放して賃料と手数料を記録。", "台帳"], ["権限撤回と清掃", "鍵と作業領域を削除し、証拠完了後に再販。", "Host Agent"]], notice: ["初期は単体 RTX 4090 / H100 のみ", "まず1台、1見積、3分注文、完全清掃を完了します。公開入金、買戻し、未検収接続は閉鎖を維持します。", "掲載を開始", "Host Agent ガイド"] },
  ko: { metadata: ["Hosting 컴퓨팅 등록", "개인 GPU, 클라우드 서버 및 데이터 센터의 등록, 검증, 인도 및 정산을 통합합니다."], hero: ["KAI HOSTING · 검증된 컴퓨팅 네트워크", "유휴 컴퓨팅을 안전하게 가동하세요.", "Put verified compute to work.", "GPU 한 장에서 실제 주문까지: 검증, 게시, 인도, 초 단위 계량, 카드시간 정산, 정리와 재판매를 수행합니다."], section: ["계약 상태 머신", "모든 단계를 프런트엔드와 백엔드가 확인", "거래 시 사양과 수수료를 고정하며 인도, 계량, 검수, 정리는 백엔드 상태 머신이 제어합니다."], process: [["리소스 등록", "장치, 네트워크, 소유권 및 가용 시간을 제출합니다.", "공급자"], ["플랫폼 검증", "Agent가 하드웨어 증거에 서명하고 제어된 부하를 실행합니다.", "자동 + 수동"], ["견적 게시", "사양, 카드시간 단가, 최소 시간 및 수수료 버전을 고정합니다.", "공급자"], ["카드시간 잠금", "구매자 잔액을 먼저 잠가 동시 초과 판매를 방지합니다.", "플랫폼 원장"], ["인스턴스 인도", "격리 컨테이너와 임시 SSH 키를 만들고 연결을 확인합니다.", "Host Agent"], ["계량 및 정산", "실제 초를 차감하고 잔여분을 해제해 임대료와 수수료를 기록합니다.", "플랫폼 원장"], ["권한 회수 및 정리", "키와 작업 공간을 삭제하고 증거 완료 후 재판매합니다.", "Host Agent"]], notice: ["초기에는 단일 RTX 4090 / H100만 지원", "먼저 장비 1대, 견적 1개, 3분 주문 1건과 완전한 정리를 완료합니다. 공개 충전, 환매 및 미검수 연결은 닫혀 있습니다.", "등록 시작", "Host Agent 가이드"] },
  fr: { metadata: ["Publier du calcul sur Hosting", "Un parcours unifié pour publier, vérifier, livrer et régler GPU personnels, serveurs cloud et centres de données."], hero: ["KAI HOSTING · RÉSEAU DE CALCUL VÉRIFIÉ", "Mettez le calcul inutilisé au travail en toute sécurité.", "Put verified compute to work.", "D’un GPU à une commande réelle : vérification, publication, livraison, mesure à la seconde, règlement en heures-carte, nettoyage et remise en vente."], section: ["MACHINE D’ÉTAT DU CONTRAT", "Chaque étape est confirmée côté interface et serveur", "Les caractéristiques et frais sont figés à l’achat ; livraison, mesure, réception et nettoyage sont régis par le serveur."], process: [["Enregistrer la ressource", "Soumettre appareil, réseau, propriété et disponibilité.", "Fournisseur"], ["Vérification plateforme", "L’Agent signe les preuves matérielles et exécute une charge contrôlée.", "Automatique + manuel"], ["Publier l’offre", "Figer caractéristiques, prix, durée minimale et version de frais.", "Fournisseur"], ["Bloquer les heures-carte", "Bloquer d’abord le solde acheteur pour éviter la survente.", "Registre"], ["Livrer l’instance", "Créer un conteneur isolé, injecter une clé SSH temporaire et confirmer l’accès.", "Host Agent"], ["Mesurer et régler", "Débiter les secondes réelles, libérer le solde et inscrire loyer et commission.", "Registre"], ["Révoquer et nettoyer", "Révoquer les clés, supprimer l’espace et ne republier qu’après preuve complète.", "Host Agent"]], notice: ["Première version : une seule RTX 4090 / H100", "Finalisons d’abord une machine, une offre, une commande de trois minutes et un nettoyage complet. Recharges publiques, rachat et connecteurs non validés restent fermés.", "Commencer à publier", "Guide Host Agent"] },
  th: { metadata: ["ลงรายการพลังประมวลผล Hosting", "ช่องทางรวมสำหรับลงรายการ ตรวจสอบ ส่งมอบ และชำระ GPU ส่วนบุคคล เซิร์ฟเวอร์คลาวด์ และศูนย์ข้อมูล"], hero: ["KAI HOSTING · เครือข่ายพลังประมวลผลที่ตรวจสอบแล้ว", "นำพลังประมวลผลที่ว่างมาใช้งานอย่างปลอดภัย", "Put verified compute to work.", "จาก GPU หนึ่งใบสู่คำสั่งซื้อจริง: ตรวจสอบ ลงรายการ ส่งมอบ วัดรายวินาที ชำระด้วยชั่วโมงการ์ด ทำความสะอาด และขายต่อ"], section: ["สถานะสัญญา", "ทุกขั้นตอนยืนยันร่วมกันทั้งหน้าเว็บและเซิร์ฟเวอร์", "สเปกและค่าธรรมเนียมถูกตรึงเมื่อซื้อ การส่งมอบ การวัด การตรวจรับ และการล้างถูกควบคุมโดยเซิร์ฟเวอร์"], process: [["ลงทะเบียนทรัพยากร", "ส่งข้อมูลอุปกรณ์ เครือข่าย สิทธิ์ และเวลาพร้อมใช้", "ผู้ให้บริการ"], ["ตรวจสอบโดยแพลตฟอร์ม", "Agent ลงนามหลักฐานฮาร์ดแวร์และรันงานควบคุม", "อัตโนมัติ + เจ้าหน้าที่"], ["เผยแพร่ข้อเสนอ", "ตรึงสเปก ราคาชั่วโมงการ์ด เวลาขั้นต่ำ และเวอร์ชันค่าธรรมเนียม", "ผู้ให้บริการ"], ["ล็อกชั่วโมงการ์ด", "ล็อกยอดผู้ซื้อก่อนเพื่อป้องกันการขายเกินพร้อมกัน", "บัญชีแพลตฟอร์ม"], ["ส่งมอบอินสแตนซ์", "สร้างคอนเทนเนอร์แยก ใส่ SSH ชั่วคราว และยืนยันการเชื่อมต่อ", "Host Agent"], ["วัดและชำระ", "หักตามวินาทีจริง คืนส่วนเหลือ และบันทึกค่าเช่ากับค่าธรรมเนียม", "บัญชีแพลตฟอร์ม"], ["ถอนสิทธิ์และล้าง", "ถอนคีย์ ลบพื้นที่ และขายต่อเมื่อหลักฐานครบ", "Host Agent"]], notice: ["ช่วงแรกเปิดเฉพาะ RTX 4090 / H100 ใบเดียว", "เริ่มจากเครื่องหนึ่งเครื่อง ข้อเสนอหนึ่งรายการ คำสั่งซื้อสามนาที และการล้างครบถ้วน การเติมเงินสาธารณะ การรับซื้อคืน และตัวเชื่อมต่อที่ยังไม่ตรวจรับยังคงปิด", "เริ่มลงรายการ", "คู่มือ Host Agent"] },
  vi: { metadata: ["Đăng năng lực lên Hosting", "Quy trình thống nhất để đăng, xác minh, bàn giao và quyết toán GPU cá nhân, máy chủ cloud và trung tâm dữ liệu."], hero: ["KAI HOSTING · MẠNG NĂNG LỰC ĐÃ XÁC MINH", "Đưa năng lực nhàn rỗi vào hoạt động an toàn.", "Put verified compute to work.", "Từ một GPU đến đơn hàng thật: xác minh, đăng bán, bàn giao, đo theo giây, quyết toán giờ-thẻ, dọn dẹp và bán lại."], section: ["MÁY TRẠNG THÁI HỢP ĐỒNG", "Mỗi giai đoạn được cả giao diện và máy chủ xác nhận", "Thông số và phí được khóa khi mua; bàn giao, đo lường, nghiệm thu và dọn dẹp do máy chủ kiểm soát."], process: [["Đăng ký tài nguyên", "Gửi thiết bị, mạng, quyền sở hữu và thời gian khả dụng.", "Nhà cung cấp"], ["Xác minh nền tảng", "Agent ký bằng chứng phần cứng và chạy tải kiểm soát.", "Tự động + thủ công"], ["Công bố báo giá", "Khóa thông số, giá giờ-thẻ, thời lượng tối thiểu và phiên bản phí.", "Nhà cung cấp"], ["Giữ giờ-thẻ", "Giữ số dư người mua trước để tránh bán vượt đồng thời.", "Sổ cái"], ["Bàn giao phiên bản", "Tạo container cách ly, chèn khóa SSH tạm thời và xác nhận kết nối.", "Host Agent"], ["Đo và quyết toán", "Trừ theo giây thực tế, giải phóng phần dư và ghi tiền thuê, hoa hồng.", "Sổ cái"], ["Thu hồi và dọn dẹp", "Thu hồi khóa, xóa không gian và chỉ bán lại khi đủ bằng chứng.", "Host Agent"]], notice: ["Giai đoạn đầu chỉ hỗ trợ một RTX 4090 / H100", "Trước tiên hoàn tất một máy, một báo giá, một đơn ba phút và một lần dọn sạch. Nạp công khai, mua lại và kết nối chưa nghiệm thu vẫn đóng.", "Bắt đầu đăng", "Hướng dẫn Host Agent"] },
  id: { metadata: ["Listing komputasi di Hosting", "Alur terpadu untuk listing, verifikasi, pengiriman, dan penyelesaian GPU pribadi, server cloud, serta pusat data."], hero: ["KAI HOSTING · JARINGAN KOMPUTASI TERVERIFIKASI", "Aktifkan komputasi menganggur dengan aman.", "Put verified compute to work.", "Dari satu GPU hingga pesanan nyata: verifikasi, listing, pengiriman, metering per detik, penyelesaian jam-kartu, pembersihan, dan penjualan ulang."], section: ["MESIN STATUS KONTRAK", "Setiap tahap dikonfirmasi frontend dan backend", "Spesifikasi dan biaya dibekukan saat pembelian; pengiriman, metering, penerimaan, dan pembersihan dikendalikan backend."], process: [["Daftarkan sumber daya", "Kirim perangkat, jaringan, kepemilikan, dan waktu tersedia.", "Pemasok"], ["Verifikasi platform", "Agent menandatangani bukti perangkat keras dan menjalankan beban terkontrol.", "Otomatis + manual"], ["Terbitkan penawaran", "Bekukan spesifikasi, harga jam-kartu, durasi minimum, dan versi biaya.", "Pemasok"], ["Tahan jam-kartu", "Tahan saldo pembeli terlebih dahulu agar tidak terjadi overselling.", "Buku besar"], ["Kirim instans", "Buat kontainer terisolasi, masukkan kunci SSH sementara, dan konfirmasi akses.", "Host Agent"], ["Metering dan penyelesaian", "Tagih detik aktual, lepaskan sisa, lalu catat sewa dan komisi.", "Buku besar"], ["Cabut dan bersihkan", "Cabut kunci, hapus workspace, dan listing ulang setelah bukti lengkap.", "Host Agent"]], notice: ["Rilis awal: satu RTX 4090 / H100", "Selesaikan dulu satu mesin, satu penawaran, satu pesanan tiga menit, dan satu pembersihan menyeluruh. Top-up publik, buyback, dan konektor belum diterima tetap ditutup.", "Mulai listing", "Panduan Host Agent"] },
  ms: { metadata: ["Senaraikan pengkomputeran di Hosting", "Laluan bersatu untuk menyenarai, mengesah, menghantar dan menyelesaikan GPU peribadi, pelayan awan serta pusat data."], hero: ["KAI HOSTING · RANGKAIAN PENGKOMPUTERAN DISAHKAN", "Gunakan pengkomputeran terbiar dengan selamat.", "Put verified compute to work.", "Daripada satu GPU kepada pesanan sebenar: pengesahan, penyenaraian, penghantaran, pemeteran sesaat, penyelesaian jam-kad, pembersihan dan jualan semula."], section: ["MESIN KEADAAN KONTRAK", "Setiap peringkat disahkan oleh frontend dan backend", "Spesifikasi dan fi dibekukan semasa pembelian; penghantaran, pemeteran, penerimaan dan pembersihan dikawal backend."], process: [["Daftar sumber", "Hantar peranti, rangkaian, pemilikan dan masa tersedia.", "Pembekal"], ["Pengesahan platform", "Agent menandatangani bukti perkakasan dan menjalankan beban terkawal.", "Automatik + manual"], ["Terbitkan tawaran", "Bekukan spesifikasi, harga jam-kad, tempoh minimum dan versi fi.", "Pembekal"], ["Tahan jam-kad", "Tahan baki pembeli dahulu untuk mengelakkan jualan berlebihan.", "Lejar"], ["Hantar kejadian", "Cipta kontena terasing, suntik kunci SSH sementara dan sahkan akses.", "Host Agent"], ["Meter dan selesaikan", "Caj saat sebenar, lepaskan baki dan catat sewa serta komisen.", "Lejar"], ["Tarik balik dan bersihkan", "Tarik kunci, padam ruang kerja dan senarai semula selepas bukti lengkap.", "Host Agent"]], notice: ["Keluaran awal: satu RTX 4090 / H100", "Lengkapkan dahulu satu mesin, satu tawaran, satu pesanan tiga minit dan satu pembersihan penuh. Tambah nilai awam, beli balik dan penyambung belum diterima kekal ditutup.", "Mula senarai", "Panduan Host Agent"] },
};

export async function generateMetadata(): Promise<Metadata> {
  const copy = HOSTING_PAGE_COPY[await getRequestLocale()];
  return { title: copy.metadata[0], description: copy.metadata[1] };
}

export default async function HostingPage() {
  const copy = HOSTING_PAGE_COPY[await getRequestLocale()];
  return (
    <HostingPublicShell
      activePath="/hosting"
      eyebrow={copy.hero[0]}
      title={copy.hero[1]}
      titleEn={copy.hero[2]}
      summary={copy.hero[3]}
    >
      <HostingLegacyHashRedirect />
      <HostingLaunchpad />

      <section className={styles.section}>
        <SectionHeader
          index={copy.section[0]}
          title={copy.section[1]}
          lead={copy.section[2]}
        />
        <ol className={styles.process}>
          {copy.process.map(([title, description, owner], index) => (
            <li key={title}>
              <span className={styles.processNumber}>{String(index + 1).padStart(2, "0")}</span>
              <strong>{title}</strong>
              <p>{description}</p>
              <span className={styles.badge}>{owner}</span>
            </li>
          ))}
        </ol>
      </section>

      <aside className={styles.notice}>
        <div>
          <h2>{copy.notice[0]}</h2>
          <p>{copy.notice[1]}</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.actionPrimary} href="/login?returnTo=%2Fsupply%2Fonboarding">{copy.notice[2]}</Link>
          <Link className={styles.actionSecondary} href="/guides/host-agent">{copy.notice[3]}</Link>
        </div>
      </aside>
    </HostingPublicShell>
  );
}
