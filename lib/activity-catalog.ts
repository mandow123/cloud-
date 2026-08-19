export type ActivityCatalogStatus = "进行中" | "即将开始" | "评审中" | "已颁奖" | "长期活动";

export type ActivityCatalogItem = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  status: ActivityCatalogStatus;
  category: "图像" | "视频" | "3D" | "声音" | "共创";
  date: string;
  deadline: string;
  reward: string;
  participants: string;
  tone: "city" | "sound" | "miniature" | "material" | "relay" | "memory";
  mechanic: string;
  brief: string;
  steps: readonly string[];
  prizes: readonly string[];
  requirements: readonly string[];
  eligibility: string;
  judging: string;
  rights: string;
  rewardDelivery: string;
};

export const activityCatalog: readonly ActivityCatalogItem[] = [
  {
    id: "act_neon_city",
    slug: "neon-city",
    title: "霓虹城市重构计划",
    subtitle: "给熟悉的街区写一条平行世界线",
    status: "进行中",
    category: "图像",
    date: "08.12 — 09.08",
    deadline: "2026.09.08 23:59（北京时间）截稿",
    reward: "12 万 KAI 时 + 城市大屏展映",
    participants: "3,842 件作品",
    tone: "city",
    mechanic: "城市地图共创",
    brief: "选择一处真实地标，用 AI 重新设计它的未来身份。作品会被拼进一张可探索的共创城市地图。",
    steps: ["领取一张城市坐标卡", "提交主视觉与 80 字世界观", "为其他街区投出能量", "入围作品共同组成城市地图"],
    prizes: ["城市主理人奖：30,000 KAI 时", "视觉突破奖：20,000 KAI 时", "社区共鸣奖：10,000 KAI 时", "入围作品：城市大屏联合展映"],
    requirements: ["JPG、PNG 或 WebP，单张不超过 10MB", "需公开关键提示词或创作过程", "不得使用未授权人物肖像和第三方商标"],
    eligibility: "年满 18 周岁的个人创作者或已取得监护人同意的创作者均可参加；团队投稿需指定一名奖励接收人。",
    judging: "专业评审 60%（概念 25 / 视觉 20 / 完成度 15）＋社区能量 30%＋过程公开度 10%。",
    rights: "版权归创作者所有；入围作品授权 KAI 在本活动宣传和展映中署名使用，任何商业授权需另行确认。",
    rewardDelivery: "结果公布后 15 个工作日内完成账户核验并发放 KAI 时；实物或现金奖励按适用税务规则处理。",
  },
  {
    id: "act_sound_shape",
    slug: "sound-shape",
    title: "把声音变成一座岛",
    subtitle: "同一段声音，可以长出多少种风景？",
    status: "进行中",
    category: "声音",
    date: "08.19 — 09.18",
    deadline: "2026.09.18 23:59（北京时间）截稿",
    reward: "8 万 KAI 时 + 声音素材授权包",
    participants: "1,260 件作品",
    tone: "sound",
    mechanic: "盲听创作",
    brief: "先听一段 30 秒声音，在看不到其他参赛作品的情况下，把节奏、情绪或环境线索转化成视觉岛屿。",
    steps: ["随机抽取一段声音", "完成静帧或 15 秒动态作品", "提交前隐藏全站同题作品", "揭晓后进入百种想象对照墙"],
    prizes: ["最佳声音叙事：25,000 KAI 时", "最佳视觉转译：20,000 KAI 时", "观众探索奖：10,000 KAI 时"],
    requirements: ["图像或视频封面，单文件不超过 10MB", "说明声音与画面的对应关系", "提交后作品经审核再公开"],
    eligibility: "个人与不超过 5 人的团队均可参加，需使用活动提供或明确拥有权利的声音素材。",
    judging: "声音转译 35%＋视觉表达 35%＋叙事完整度 20%＋社区能量 10%。",
    rights: "作品版权归创作者；活动声音包仅限本次参赛与个人作品集展示，不得单独转售。",
    rewardDelivery: "获奖公示 7 天无异议后，于 15 个工作日内发放账户奖励与素材授权包。",
  },
  {
    id: "act_tiny_world",
    slug: "tiny-world",
    title: "掌心里的小世界",
    subtitle: "从一个日常物件开始搭建微缩宇宙",
    status: "即将开始",
    category: "3D",
    date: "09.01 开启",
    deadline: "2026.09.01 10:00（北京时间）开放",
    reward: "创作工具包 × 500 + 新人专属榜",
    participants: "928 人已预约",
    tone: "miniature",
    mechanic: "主题卡抽签",
    brief: "每位参与者会抽到一个物件、一个情绪和一条限制条件，再把它们组合成可被相信的微缩世界。",
    steps: ["预约并抽取三张主题卡", "完成微缩场景与尺寸对照", "公开一段失败尝试", "由新人榜和评审榜分别评选"],
    prizes: ["微缩世界大奖：创作工作站", "最佳新人：专业工具包", "完整过程奖：算力补给包"],
    requirements: ["允许图像或 3D 渲染", "必须保留抽到的三张主题卡", "活动开始后方可投稿"],
    eligibility: "面向注册未满 180 天或历史公开作品少于 10 件的新创作者；其他用户可参加公开展示但不进入新人奖。",
    judging: "主题卡完成度 30%＋空间想象 30%＋细节 25%＋过程记录 15%。",
    rights: "作品版权归创作者，主题卡可自由用于本次作品；平台仅获得活动展示所需的非独占授权。",
    rewardDelivery: "名单公示后 20 个工作日内寄送工具包，算力奖励直接进入实名账户。",
  },
  {
    id: "act_open_lab",
    slug: "open-lab",
    title: "一百种不可能材质",
    subtitle: "让玻璃呼吸，让金属像云一样漂浮",
    status: "长期活动",
    category: "图像",
    date: "每周五更新",
    deadline: "每周五 18:00（北京时间）结算周榜",
    reward: "周榜算力加成 + 材质库署名",
    participants: "6,419 件作品",
    tone: "material",
    mechanic: "每周材质实验",
    brief: "每周只研究一种不存在的材质。优秀作品会沉淀进开放材质库，供社区在署名规则下继续创作。",
    steps: ["领取本周材质词", "上传材质球或应用场景", "允许其他创作者衍生", "周五进入公开材质库"],
    prizes: ["周榜 TOP 10：双倍算力返还", "年度材质研究者：独立专题展", "高质量节点：材质库永久署名"],
    requirements: ["必须展示材质在至少两种光照下的表现", "鼓励提供节点图或提示词", "长期活动可重复投稿"],
    eligibility: "所有已登录创作者均可参加，每个自然周最多 3 件作品进入周榜。",
    judging: "技术可信度 35%＋视觉新颖度 35%＋可复用性 20%＋社区能量 10%。",
    rights: "创作者可选择是否开放衍生；进入开放材质库的作品采用署名、非独占的社区展示授权。",
    rewardDelivery: "周榜结算后 3 个工作日内发放算力加成，年度专题展另行联系确认。",
  },
  {
    id: "act_character_relay",
    slug: "character-relay",
    title: "24 小时角色接力赛",
    subtitle: "把一个角色交给陌生人继续完成",
    status: "评审中",
    category: "共创",
    date: "08.16 — 08.18",
    deadline: "2026.08.24 20:00（北京时间）公布结果",
    reward: "5 万 KAI 时 + 共创分成",
    participants: "2,106 条接力链",
    tone: "relay",
    mechanic: "接力创作",
    brief: "每条作品都可以衍生角色、场景、音乐或短片，最终奖励按照链路贡献公开分配。",
    steps: ["选择一条开放接力链", "在 24 小时内补完下一棒", "原作者确认衍生关系", "完整链路进入联合评审"],
    prizes: ["最佳共创链：30,000 KAI 时", "最佳世界观补完：12,000 KAI 时", "最受欢迎支线：8,000 KAI 时"],
    requirements: ["当前已停止新投稿", "接力作品需保留上游署名", "禁止擅自删除已确认的贡献关系"],
    eligibility: "本期接力已截止；公开链路上的每位已确认贡献者均进入联合评审。",
    judging: "完整链路叙事 40%＋各棒衔接 30%＋原创贡献 20%＋社区能量 10%。",
    rights: "各创作者保留自己节点的版权；整条链的商业使用需取得所有贡献者同意。",
    rewardDelivery: "结果公示后按系统记录的贡献比例拆分奖励，7 个工作日内进入各成员账户。",
  },
  {
    id: "act_memory_restore",
    slug: "memory-restore",
    title: "老照片会说话",
    subtitle: "用 AI 修复真实记忆，而不是改写它",
    status: "已颁奖",
    category: "视频",
    date: "07.01 — 07.31",
    deadline: "2026.08.31 前开放获奖作品展映",
    reward: "公益基金 10 万元 + 纪录片展映",
    participants: "1,588 件作品",
    tone: "memory",
    mechanic: "真实记忆档案",
    brief: "以获得授权的旧照片为起点，展示原图、修复过程与一段被照片唤醒的真实叙述。",
    steps: ["提交授权与真实性说明", "展示原图和修复对比", "补充 60 秒记忆叙述", "获奖作品进入公益数字档案"],
    prizes: ["年度记忆奖：50,000 元公益基金", "最佳修复：30,000 元", "公众共鸣奖：20,000 元"],
    requirements: ["活动已结束，仅开放浏览和投票记录", "人物肖像必须获得授权", "禁止虚构照片人物经历"],
    eligibility: "本期征集已结束；展映作品均已完成肖像授权和真实性复核。",
    judging: "修复质量 30%＋叙事真实性 35%＋人文表达 25%＋公众共鸣 10%。",
    rights: "照片与故事权利归投稿人与相关权利人；公益档案仅按确认范围保存和展映。",
    rewardDelivery: "公益基金已按获奖者确认的用途执行，完整记录在活动公示页保留 12 个月。",
  },
] as const;

export function activityBySlug(slug: string) {
  return activityCatalog.find((item) => item.slug === slug);
}
