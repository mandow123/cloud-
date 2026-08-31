export const supportedLocales = [
  "zh-CN",
  "zh-TW",
  "en",
  "ja",
  "ko",
  "fr",
  "th",
  "vi",
  "id",
  "ms",
] as const;

export type Locale = (typeof supportedLocales)[number];

export const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALE_STORAGE_KEY = "kai-cloud-locale";
export const LOCALE_COOKIE_KEY = "kai_cloud_locale";

export const localeOptions: ReadonlyArray<{ value: Locale; label: string; shortLabel: string }> = [
  { value: "zh-CN", label: "简体中文", shortLabel: "简体" },
  { value: "zh-TW", label: "繁體中文", shortLabel: "繁體" },
  { value: "en", label: "English", shortLabel: "EN" },
  { value: "ja", label: "日本語", shortLabel: "日本語" },
  { value: "ko", label: "한국어", shortLabel: "한국어" },
  { value: "fr", label: "Français", shortLabel: "FR" },
  { value: "th", label: "ไทย", shortLabel: "ไทย" },
  { value: "vi", label: "Tiếng Việt", shortLabel: "VI" },
  { value: "id", label: "Bahasa Indonesia", shortLabel: "ID" },
  { value: "ms", label: "Bahasa Melayu", shortLabel: "MS" },
];

