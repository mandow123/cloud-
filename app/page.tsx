import type { Metadata } from "next";
import Link from "next/link";
import { LiveHomeMarketHero } from "@/components/live-home-market-hero";
import { resourceListings, serviceAliases } from "@/lib/data";
import type { Locale } from "@/lib/i18n";
import { formatPrice } from "@/lib/market";
import { marketIndexChange, readMarketSnapshot } from "@/lib/server/market-snapshot";
import { getRequestLocale } from "@/lib/server/request-locale";
import type { ResourceCategory, ResourceListing } from "@/lib/types";

type QuickActionCopy = { title: string; copy: string };

type HomeCopy = {
  metadataTitle: string;
  metadataDescription: string;
  pricing: {
    taxIncluded: string;
    taxExcluded: string;
    energyIncluded: string;
    energyExcluded: string;
    networkIncluded: string;
    networkExcluded: string;
  };
  quickActions: readonly [QuickActionCopy, QuickActionCopy, QuickActionCopy, QuickActionCopy];
  marketKicker: string;
  marketTitle: string;
  marketLead: string;
  allMarkets: string;
  resourceAndId: string;
  region: string;
  referenceQuote: string;
  quoteScope: string;
  sampleAndValidity: string;
  operation: string;
  samplePrefix: string;
  sampleSuffix: string;
  updated: string;
  validUntil: string;
  submitFromQuote: string;
  marketFootnote: string;
  workloadKicker: string;
  workloadTitle: string;
  workloadLead: string;
  enter: string;
  servicesKicker: string;
  servicesTitle: string;
  servicesLead: string;
  serviceLabels: Readonly<Record<string, string>>;
  actionKicker: string;
  actionTitle: string;
  actionLead: string;
  submitDemand: string;
  openMemberWorkspace: string;
};

const HOME_COPY: Record<Locale, HomeCopy> = {
  "zh-CN": {
    metadataTitle: "让算力，抵达每一个需要它的时刻",
    metadataDescription: "连接可信算力供给与真实需求，以 KAI 卡时统一购买 GPU、模型、Token、云主机与企业容量。",
    pricing: { taxIncluded: "含税", taxExcluded: "未含税", energyIncluded: "含电费", energyExcluded: "未含电费", networkIncluded: "含网络", networkExcluded: "未含网络" },
    quickActions: [
      { title: "租 GPU", copy: "H20、A800 等卡时与服务器时" },
      { title: "买 Token", copy: "逐模型比较输入、缓存与输出价" },
      { title: "找机柜", copy: "整机柜、功率与预留容量" },
      { title: "做置换", copy: "我可提供 / 我需要双边撮合" },
    ],
    marketKicker: "市场快照", marketTitle: "今日关键报价", marketLead: "四类资源均直接引用统一目录，价格、口径和时效可追溯到具体资源。", allMarkets: "全部行情",
    resourceAndId: "资源 / 编号", region: "地区", referenceQuote: "市场参考报价", quoteScope: "税费 / 电费 / 网络", sampleAndValidity: "样本 / 时效", operation: "操作",
    samplePrefix: "样本", sampleSuffix: "条", updated: "更新", validUntil: "有效至", submitFromQuote: "按此提交需求", marketFootnote: "市场参考报价 · 具体以询价确认为准 · 每日北京时间 06:00 更新 · 平台初始化样本，供应商接入后核验更新",
    workloadKicker: "从任务开始", workloadTitle: "从你的任务开始", workloadLead: "先看可交易资源，再按任务筛选；价格、交付和卡时结算使用同一份订单快照。", enter: "进入",
    servicesKicker: "十个业务入口", servicesTitle: "十个业务叫法，统一进入一个市场", servicesLead: "熟悉的名称保留为快捷入口，底层统一映射到资源类型、交易方式与计价单位。",
    serviceLabels: { "compute-swap": "算力置换", "compute-rental": "算力租赁", "gpu-swap": "GPU 置换", "gpu-rental": "GPU 租赁", "token-hour-service": "Token 小时服务", "model-hour-service": "模型小时服务", "model-capacity-hour-service": "模型容量小时服务", "compute-capacity-hour-service": "算力容量小时服务", "compute-capacity-rental": "算力容量租赁", "compute-capacity-swap": "算力容量置换" },
    actionKicker: "从价格到行动", actionTitle: "看到合适价格，就把需求交给同一套后端。", actionLead: "提交后获得服务端需求编号；供应方报价会回流到需求方工作台。", submitDemand: "提交算力需求", openMemberWorkspace: "打开会员工作台",
  },
  "zh-TW": {
    metadataTitle: "讓算力，抵達每一個需要它的時刻",
    metadataDescription: "連接可信算力供給與真實需求，以 KAI 卡時統一購買 GPU、模型、Token、雲主機與企業容量。",
    pricing: { taxIncluded: "含稅", taxExcluded: "未含稅", energyIncluded: "含電費", energyExcluded: "未含電費", networkIncluded: "含網路", networkExcluded: "未含網路" },
    quickActions: [
      { title: "租 GPU", copy: "H20、A800 等卡時與伺服器時" },
      { title: "買 Token", copy: "逐模型比較輸入、快取與輸出價格" },
      { title: "找機櫃", copy: "整機櫃、功率與預留容量" },
      { title: "做置換", copy: "我可提供 / 我需要雙邊撮合" },
    ],
    marketKicker: "市場快照", marketTitle: "今日關鍵報價", marketLead: "四類資源均直接引用統一目錄，價格、口徑和時效可追溯到具體資源。", allMarkets: "全部行情",
    resourceAndId: "資源 / 編號", region: "地區", referenceQuote: "市場參考報價", quoteScope: "稅費 / 電費 / 網路", sampleAndValidity: "樣本 / 時效", operation: "操作",
    samplePrefix: "樣本", sampleSuffix: "筆", updated: "更新", validUntil: "有效至", submitFromQuote: "依此提交需求", marketFootnote: "市場參考報價 · 具體以詢價確認為準 · 每日北京時間 06:00 更新 · 平台初始化樣本，供應商接入後核驗更新",
    workloadKicker: "從任務開始", workloadTitle: "從你的任務開始", workloadLead: "先看可交易資源，再按任務篩選；價格、交付和卡時結算使用同一份訂單快照。", enter: "進入",
    servicesKicker: "十個業務入口", servicesTitle: "十個業務叫法，統一進入一個市場", servicesLead: "熟悉的名稱保留為快捷入口，底層統一映射到資源類型、交易方式與計價單位。",
    serviceLabels: { "compute-swap": "算力置換", "compute-rental": "算力租賃", "gpu-swap": "GPU 置換", "gpu-rental": "GPU 租賃", "token-hour-service": "Token 小時服務", "model-hour-service": "模型小時服務", "model-capacity-hour-service": "模型容量小時服務", "compute-capacity-hour-service": "算力容量小時服務", "compute-capacity-rental": "算力容量租賃", "compute-capacity-swap": "算力容量置換" },
    actionKicker: "從價格到行動", actionTitle: "看到合適價格，就把需求交給同一套後端。", actionLead: "提交後取得服務端需求編號；供應方報價會回流到需求方工作台。", submitDemand: "提交算力需求", openMemberWorkspace: "開啟會員工作台",
  },
  en: {
    metadataTitle: "Compute, ready for every moment that matters",
    metadataDescription: "Connect verified compute supply with real demand and use KAI card-hours to purchase GPU, model, token, cloud, and enterprise capacity.",
    pricing: { taxIncluded: "Tax included", taxExcluded: "Tax excluded", energyIncluded: "Energy included", energyExcluded: "Energy excluded", networkIncluded: "Network included", networkExcluded: "Network excluded" },
    quickActions: [
      { title: "Rent GPUs", copy: "H20, A800 and other card-hour or server-hour offers" },
      { title: "Buy tokens", copy: "Compare input, cache, and output prices by model" },
      { title: "Find racks", copy: "Full racks, power, and reserved capacity" },
      { title: "Swap capacity", copy: "Match what I offer with what I need" },
    ],
    marketKicker: "Market snapshot", marketTitle: "Today's key quotes", marketLead: "All four resource classes use the unified catalog, so price, scope, and validity remain traceable to each resource.", allMarkets: "View all markets",
    resourceAndId: "Resource / ID", region: "Region", referenceQuote: "Market reference quote", quoteScope: "Tax / energy / network", sampleAndValidity: "Samples / validity", operation: "Action",
    samplePrefix: "Sample", sampleSuffix: "records", updated: "Updated", validUntil: "Valid until", submitFromQuote: "Submit from this quote", marketFootnote: "Market reference quotes · Final terms are subject to inquiry · Updated daily at 06:00 Beijing time · Initial platform samples are verified after supplier onboarding",
    workloadKicker: "Start from the workload", workloadTitle: "Start with your workload", workloadLead: "Review tradable resources first, then filter by workload. Pricing, delivery, and card-hour settlement share the same order snapshot.", enter: "Open",
    servicesKicker: "Ten business entries", servicesTitle: "Ten familiar terms, one unified market", servicesLead: "Familiar names remain as shortcuts while the platform maps them to resource type, transaction mode, and pricing unit.",
    serviceLabels: { "compute-swap": "Compute swap", "compute-rental": "Compute rental", "gpu-swap": "GPU swap", "gpu-rental": "GPU rental", "token-hour-service": "Token-hour service", "model-hour-service": "Model-hour service", "model-capacity-hour-service": "Model capacity-hour service", "compute-capacity-hour-service": "Compute capacity-hour service", "compute-capacity-rental": "Compute capacity rental", "compute-capacity-swap": "Compute capacity swap" },
    actionKicker: "From price to action", actionTitle: "Found the right price? Send the demand through the same backend.", actionLead: "Submission creates a server-side demand ID, and supplier quotes return to the buyer workspace.", submitDemand: "Submit compute demand", openMemberWorkspace: "Open member workspace",
  },
  ja: {
    metadataTitle: "必要な瞬間へ、計算資源を届ける",
    metadataDescription: "信頼できる計算資源と実需を結び、KAI カード時で GPU、モデル、Token、クラウド、企業向け容量を購入できます。",
    pricing: { taxIncluded: "税込", taxExcluded: "税別", energyIncluded: "電気料金込み", energyExcluded: "電気料金別", networkIncluded: "ネットワーク込み", networkExcluded: "ネットワーク別" },
    quickActions: [
      { title: "GPU を借りる", copy: "H20、A800 などをカード時・サーバー時で利用" },
      { title: "Token を購入", copy: "モデル別に入力・キャッシュ・出力価格を比較" },
      { title: "ラックを探す", copy: "フルラック、電力、予約容量" },
      { title: "容量を交換", copy: "提供できる資源と必要な資源をマッチング" },
    ],
    marketKicker: "市場スナップショット", marketTitle: "本日の主要価格", marketLead: "4 種類の資源は統一カタログを参照し、価格・条件・有効期間を個別資源まで追跡できます。", allMarkets: "すべての相場",
    resourceAndId: "資源 / ID", region: "地域", referenceQuote: "市場参考価格", quoteScope: "税 / 電気 / ネットワーク", sampleAndValidity: "サンプル / 有効期間", operation: "操作",
    samplePrefix: "サンプル", sampleSuffix: "件", updated: "更新", validUntil: "有効期限", submitFromQuote: "この価格で需要を提出", marketFootnote: "市場参考価格 · 最終条件は問い合わせ確認を優先 · 北京時間 06:00 に毎日更新 · 初期サンプルは供給者接続後に検証更新",
    workloadKicker: "ワークロードから開始", workloadTitle: "タスクから始める", workloadLead: "取引可能な資源を確認してからタスクで絞り込みます。価格、納品、カード時決済は同じ注文スナップショットを使用します。", enter: "開く",
    servicesKicker: "10 の業務入口", servicesTitle: "10 の呼び方を 1 つの市場へ", servicesLead: "なじみのある名称はショートカットとして残し、資源種別・取引方式・価格単位へ統一して対応付けます。",
    serviceLabels: { "compute-swap": "計算資源の交換", "compute-rental": "計算資源レンタル", "gpu-swap": "GPU 交換", "gpu-rental": "GPU レンタル", "token-hour-service": "Token 時間サービス", "model-hour-service": "モデル時間サービス", "model-capacity-hour-service": "モデル容量時間サービス", "compute-capacity-hour-service": "計算容量時間サービス", "compute-capacity-rental": "計算容量レンタル", "compute-capacity-swap": "計算容量交換" },
    actionKicker: "価格から行動へ", actionTitle: "適正な価格を見つけたら、同じバックエンドへ需要を送信。", actionLead: "提出後にサーバー側の需要 ID が発行され、供給者の価格は購入者ワークスペースに戻ります。", submitDemand: "計算需要を提出", openMemberWorkspace: "会員ワークスペースを開く",
  },
  ko: {
    metadataTitle: "필요한 순간마다 컴퓨팅을 연결합니다",
    metadataDescription: "검증된 컴퓨팅 공급과 실제 수요를 연결하고 KAI 카드시간으로 GPU, 모델, Token, 클라우드 및 기업 용량을 구매합니다.",
    pricing: { taxIncluded: "세금 포함", taxExcluded: "세금 별도", energyIncluded: "전력비 포함", energyExcluded: "전력비 별도", networkIncluded: "네트워크 포함", networkExcluded: "네트워크 별도" },
    quickActions: [
      { title: "GPU 대여", copy: "H20, A800 등을 카드시간 또는 서버시간으로 이용" },
      { title: "Token 구매", copy: "모델별 입력·캐시·출력 가격 비교" },
      { title: "랙 찾기", copy: "전체 랙, 전력 및 예약 용량" },
      { title: "용량 교환", copy: "제공 가능한 자원과 필요한 자원 매칭" },
    ],
    marketKicker: "시장 스냅샷", marketTitle: "오늘의 주요 견적", marketLead: "네 가지 자원 유형이 통합 카탈로그를 사용하므로 가격, 범위, 유효 기간을 개별 자원까지 추적할 수 있습니다.", allMarkets: "전체 시세",
    resourceAndId: "자원 / ID", region: "지역", referenceQuote: "시장 참고 견적", quoteScope: "세금 / 전력 / 네트워크", sampleAndValidity: "표본 / 유효 기간", operation: "작업",
    samplePrefix: "표본", sampleSuffix: "건", updated: "업데이트", validUntil: "유효 기한", submitFromQuote: "이 견적으로 수요 제출", marketFootnote: "시장 참고 견적 · 최종 조건은 문의 확인 기준 · 베이징 시간 06:00 매일 업데이트 · 초기 표본은 공급자 연동 후 검증 업데이트",
    workloadKicker: "워크로드에서 시작", workloadTitle: "작업부터 시작하세요", workloadLead: "거래 가능한 자원을 먼저 확인한 뒤 작업별로 필터링하세요. 가격, 인도 및 카드시간 정산은 동일한 주문 스냅샷을 사용합니다.", enter: "열기",
    servicesKicker: "10개 비즈니스 입구", servicesTitle: "익숙한 10개 명칭을 하나의 시장으로", servicesLead: "익숙한 이름은 바로가기로 유지하고 자원 유형, 거래 방식, 가격 단위에 통합 매핑합니다.",
    serviceLabels: { "compute-swap": "컴퓨팅 교환", "compute-rental": "컴퓨팅 대여", "gpu-swap": "GPU 교환", "gpu-rental": "GPU 대여", "token-hour-service": "Token 시간 서비스", "model-hour-service": "모델 시간 서비스", "model-capacity-hour-service": "모델 용량 시간 서비스", "compute-capacity-hour-service": "컴퓨팅 용량 시간 서비스", "compute-capacity-rental": "컴퓨팅 용량 대여", "compute-capacity-swap": "컴퓨팅 용량 교환" },
    actionKicker: "가격에서 실행으로", actionTitle: "적절한 가격을 찾았다면 동일한 백엔드로 수요를 보내세요.", actionLead: "제출하면 서버 수요 ID가 생성되고 공급자 견적은 구매자 작업공간으로 돌아옵니다.", submitDemand: "컴퓨팅 수요 제출", openMemberWorkspace: "회원 작업공간 열기",
  },
  fr: {
    metadataTitle: "La puissance de calcul, disponible au bon moment",
    metadataDescription: "Reliez une offre de calcul vérifiée à la demande réelle et achetez GPU, modèles, tokens, cloud et capacité d’entreprise en heures-carte KAI.",
    pricing: { taxIncluded: "Taxes incluses", taxExcluded: "Taxes non incluses", energyIncluded: "Énergie incluse", energyExcluded: "Énergie non incluse", networkIncluded: "Réseau inclus", networkExcluded: "Réseau non inclus" },
    quickActions: [
      { title: "Louer des GPU", copy: "H20, A800 et autres offres en heures-carte ou serveur" },
      { title: "Acheter des tokens", copy: "Comparer les prix d’entrée, de cache et de sortie par modèle" },
      { title: "Trouver une baie", copy: "Baies complètes, puissance et capacité réservée" },
      { title: "Échanger la capacité", copy: "Mettre en relation ce que j’offre et ce dont j’ai besoin" },
    ],
    marketKicker: "Aperçu du marché", marketTitle: "Cotations clés du jour", marketLead: "Les quatre catégories utilisent le catalogue unifié : prix, périmètre et validité restent traçables jusqu’à chaque ressource.", allMarkets: "Tous les marchés",
    resourceAndId: "Ressource / ID", region: "Région", referenceQuote: "Cotation indicative", quoteScope: "Taxes / énergie / réseau", sampleAndValidity: "Échantillons / validité", operation: "Action",
    samplePrefix: "Échantillon", sampleSuffix: "entrées", updated: "Mis à jour", validUntil: "Valable jusqu’au", submitFromQuote: "Soumettre depuis cette cotation", marketFootnote: "Cotations indicatives · Conditions finales à confirmer · Mise à jour quotidienne à 06:00, heure de Pékin · Les échantillons initiaux sont vérifiés après l’intégration des fournisseurs",
    workloadKicker: "Partir de la charge de travail", workloadTitle: "Commencez par votre besoin", workloadLead: "Consultez d’abord les ressources négociables, puis filtrez par tâche. Prix, livraison et règlement en heures-carte partagent le même instantané de commande.", enter: "Ouvrir",
    servicesKicker: "Dix entrées métier", servicesTitle: "Dix termes familiers, un seul marché", servicesLead: "Les noms usuels restent des raccourcis tandis que la plateforme les associe au type de ressource, au mode de transaction et à l’unité de prix.",
    serviceLabels: { "compute-swap": "Échange de calcul", "compute-rental": "Location de calcul", "gpu-swap": "Échange de GPU", "gpu-rental": "Location de GPU", "token-hour-service": "Service token-heure", "model-hour-service": "Service modèle-heure", "model-capacity-hour-service": "Service capacité modèle-heure", "compute-capacity-hour-service": "Service capacité calcul-heure", "compute-capacity-rental": "Location de capacité de calcul", "compute-capacity-swap": "Échange de capacité de calcul" },
    actionKicker: "Du prix à l’action", actionTitle: "Le bon prix trouvé, transmettez le besoin au même backend.", actionLead: "La soumission crée un identifiant de besoin côté serveur ; les offres fournisseurs reviennent dans l’espace acheteur.", submitDemand: "Soumettre un besoin", openMemberWorkspace: "Ouvrir l’espace membre",
  },
  th: {
    metadataTitle: "ส่งมอบพลังประมวลผลในทุกช่วงเวลาที่ต้องการ",
    metadataDescription: "เชื่อมต่อทรัพยากรประมวลผลที่ตรวจสอบแล้วกับความต้องการจริง และซื้อ GPU โมเดล Token คลาวด์ และทรัพยากรองค์กรด้วยชั่วโมงการ์ด KAI",
    pricing: { taxIncluded: "รวมภาษี", taxExcluded: "ไม่รวมภาษี", energyIncluded: "รวมค่าไฟ", energyExcluded: "ไม่รวมค่าไฟ", networkIncluded: "รวมเครือข่าย", networkExcluded: "ไม่รวมเครือข่าย" },
    quickActions: [
      { title: "เช่า GPU", copy: "H20, A800 และรายการแบบชั่วโมงการ์ดหรือชั่วโมงเซิร์ฟเวอร์" },
      { title: "ซื้อ Token", copy: "เปรียบเทียบราคาอินพุต แคช และเอาต์พุตตามโมเดล" },
      { title: "ค้นหาตู้แร็ก", copy: "ตู้เต็ม กำลังไฟ และความจุที่จองไว้" },
      { title: "แลกเปลี่ยนความจุ", copy: "จับคู่ทรัพยากรที่เสนอได้กับทรัพยากรที่ต้องการ" },
    ],
    marketKicker: "ภาพรวมตลาด", marketTitle: "ราคาสำคัญวันนี้", marketLead: "ทรัพยากรทั้งสี่ประเภทใช้แค็ตตาล็อกเดียวกัน จึงตรวจสอบราคา ขอบเขต และระยะเวลาย้อนกลับถึงทรัพยากรแต่ละรายการได้", allMarkets: "ดูตลาดทั้งหมด",
    resourceAndId: "ทรัพยากร / ID", region: "ภูมิภาค", referenceQuote: "ราคาอ้างอิงตลาด", quoteScope: "ภาษี / ค่าไฟ / เครือข่าย", sampleAndValidity: "ตัวอย่าง / ระยะเวลา", operation: "การทำงาน",
    samplePrefix: "ตัวอย่าง", sampleSuffix: "รายการ", updated: "อัปเดต", validUntil: "ใช้ได้ถึง", submitFromQuote: "ส่งความต้องการจากราคานี้", marketFootnote: "ราคาอ้างอิงตลาด · เงื่อนไขสุดท้ายยืนยันผ่านการสอบถาม · อัปเดตทุกวัน 06:00 น. ตามเวลาปักกิ่ง · ตัวอย่างเริ่มต้นจะตรวจสอบหลังผู้ให้บริการเชื่อมต่อ",
    workloadKicker: "เริ่มจากงาน", workloadTitle: "เริ่มจากงานของคุณ", workloadLead: "ดูทรัพยากรที่ซื้อขายได้ก่อน แล้วกรองตามงาน ราคา การส่งมอบ และการชำระด้วยชั่วโมงการ์ดใช้ภาพคำสั่งซื้อเดียวกัน", enter: "เปิด",
    servicesKicker: "สิบช่องทางธุรกิจ", servicesTitle: "สิบชื่อที่คุ้นเคย สู่ตลาดเดียว", servicesLead: "คงชื่อที่คุ้นเคยไว้เป็นทางลัด แล้วแมปกับประเภททรัพยากร รูปแบบธุรกรรม และหน่วยราคาอย่างเป็นระบบ",
    serviceLabels: { "compute-swap": "แลกเปลี่ยนการประมวลผล", "compute-rental": "เช่าการประมวลผล", "gpu-swap": "แลกเปลี่ยน GPU", "gpu-rental": "เช่า GPU", "token-hour-service": "บริการ Token ต่อชั่วโมง", "model-hour-service": "บริการโมเดลต่อชั่วโมง", "model-capacity-hour-service": "บริการความจุโมเดลต่อชั่วโมง", "compute-capacity-hour-service": "บริการความจุประมวลผลต่อชั่วโมง", "compute-capacity-rental": "เช่าความจุประมวลผล", "compute-capacity-swap": "แลกเปลี่ยนความจุประมวลผล" },
    actionKicker: "จากราคาสู่การดำเนินการ", actionTitle: "พบราคาที่เหมาะสมแล้ว ส่งความต้องการผ่านระบบหลังบ้านเดียวกัน", actionLead: "เมื่อส่งแล้ว ระบบจะสร้างรหัสความต้องการ และราคาจากผู้ให้บริการจะกลับไปยังพื้นที่ทำงานของผู้ซื้อ", submitDemand: "ส่งความต้องการประมวลผล", openMemberWorkspace: "เปิดพื้นที่สมาชิก",
  },
  vi: {
    metadataTitle: "Đưa năng lực tính toán đến đúng lúc cần thiết",
    metadataDescription: "Kết nối nguồn lực tính toán đã xác minh với nhu cầu thực và mua GPU, mô hình, Token, đám mây cùng năng lực doanh nghiệp bằng giờ-thẻ KAI.",
    pricing: { taxIncluded: "Đã gồm thuế", taxExcluded: "Chưa gồm thuế", energyIncluded: "Đã gồm điện", energyExcluded: "Chưa gồm điện", networkIncluded: "Đã gồm mạng", networkExcluded: "Chưa gồm mạng" },
    quickActions: [
      { title: "Thuê GPU", copy: "H20, A800 và các gói theo giờ-thẻ hoặc giờ máy chủ" },
      { title: "Mua Token", copy: "So sánh giá đầu vào, bộ nhớ đệm và đầu ra theo mô hình" },
      { title: "Tìm tủ rack", copy: "Tủ đầy đủ, công suất và năng lực dành trước" },
      { title: "Hoán đổi năng lực", copy: "Ghép nguồn lực có thể cung cấp với nguồn lực cần dùng" },
    ],
    marketKicker: "Tổng quan thị trường", marketTitle: "Báo giá chính hôm nay", marketLead: "Bốn nhóm tài nguyên đều dùng danh mục thống nhất, giúp truy xuất giá, phạm vi và thời hạn đến từng tài nguyên.", allMarkets: "Xem toàn bộ thị trường",
    resourceAndId: "Tài nguyên / ID", region: "Khu vực", referenceQuote: "Báo giá tham khảo", quoteScope: "Thuế / điện / mạng", sampleAndValidity: "Mẫu / thời hạn", operation: "Thao tác",
    samplePrefix: "Mẫu", sampleSuffix: "bản ghi", updated: "Cập nhật", validUntil: "Có hiệu lực đến", submitFromQuote: "Gửi nhu cầu theo báo giá", marketFootnote: "Báo giá tham khảo · Điều kiện cuối cùng được xác nhận khi hỏi giá · Cập nhật hằng ngày lúc 06:00 giờ Bắc Kinh · Mẫu ban đầu được xác minh sau khi nhà cung cấp kết nối",
    workloadKicker: "Bắt đầu từ tác vụ", workloadTitle: "Bắt đầu với tác vụ của bạn", workloadLead: "Xem tài nguyên có thể giao dịch trước rồi lọc theo tác vụ. Giá, bàn giao và quyết toán giờ-thẻ dùng cùng một ảnh chụp đơn hàng.", enter: "Mở",
    servicesKicker: "Mười lối vào nghiệp vụ", servicesTitle: "Mười tên gọi quen thuộc, một thị trường thống nhất", servicesLead: "Tên gọi quen thuộc được giữ làm lối tắt, còn nền tảng ánh xạ thống nhất tới loại tài nguyên, phương thức giao dịch và đơn vị giá.",
    serviceLabels: { "compute-swap": "Hoán đổi năng lực tính toán", "compute-rental": "Thuê năng lực tính toán", "gpu-swap": "Hoán đổi GPU", "gpu-rental": "Thuê GPU", "token-hour-service": "Dịch vụ Token theo giờ", "model-hour-service": "Dịch vụ mô hình theo giờ", "model-capacity-hour-service": "Dịch vụ năng lực mô hình theo giờ", "compute-capacity-hour-service": "Dịch vụ năng lực tính toán theo giờ", "compute-capacity-rental": "Thuê năng lực tính toán", "compute-capacity-swap": "Hoán đổi năng lực tính toán" },
    actionKicker: "Từ giá đến hành động", actionTitle: "Khi thấy mức giá phù hợp, hãy gửi nhu cầu qua cùng một hệ thống backend.", actionLead: "Sau khi gửi, hệ thống tạo mã nhu cầu phía máy chủ; báo giá của nhà cung cấp sẽ trở về không gian người mua.", submitDemand: "Gửi nhu cầu tính toán", openMemberWorkspace: "Mở không gian thành viên",
  },
  id: {
    metadataTitle: "Komputasi tersedia di setiap momen yang dibutuhkan",
    metadataDescription: "Hubungkan pasokan komputasi terverifikasi dengan kebutuhan nyata dan beli GPU, model, Token, cloud, serta kapasitas perusahaan dengan jam-kartu KAI.",
    pricing: { taxIncluded: "Termasuk pajak", taxExcluded: "Belum termasuk pajak", energyIncluded: "Termasuk energi", energyExcluded: "Belum termasuk energi", networkIncluded: "Termasuk jaringan", networkExcluded: "Belum termasuk jaringan" },
    quickActions: [
      { title: "Sewa GPU", copy: "H20, A800, dan penawaran per jam-kartu atau jam-server" },
      { title: "Beli Token", copy: "Bandingkan harga input, cache, dan output per model" },
      { title: "Cari rak", copy: "Rak penuh, daya, dan kapasitas cadangan" },
      { title: "Tukar kapasitas", copy: "Cocokkan sumber daya yang tersedia dengan yang dibutuhkan" },
    ],
    marketKicker: "Ringkasan pasar", marketTitle: "Kutipan utama hari ini", marketLead: "Keempat kelas sumber daya memakai katalog terpadu sehingga harga, cakupan, dan masa berlaku dapat ditelusuri ke setiap sumber daya.", allMarkets: "Lihat semua pasar",
    resourceAndId: "Sumber daya / ID", region: "Wilayah", referenceQuote: "Kutipan referensi pasar", quoteScope: "Pajak / energi / jaringan", sampleAndValidity: "Sampel / masa berlaku", operation: "Tindakan",
    samplePrefix: "Sampel", sampleSuffix: "rekaman", updated: "Diperbarui", validUntil: "Berlaku sampai", submitFromQuote: "Ajukan dari kutipan ini", marketFootnote: "Kutipan referensi pasar · Ketentuan akhir dikonfirmasi melalui permintaan · Diperbarui setiap hari pukul 06.00 waktu Beijing · Sampel awal diverifikasi setelah pemasok terhubung",
    workloadKicker: "Mulai dari beban kerja", workloadTitle: "Mulai dari tugas Anda", workloadLead: "Tinjau sumber daya yang dapat diperdagangkan, lalu saring berdasarkan tugas. Harga, pengiriman, dan penyelesaian jam-kartu memakai snapshot pesanan yang sama.", enter: "Buka",
    servicesKicker: "Sepuluh pintu bisnis", servicesTitle: "Sepuluh istilah yang dikenal, satu pasar terpadu", servicesLead: "Nama yang familier tetap menjadi pintasan sementara platform memetakannya ke jenis sumber daya, mode transaksi, dan satuan harga.",
    serviceLabels: { "compute-swap": "Tukar komputasi", "compute-rental": "Sewa komputasi", "gpu-swap": "Tukar GPU", "gpu-rental": "Sewa GPU", "token-hour-service": "Layanan Token per jam", "model-hour-service": "Layanan model per jam", "model-capacity-hour-service": "Layanan kapasitas model per jam", "compute-capacity-hour-service": "Layanan kapasitas komputasi per jam", "compute-capacity-rental": "Sewa kapasitas komputasi", "compute-capacity-swap": "Tukar kapasitas komputasi" },
    actionKicker: "Dari harga ke tindakan", actionTitle: "Menemukan harga yang sesuai? Kirim kebutuhan melalui backend yang sama.", actionLead: "Pengajuan membuat ID kebutuhan di server, lalu kutipan pemasok kembali ke ruang kerja pembeli.", submitDemand: "Ajukan kebutuhan komputasi", openMemberWorkspace: "Buka ruang anggota",
  },
  ms: {
    metadataTitle: "Pengkomputeran tersedia pada setiap saat diperlukan",
    metadataDescription: "Hubungkan bekalan pengkomputeran yang disahkan dengan permintaan sebenar dan beli GPU, model, Token, awan serta kapasiti perusahaan dengan jam-kad KAI.",
    pricing: { taxIncluded: "Termasuk cukai", taxExcluded: "Tidak termasuk cukai", energyIncluded: "Termasuk tenaga", energyExcluded: "Tidak termasuk tenaga", networkIncluded: "Termasuk rangkaian", networkExcluded: "Tidak termasuk rangkaian" },
    quickActions: [
      { title: "Sewa GPU", copy: "H20, A800 dan tawaran mengikut jam-kad atau jam-pelayan" },
      { title: "Beli Token", copy: "Bandingkan harga input, cache dan output mengikut model" },
      { title: "Cari rak", copy: "Rak penuh, kuasa dan kapasiti simpanan" },
      { title: "Tukar kapasiti", copy: "Padankan sumber yang boleh ditawarkan dengan yang diperlukan" },
    ],
    marketKicker: "Ringkasan pasaran", marketTitle: "Sebut harga utama hari ini", marketLead: "Keempat-empat kelas sumber menggunakan katalog bersepadu supaya harga, skop dan tempoh sah boleh dijejaki kepada setiap sumber.", allMarkets: "Lihat semua pasaran",
    resourceAndId: "Sumber / ID", region: "Wilayah", referenceQuote: "Sebut harga rujukan", quoteScope: "Cukai / tenaga / rangkaian", sampleAndValidity: "Sampel / tempoh sah", operation: "Tindakan",
    samplePrefix: "Sampel", sampleSuffix: "rekod", updated: "Dikemas kini", validUntil: "Sah sehingga", submitFromQuote: "Hantar daripada sebut harga", marketFootnote: "Sebut harga rujukan pasaran · Syarat akhir disahkan melalui pertanyaan · Dikemas kini setiap hari pada 06:00 waktu Beijing · Sampel awal disahkan selepas pembekal disambungkan",
    workloadKicker: "Mulakan daripada beban kerja", workloadTitle: "Mulakan dengan tugas anda", workloadLead: "Lihat sumber yang boleh didagangkan dahulu, kemudian tapis mengikut tugas. Harga, penghantaran dan penyelesaian jam-kad menggunakan petikan pesanan yang sama.", enter: "Buka",
    servicesKicker: "Sepuluh pintu perniagaan", servicesTitle: "Sepuluh istilah biasa, satu pasaran bersepadu", servicesLead: "Nama yang biasa dikekalkan sebagai pintasan sementara platform memetakannya kepada jenis sumber, mod transaksi dan unit harga.",
    serviceLabels: { "compute-swap": "Tukar pengkomputeran", "compute-rental": "Sewa pengkomputeran", "gpu-swap": "Tukar GPU", "gpu-rental": "Sewa GPU", "token-hour-service": "Perkhidmatan Token sejam", "model-hour-service": "Perkhidmatan model sejam", "model-capacity-hour-service": "Perkhidmatan kapasiti model sejam", "compute-capacity-hour-service": "Perkhidmatan kapasiti pengkomputeran sejam", "compute-capacity-rental": "Sewa kapasiti pengkomputeran", "compute-capacity-swap": "Tukar kapasiti pengkomputeran" },
    actionKicker: "Daripada harga kepada tindakan", actionTitle: "Menemui harga yang sesuai? Hantar permintaan melalui backend yang sama.", actionLead: "Penyerahan mencipta ID permintaan pada pelayan dan sebut harga pembekal kembali ke ruang kerja pembeli.", submitDemand: "Hantar permintaan pengkomputeran", openMemberWorkspace: "Buka ruang ahli",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const copy = HOME_COPY[locale];
  return { title: copy.metadataTitle, description: copy.metadataDescription };
}

const quickActionRoutes = [
  { code: "01", href: "/resources?category=gpu&deal=rental" },
  { code: "02", href: "/market#model-token-market" },
  { code: "03", href: "/resources?category=rack_capacity" },
  { code: "04", href: "/request?mode=swap" },
] as const;

const HOMEPAGE_QUOTE_CATEGORIES: readonly ResourceCategory[] = [
  "gpu",
  "token_model",
  "rack_capacity",
  "cloud_vendor",
];

const quoteRows = HOMEPAGE_QUOTE_CATEGORIES.map((category) => {
  const listing = resourceListings.find((item) => item.category === category && item.featured);
  if (!listing) throw new Error(`Homepage quote missing for category: ${category}`);
  return listing;
});
const homepageGpuQuote = quoteRows[0];

function pricingScope(listing: ResourceListing, copy: HomeCopy["pricing"]) {
  const { quote } = listing;
  return [
    quote.taxIncluded ? copy.taxIncluded : copy.taxExcluded,
    quote.energyIncluded ? copy.energyIncluded : copy.energyExcluded,
    quote.networkIncluded ? copy.networkIncluded : copy.networkExcluded,
  ].join(" · ");
}

function publicScopeNote(value: string) {
  return value
    .replaceAll("\u6f14\u793a价", "市场参考价")
    .replaceAll("\u6f14\u793a", "参考");
}

function formatBeijingTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function requestHref(listing: ResourceListing) {
  return `/request?${new URLSearchParams({
    listing: listing.id,
    mode: listing.dealModes[0],
    category: listing.category,
    unit: listing.pricingUnit,
    title: listing.title,
    region: listing.region,
  }).toString()}`;
}

const serviceEntries = serviceAliases.map((alias) => {
  const params = new URLSearchParams({
    category: alias.category,
    deal: alias.dealMode,
    unit: alias.pricingUnit,
  });
  return { fallbackLabel: alias.label, href: `/resources?${params.toString()}`, slug: alias.slug } as const;
});

export default async function Home() {
  const locale = await getRequestLocale();
  const copy = HOME_COPY[locale];
  const { snapshot, source } = await readMarketSnapshot();
  return (
    <>
      <LiveHomeMarketHero
        initialSource={source}
        initialSummary={{
          publishedAt: snapshot.publishedAt,
          quoteCount: snapshot.quotes.length,
          indexCurrent: snapshot.index.current,
          indexChange1d: snapshot.index.change1d,
          indexChange7d: marketIndexChange(snapshot, 7),
          indexChange30d: snapshot.index.change30d,
          gpuP50: homepageGpuQuote.quote.median,
          gpuCurrency: homepageGpuQuote.quote.currency,
          gpuPricingUnit: homepageGpuQuote.pricingUnit,
          gpuResourceTitle: homepageGpuQuote.title,
        }}
      />

      <section className="shell market-snapshot" aria-labelledby="market-snapshot-title">
        <div className="section-top">
          <div>
            <p className="kicker">{copy.marketKicker}</p>
            <h2 className="section-heading" id="market-snapshot-title">{copy.marketTitle}</h2>
            <p className="section-lead">{copy.marketLead}</p>
          </div>
          <Link className="button button-secondary" href="/market">{copy.allMarkets}</Link>
        </div>
        <div
          aria-labelledby="market-snapshot-title"
          className="data-table-wrap snapshot-table-wrap"
          role="region"
          tabIndex={0}
        >
          <table className="data-table snapshot-table">
            <thead>
              <tr><th>{copy.resourceAndId}</th><th>{copy.region}</th><th className="num">{copy.referenceQuote}</th><th>{copy.quoteScope}</th><th>{copy.sampleAndValidity}</th><th><span className="sr-only">{copy.operation}</span></th></tr>
            </thead>
            <tbody>
              {quoteRows.map((listing) => (
                <tr key={listing.id}>
                  <th scope="row">
                    <Link className="snapshot-resource-link" href={`/resources/${listing.id}`}>{listing.title}</Link>
                    <span className="snapshot-resource-id">{listing.id}</span>
                  </th>
                  <td>{listing.region}</td>
                  <td className="snapshot-price num">
                    <span className="snapshot-currency">{listing.quote.currency}</span>
                    {formatPrice(listing.quote.median, listing.pricingUnit)}
                  </td>
                  <td>
                    <strong>{pricingScope(listing, copy.pricing)}</strong>
                    <span className="snapshot-detail">{publicScopeNote(listing.quote.scopeNote)}</span>
                  </td>
                  <td>
                    <strong>{copy.samplePrefix} {listing.quote.sampleCount} {copy.sampleSuffix}</strong>
                    <span className="snapshot-detail">{copy.updated} <time dateTime={listing.quote.updatedAt}>{formatBeijingTime(listing.quote.updatedAt, locale)}</time></span>
                    <span className="snapshot-detail">{copy.validUntil} <time dateTime={listing.quote.validUntil}>{formatBeijingTime(listing.quote.validUntil, locale)}</time></span>
                  </td>
                  <td><Link className="table-action" href={requestHref(listing)}>{copy.submitFromQuote}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="data-footnote">{copy.marketFootnote}</p>
      </section>

      <section className="quick-decision" aria-labelledby="quick-decision-title">
        <div className="shell">
          <div className="section-top">
            <div>
              <p className="kicker">{copy.workloadKicker}</p>
              <h2 className="section-heading" id="quick-decision-title">{copy.workloadTitle}</h2>
            </div>
            <p>{copy.workloadLead}</p>
          </div>
          <div className="quick-grid">
            {quickActionRoutes.map((route, index) => (
              <Link className="quick-card" href={route.href} key={route.code}>
                <span className="quick-code">{route.code}</span>
                <strong>{copy.quickActions[index].title}</strong>
                <span>{copy.quickActions[index].copy}</span>
                <em>{copy.enter} →</em>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="service-section" aria-labelledby="service-entry-title">
        <div className="shell service-layout">
          <div>
            <p className="kicker">{copy.servicesKicker}</p>
            <h2 className="section-heading" id="service-entry-title">{copy.servicesTitle}</h2>
            <p className="section-lead">{copy.servicesLead}</p>
          </div>
          <div className="service-list">
            {serviceEntries.map((entry, index) => (
              <Link href={entry.href} key={entry.slug}><span>{String(index + 1).padStart(2, "0")}</span><strong>{copy.serviceLabels[entry.slug] ?? entry.fallbackLabel}</strong><em>→</em></Link>
            ))}
          </div>
        </div>
      </section>

      <section className="shell action-close" aria-labelledby="action-close-title">
        <div>
          <p className="kicker">{copy.actionKicker}</p>
          <h2 id="action-close-title">{copy.actionTitle}</h2>
          <p>{copy.actionLead}</p>
        </div>
        <div>
          <Link className="button button-primary" href="/request">{copy.submitDemand}</Link>
          <Link className="button button-secondary" href="/member">{copy.openMemberWorkspace}</Link>
        </div>
      </section>
    </>
  );
}