const messages = {
  "zh-CN": {
    language: "界面语言",
    languageLabel: "选择界面语言",
    languageScope: "业务名称和原始数据保持原文",
    skipToContent: "跳到主要内容",
    theme: "显示模式",
    system: "跟随系统",
    light: "浅色",
    dark: "深色",
    buy: "购买算力",
    request: "提交算力需求",
    compute: "算力云",
    hosting: "Hosting",
    guides: "教程",
    gpuRental: "GPU 租赁",
    gpuRentalDesc: "筛选、比较并启动 GPU 实例",
    allResources: "全部资源",
    allResourcesDesc: "浏览 GPU、模型与基础设施资源",
    market: "市场行情",
    marketDesc: "查看 KAI 标准卡时与市场快照",
    startHosting: "开始上架",
    startHostingDesc: "从资源登记到清理再售的完整路径",
    personalGpu: "个人 GPU",
    personalGpuDesc: "上架一张 RTX 4090 或 H100",
    cloudAccess: "云资源接入",
    cloudAccessDesc: "云主机、IDC 与集群连接器",
    earnings: "收益与结算",
    earningsDesc: "计量、租金、佣金与卡时账本",
    suppliers: "供应商合作",
    suppliersDesc: "企业协议、审核与接入进度",
    guideHome: "教程首页",
    guideHomeDesc: "从第一次租用到第一次上架",
    rentGpu: "租用 GPU",
    rentGpuDesc: "模板、筛选、租用与连接",
    listGpu: "上架 4090",
    listGpuDesc: "个人显卡完整上架步骤",
    delivery: "交付与验收",
    deliveryDesc: "连接检查、计量和验收",
    pricing: "计价方法",
    pricingDesc: "KAI 标准卡时与价格口径",
    globalNav: "全局导航",
    company: "Company",
    footerTagline: "中国 Token 学院算力市场",
    marketServices: "市场服务",
    marketCenter: "行情中心",
    resourceMarket: "资源市场",
    rentalSwap: "租赁与置换",
    platformInfo: "平台说明",
    methodology: "数据方法",
    memberWorkspace: "会员工作台",
    quoteNotice: "报价说明",
    disclaimer: "本站展示市场参考报价，具体价格、库存与交付条件以询价确认为准，不构成要约或投资、采购建议。",
    modelPublished: "模型目录价发布",
    infrastructureSample: "基础设施初始化样本截至",
    marketLanguage: "让异构算力拥有可比较的市场语言",
    pending: "待确认",
  },
  "zh-TW": {
    language: "介面語言", languageLabel: "選擇介面語言", languageScope: "業務名稱和原始資料保持原文", skipToContent: "跳到主要內容", theme: "顯示模式", system: "跟隨系統", light: "淺色", dark: "深色", buy: "購買算力", request: "提交算力需求",
    compute: "算力雲", hosting: "Hosting", guides: "教學", gpuRental: "GPU 租賃", gpuRentalDesc: "篩選、比較並啟動 GPU 實例", allResources: "全部資源", allResourcesDesc: "瀏覽 GPU、模型與基礎設施資源", market: "市場行情", marketDesc: "查看 KAI 標準卡時與市場快照",
    startHosting: "開始上架", startHostingDesc: "從資源登記到清理再售的完整路徑", personalGpu: "個人 GPU", personalGpuDesc: "上架一張 RTX 4090 或 H100", cloudAccess: "雲資源接入", cloudAccessDesc: "雲主機、IDC 與叢集連接器", earnings: "收益與結算", earningsDesc: "計量、租金、佣金與卡時帳本", suppliers: "供應商合作", suppliersDesc: "企業協議、審核與接入進度",
    guideHome: "教學首頁", guideHomeDesc: "從第一次租用到第一次上架", rentGpu: "租用 GPU", rentGpuDesc: "範本、篩選、租用與連接", listGpu: "上架 4090", listGpuDesc: "個人顯卡完整上架步驟", delivery: "交付與驗收", deliveryDesc: "連接檢查、計量和驗收", pricing: "計價方法", pricingDesc: "KAI 標準卡時與價格口徑",
    globalNav: "全域導覽", company: "Company", footerTagline: "中國 Token 學院算力市場", marketServices: "市場服務", marketCenter: "行情中心", resourceMarket: "資源市場", rentalSwap: "租賃與置換", platformInfo: "平台說明", methodology: "資料方法", memberWorkspace: "會員工作台", quoteNotice: "報價說明", disclaimer: "本站展示市場參考報價，具體價格、庫存與交付條件以詢價確認為準，不構成要約或投資、採購建議。", modelPublished: "模型目錄價發布", infrastructureSample: "基礎設施初始化樣本截至", marketLanguage: "讓異構算力擁有可比較的市場語言", pending: "待確認",
  },
  en: {
    language: "Language", languageLabel: "Select interface language", languageScope: "Business names and source data remain unchanged", skipToContent: "Skip to main content", theme: "Appearance", system: "System", light: "Light", dark: "Dark", buy: "Buy compute", request: "Submit demand",
    compute: "Compute Cloud", hosting: "Hosting", guides: "Guides", gpuRental: "GPU rental", gpuRentalDesc: "Filter, compare and launch GPU instances", allResources: "All resources", allResourcesDesc: "Browse GPU, model and infrastructure resources", market: "Market", marketDesc: "View KAI card-hour benchmarks and market snapshots",
    startHosting: "List resources", startHostingDesc: "The complete path from registration to resale", personalGpu: "Personal GPU", personalGpuDesc: "List an RTX 4090 or H100", cloudAccess: "Cloud integration", cloudAccessDesc: "Cloud, IDC and cluster connectors", earnings: "Earnings & settlement", earningsDesc: "Metering, fees, commission and card-hour ledger", suppliers: "Supplier partners", suppliersDesc: "Business agreements, review and onboarding",
    guideHome: "Guide home", guideHomeDesc: "From your first rental to first listing", rentGpu: "Rent a GPU", rentGpuDesc: "Templates, filters, rental and connection", listGpu: "List a 4090", listGpuDesc: "Complete personal GPU listing guide", delivery: "Delivery & acceptance", deliveryDesc: "Connection checks, metering and acceptance", pricing: "Pricing method", pricingDesc: "KAI standard card-hour pricing",
    globalNav: "Global navigation", company: "Company", footerTagline: "China Token Institute Compute Marketplace", marketServices: "Market services", marketCenter: "Market center", resourceMarket: "Resource market", rentalSwap: "Rental & exchange", platformInfo: "Platform", methodology: "Methodology", memberWorkspace: "Member workspace", quoteNotice: "Quote notice", disclaimer: "Prices shown are market references. Final price, inventory and delivery terms are subject to inquiry and do not constitute an offer or investment or purchasing advice.", modelPublished: "Model catalog published", infrastructureSample: "Infrastructure sample as of", marketLanguage: "A comparable market language for heterogeneous compute", pending: "Pending",
  },
  ja: {
    language: "表示言語", languageLabel: "表示言語を選択", languageScope: "事業名と元データは原文のまま表示されます", skipToContent: "メインコンテンツへ移動", theme: "表示", system: "システム", light: "ライト", dark: "ダーク", buy: "計算資源を購入", request: "需要を提出",
    compute: "コンピュート", hosting: "ホスティング", guides: "ガイド", gpuRental: "GPU レンタル", gpuRentalDesc: "GPU インスタンスを比較して起動", allResources: "全リソース", allResourcesDesc: "GPU・モデル・インフラを閲覧", market: "市場情報", marketDesc: "KAI カード時と市場スナップショットを確認",
    startHosting: "掲載を開始", startHostingDesc: "登録から再販までの完全な流れ", personalGpu: "個人 GPU", personalGpuDesc: "RTX 4090 または H100 を掲載", cloudAccess: "クラウド接続", cloudAccessDesc: "クラウド・IDC・クラスター接続", earnings: "収益と決済", earningsDesc: "計測・料金・手数料・カード時台帳", suppliers: "サプライヤー提携", suppliersDesc: "企業契約・審査・接続状況",
    guideHome: "ガイド一覧", guideHomeDesc: "初回レンタルから初回掲載まで", rentGpu: "GPU を借りる", rentGpuDesc: "テンプレート・絞り込み・接続", listGpu: "4090 を掲載", listGpuDesc: "個人 GPU 掲載の全手順", delivery: "納品と検収", deliveryDesc: "接続確認・計測・検収", pricing: "価格算定", pricingDesc: "KAI 標準カード時の価格基準",
    globalNav: "グローバルナビゲーション", company: "Company", footerTagline: "中国 Token 学院コンピュート市場", marketServices: "市場サービス", marketCenter: "市場センター", resourceMarket: "リソース市場", rentalSwap: "レンタルと交換", platformInfo: "プラットフォーム", methodology: "データ算定方法", memberWorkspace: "会員ワークスペース", quoteNotice: "価格について", disclaimer: "表示価格は市場参考値です。価格・在庫・納品条件は問い合わせ確認を優先し、投資・購入の勧誘ではありません。", modelPublished: "モデル価格公開日", infrastructureSample: "インフラ標本基準日", marketLanguage: "異種計算資源に比較可能な市場言語を", pending: "確認待ち",
  },
  ko: {
    language: "화면 언어", languageLabel: "화면 언어 선택", languageScope: "사업명과 원본 데이터는 원문으로 유지됩니다", skipToContent: "주요 콘텐츠로 이동", theme: "화면 모드", system: "시스템", light: "라이트", dark: "다크", buy: "컴퓨팅 구매", request: "수요 제출",
    compute: "컴퓨팅 클라우드", hosting: "호스팅", guides: "가이드", gpuRental: "GPU 대여", gpuRentalDesc: "GPU 인스턴스를 비교하고 실행", allResources: "전체 리소스", allResourcesDesc: "GPU, 모델 및 인프라 탐색", market: "시장 시세", marketDesc: "KAI 카드시간 기준과 시장 스냅샷 확인",
    startHosting: "등록 시작", startHostingDesc: "리소스 등록부터 재판매까지", personalGpu: "개인 GPU", personalGpuDesc: "RTX 4090 또는 H100 등록", cloudAccess: "클라우드 연동", cloudAccessDesc: "클라우드, IDC 및 클러스터 연결", earnings: "수익 및 정산", earningsDesc: "계량, 임대료, 수수료 및 카드시간 원장", suppliers: "공급업체 협력", suppliersDesc: "기업 계약, 심사 및 온보딩",
    guideHome: "가이드 홈", guideHomeDesc: "첫 대여부터 첫 등록까지", rentGpu: "GPU 대여", rentGpuDesc: "템플릿, 필터, 대여 및 연결", listGpu: "4090 등록", listGpuDesc: "개인 GPU 전체 등록 절차", delivery: "인도 및 검수", deliveryDesc: "연결 확인, 계량 및 검수", pricing: "가격 산정", pricingDesc: "KAI 표준 카드시간 가격 기준",
    globalNav: "전역 탐색", company: "Company", footerTagline: "중국 Token 학원 컴퓨팅 시장", marketServices: "시장 서비스", marketCenter: "시장 센터", resourceMarket: "리소스 시장", rentalSwap: "대여 및 교환", platformInfo: "플랫폼 안내", methodology: "데이터 방법론", memberWorkspace: "회원 작업공간", quoteNotice: "가격 안내", disclaimer: "표시 가격은 시장 참고 가격입니다. 최종 가격, 재고 및 인도 조건은 문의 확인을 기준으로 하며 투자 또는 구매 권유가 아닙니다.", modelPublished: "모델 카탈로그 공개", infrastructureSample: "인프라 표본 기준일", marketLanguage: "이기종 컴퓨팅을 위한 비교 가능한 시장 언어", pending: "확인 대기",
  },
  fr: {
    language: "Langue", languageLabel: "Choisir la langue de l’interface", languageScope: "Les noms métier et les données source restent inchangés", skipToContent: "Aller au contenu principal", theme: "Affichage", system: "Système", light: "Clair", dark: "Sombre", buy: "Acheter du calcul", request: "Soumettre un besoin",
    compute: "Cloud de calcul", hosting: "Hébergement", guides: "Guides", gpuRental: "Location de GPU", gpuRentalDesc: "Filtrer, comparer et lancer des GPU", allResources: "Toutes les ressources", allResourcesDesc: "Parcourir GPU, modèles et infrastructure", market: "Marché", marketDesc: "Consulter les heures-carte KAI et le marché",
    startHosting: "Publier une ressource", startHostingDesc: "Du référencement à la remise en vente", personalGpu: "GPU personnel", personalGpuDesc: "Publier une RTX 4090 ou H100", cloudAccess: "Connexion cloud", cloudAccessDesc: "Connecteurs cloud, IDC et clusters", earnings: "Revenus et règlement", earningsDesc: "Mesure, frais, commission et registre", suppliers: "Partenaires fournisseurs", suppliersDesc: "Accords, vérification et intégration",
    guideHome: "Accueil des guides", guideHomeDesc: "De la première location à la première offre", rentGpu: "Louer un GPU", rentGpuDesc: "Modèles, filtres, location et connexion", listGpu: "Publier une 4090", listGpuDesc: "Guide complet pour un GPU personnel", delivery: "Livraison et réception", deliveryDesc: "Connexion, mesure et réception", pricing: "Méthode de prix", pricingDesc: "Tarification standard des heures-carte KAI",
    globalNav: "Navigation principale", company: "Entreprise", footerTagline: "Marché de calcul du China Token Institute", marketServices: "Services du marché", marketCenter: "Centre du marché", resourceMarket: "Marché des ressources", rentalSwap: "Location et échange", platformInfo: "Plateforme", methodology: "Méthodologie", memberWorkspace: "Espace membre", quoteNotice: "Avis de prix", disclaimer: "Les prix affichés sont indicatifs. Le prix final, le stock et la livraison sont confirmés sur demande et ne constituent ni une offre ni un conseil d’investissement ou d’achat.", modelPublished: "Catalogue publié", infrastructureSample: "Échantillon d’infrastructure au", marketLanguage: "Un langage de marché comparable pour le calcul hétérogène", pending: "À confirmer",
  },
  th: {
    language: "ภาษา", languageLabel: "เลือกภาษาของหน้าจอ", languageScope: "ชื่อธุรกิจและข้อมูลต้นฉบับจะคงเดิม", skipToContent: "ข้ามไปยังเนื้อหาหลัก", theme: "รูปแบบหน้าจอ", system: "ตามระบบ", light: "สว่าง", dark: "มืด", buy: "ซื้อพลังประมวลผล", request: "ส่งความต้องการ",
    compute: "คลาวด์ประมวลผล", hosting: "โฮสติ้ง", guides: "คู่มือ", gpuRental: "เช่า GPU", gpuRentalDesc: "กรอง เปรียบเทียบ และเปิดใช้งาน GPU", allResources: "ทรัพยากรทั้งหมด", allResourcesDesc: "ดู GPU โมเดล และโครงสร้างพื้นฐาน", market: "ตลาด", marketDesc: "ดูชั่วโมงการ์ด KAI และภาพรวมตลาด",
    startHosting: "เริ่มลงรายการ", startHostingDesc: "ตั้งแต่ลงทะเบียนจนถึงขายต่อ", personalGpu: "GPU ส่วนบุคคล", personalGpuDesc: "ลงรายการ RTX 4090 หรือ H100", cloudAccess: "เชื่อมต่อคลาวด์", cloudAccessDesc: "คลาวด์ IDC และคลัสเตอร์", earnings: "รายได้และการชำระ", earningsDesc: "การวัด ค่าเช่า ค่าธรรมเนียม และบัญชี", suppliers: "พันธมิตรผู้ให้บริการ", suppliersDesc: "ข้อตกลง การตรวจสอบ และการเชื่อมต่อ",
    guideHome: "หน้าคู่มือ", guideHomeDesc: "จากการเช่าครั้งแรกถึงการลงรายการ", rentGpu: "เช่า GPU", rentGpuDesc: "แม่แบบ ตัวกรอง การเช่า และการเชื่อมต่อ", listGpu: "ลงรายการ 4090", listGpuDesc: "ขั้นตอนลงรายการ GPU ส่วนบุคคล", delivery: "ส่งมอบและตรวจรับ", deliveryDesc: "ตรวจการเชื่อมต่อ วัดผล และตรวจรับ", pricing: "วิธีกำหนดราคา", pricingDesc: "มาตรฐานราคาชั่วโมงการ์ด KAI",
    globalNav: "เมนูหลัก", company: "บริษัท", footerTagline: "ตลาดพลังประมวลผล China Token Institute", marketServices: "บริการตลาด", marketCenter: "ศูนย์ตลาด", resourceMarket: "ตลาดทรัพยากร", rentalSwap: "เช่าและแลกเปลี่ยน", platformInfo: "ข้อมูลแพลตฟอร์ม", methodology: "วิธีการข้อมูล", memberWorkspace: "พื้นที่สมาชิก", quoteNotice: "หมายเหตุราคา", disclaimer: "ราคาที่แสดงเป็นราคาอ้างอิง ราคาจริง สต็อก และเงื่อนไขส่งมอบต้องยืนยันผ่านการสอบถาม และไม่ใช่ข้อเสนอหรือคำแนะนำการลงทุนหรือจัดซื้อ", modelPublished: "เผยแพร่ราคาโมเดล", infrastructureSample: "ข้อมูลโครงสร้างพื้นฐาน ณ", marketLanguage: "ภาษาตลาดที่เปรียบเทียบได้สำหรับการประมวลผลต่างชนิด", pending: "รอยืนยัน",
  },
  vi: {
    language: "Ngôn ngữ", languageLabel: "Chọn ngôn ngữ giao diện", languageScope: "Tên nghiệp vụ và dữ liệu gốc được giữ nguyên", skipToContent: "Chuyển đến nội dung chính", theme: "Giao diện", system: "Theo hệ thống", light: "Sáng", dark: "Tối", buy: "Mua năng lực tính toán", request: "Gửi nhu cầu",
    compute: "Đám mây tính toán", hosting: "Hosting", guides: "Hướng dẫn", gpuRental: "Thuê GPU", gpuRentalDesc: "Lọc, so sánh và khởi chạy GPU", allResources: "Tất cả tài nguyên", allResourcesDesc: "Duyệt GPU, mô hình và hạ tầng", market: "Thị trường", marketDesc: "Xem giờ-thẻ KAI và tổng quan thị trường",
    startHosting: "Bắt đầu đăng bán", startHostingDesc: "Từ đăng ký đến bán lại tài nguyên", personalGpu: "GPU cá nhân", personalGpuDesc: "Đăng RTX 4090 hoặc H100", cloudAccess: "Kết nối đám mây", cloudAccessDesc: "Kết nối cloud, IDC và cụm", earnings: "Doanh thu và quyết toán", earningsDesc: "Đo lường, phí thuê, hoa hồng và sổ cái", suppliers: "Đối tác cung cấp", suppliersDesc: "Hợp đồng, xét duyệt và tích hợp",
    guideHome: "Trang hướng dẫn", guideHomeDesc: "Từ lần thuê đầu đến lần đăng đầu", rentGpu: "Thuê GPU", rentGpuDesc: "Mẫu, bộ lọc, thuê và kết nối", listGpu: "Đăng 4090", listGpuDesc: "Quy trình đăng GPU cá nhân", delivery: "Bàn giao và nghiệm thu", deliveryDesc: "Kiểm tra kết nối, đo lường và nghiệm thu", pricing: "Phương pháp định giá", pricingDesc: "Chuẩn giá giờ-thẻ KAI",
    globalNav: "Điều hướng chính", company: "Công ty", footerTagline: "Thị trường tính toán China Token Institute", marketServices: "Dịch vụ thị trường", marketCenter: "Trung tâm thị trường", resourceMarket: "Chợ tài nguyên", rentalSwap: "Thuê và hoán đổi", platformInfo: "Thông tin nền tảng", methodology: "Phương pháp dữ liệu", memberWorkspace: "Không gian thành viên", quoteNotice: "Lưu ý báo giá", disclaimer: "Giá hiển thị chỉ để tham khảo. Giá, tồn kho và điều kiện giao hàng cuối cùng được xác nhận khi hỏi giá và không phải là chào hàng hay tư vấn đầu tư hoặc mua sắm.", modelPublished: "Công bố giá mô hình", infrastructureSample: "Mẫu hạ tầng đến", marketLanguage: "Ngôn ngữ thị trường có thể so sánh cho tài nguyên tính toán dị thể", pending: "Chờ xác nhận",
  },
  id: {
    language: "Bahasa", languageLabel: "Pilih bahasa antarmuka", languageScope: "Nama bisnis dan data sumber tetap dalam bentuk asli", skipToContent: "Lewati ke konten utama", theme: "Tampilan", system: "Sistem", light: "Terang", dark: "Gelap", buy: "Beli komputasi", request: "Ajukan kebutuhan",
    compute: "Cloud Komputasi", hosting: "Hosting", guides: "Panduan", gpuRental: "Sewa GPU", gpuRentalDesc: "Filter, bandingkan, dan jalankan GPU", allResources: "Semua sumber daya", allResourcesDesc: "Jelajahi GPU, model, dan infrastruktur", market: "Pasar", marketDesc: "Lihat jam-kartu KAI dan ringkasan pasar",
    startHosting: "Mulai listing", startHostingDesc: "Dari pendaftaran hingga penjualan ulang", personalGpu: "GPU pribadi", personalGpuDesc: "Listing RTX 4090 atau H100", cloudAccess: "Integrasi cloud", cloudAccessDesc: "Konektor cloud, IDC, dan klaster", earnings: "Pendapatan & penyelesaian", earningsDesc: "Metering, biaya, komisi, dan buku besar", suppliers: "Mitra pemasok", suppliersDesc: "Perjanjian, verifikasi, dan onboarding",
    guideHome: "Beranda panduan", guideHomeDesc: "Dari sewa pertama hingga listing pertama", rentGpu: "Sewa GPU", rentGpuDesc: "Templat, filter, sewa, dan koneksi", listGpu: "Listing 4090", listGpuDesc: "Panduan lengkap GPU pribadi", delivery: "Pengiriman & penerimaan", deliveryDesc: "Pemeriksaan koneksi, metering, dan penerimaan", pricing: "Metode harga", pricingDesc: "Standar harga jam-kartu KAI",
    globalNav: "Navigasi utama", company: "Perusahaan", footerTagline: "Pasar Komputasi China Token Institute", marketServices: "Layanan pasar", marketCenter: "Pusat pasar", resourceMarket: "Pasar sumber daya", rentalSwap: "Sewa & tukar", platformInfo: "Platform", methodology: "Metodologi", memberWorkspace: "Ruang anggota", quoteNotice: "Catatan harga", disclaimer: "Harga yang ditampilkan adalah referensi pasar. Harga akhir, stok, dan pengiriman dikonfirmasi melalui permintaan dan bukan merupakan penawaran atau saran investasi maupun pembelian.", modelPublished: "Katalog model diterbitkan", infrastructureSample: "Sampel infrastruktur per", marketLanguage: "Bahasa pasar yang dapat dibandingkan untuk komputasi heterogen", pending: "Menunggu konfirmasi",
  },
  ms: {
    language: "Bahasa", languageLabel: "Pilih bahasa antara muka", languageScope: "Nama perniagaan dan data sumber kekal dalam bentuk asal", skipToContent: "Langkau ke kandungan utama", theme: "Paparan", system: "Ikut sistem", light: "Cerah", dark: "Gelap", buy: "Beli pengkomputeran", request: "Hantar keperluan",
    compute: "Awan Pengkomputeran", hosting: "Pengehosan", guides: "Panduan", gpuRental: "Sewa GPU", gpuRentalDesc: "Tapis, banding dan lancarkan GPU", allResources: "Semua sumber", allResourcesDesc: "Lihat GPU, model dan infrastruktur", market: "Pasaran", marketDesc: "Lihat jam-kad KAI dan ringkasan pasaran",
    startHosting: "Mula senarai", startHostingDesc: "Daripada pendaftaran hingga jualan semula", personalGpu: "GPU peribadi", personalGpuDesc: "Senaraikan RTX 4090 atau H100", cloudAccess: "Sambungan awan", cloudAccessDesc: "Penyambung awan, IDC dan kluster", earnings: "Pendapatan & penyelesaian", earningsDesc: "Pemeteran, sewa, komisen dan lejar", suppliers: "Rakan pembekal", suppliersDesc: "Perjanjian, semakan dan penyambungan",
    guideHome: "Laman panduan", guideHomeDesc: "Daripada sewaan pertama hingga senarai pertama", rentGpu: "Sewa GPU", rentGpuDesc: "Templat, tapisan, sewa dan sambungan", listGpu: "Senarai 4090", listGpuDesc: "Panduan lengkap GPU peribadi", delivery: "Penyerahan & penerimaan", deliveryDesc: "Semakan sambungan, pemeteran dan penerimaan", pricing: "Kaedah harga", pricingDesc: "Standard harga jam-kad KAI",
    globalNav: "Navigasi utama", company: "Syarikat", footerTagline: "Pasaran Pengkomputeran China Token Institute", marketServices: "Perkhidmatan pasaran", marketCenter: "Pusat pasaran", resourceMarket: "Pasaran sumber", rentalSwap: "Sewa & tukar", platformInfo: "Platform", methodology: "Metodologi", memberWorkspace: "Ruang ahli", quoteNotice: "Nota harga", disclaimer: "Harga yang dipaparkan ialah rujukan pasaran. Harga akhir, stok dan penghantaran disahkan melalui pertanyaan dan bukan tawaran atau nasihat pelaburan atau pembelian.", modelPublished: "Katalog model diterbitkan", infrastructureSample: "Sampel infrastruktur pada", marketLanguage: "Bahasa pasaran yang setara untuk pengkomputeran heterogen", pending: "Menunggu pengesahan",
  },
} as const;

export type MessageKey = keyof (typeof messages)[typeof DEFAULT_LOCALE];

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && supportedLocales.includes(value as Locale);
}

export function normalizeLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE;
  if (isSupportedLocale(value)) return value;
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk") || normalized.startsWith("zh-hant")) return "zh-TW";
  if (normalized.startsWith("zh")) return "zh-CN";
  const direct = supportedLocales.find((locale) => normalized === locale.toLowerCase() || normalized.startsWith(`${locale.toLowerCase()}-`));
  return direct ?? DEFAULT_LOCALE;
}

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key] ?? messages[DEFAULT_LOCALE][key];
}
