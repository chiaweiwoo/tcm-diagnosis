import { StructuredCaseForm } from "./caseSchema";

/**
 * Structured case fixtures derived from real clinic examples.
 * Used in tests — not committed to DB. Keep in sync with doctor_examples table seeding.
 */
export const VALID_FIXTURES: StructuredCaseForm[] = [
  // 001 — PCOS / 妇科调周期 / 方药
  {
    consultationName: "PCOS调周期",
    prescriptionType: ["方药"],
    patientAge: "33",
    patientSex: "女",
    chiefComplaint: "停经，月经不调，PCOS",
    currentIllness:
      "停经9月余，有PCOS。服用荷尔蒙药物2周催经，停药后月经来潮。点滴不畅，少许痛经。服用5日后月经干净，现以调理下次月经周期为主。",
    pastHistory: "PCOS病史",
    physicalExam: "舌淡胖苔薄白齿痕",
    diagnosis: "月经不调，PCOS",
    pattern: "肾虚血瘀",
    prescription:
      "月经来潮期：杏仁10g 红花10g 熟地黄10g 赤芍10g 补骨脂10g 三棱5g 莪术5g 香附10g 丹参10g 益母草10g 肉苁蓉10g 巴戟天10g\n月经干净后调理5日：六味地黄5g 巴戟天1g 女贞子1g 枸杞子1g 香附1g 熟地黄1g 肉苁蓉1g",
  },

  // 002 — 弹响指 / 针灸
  {
    consultationName: "弹响指针灸",
    prescriptionType: ["针灸"],
    patientAge: "54",
    patientSex: "女",
    chiefComplaint: "右侧拇指弹响指，无法弯曲",
    currentIllness:
      "右侧拇指弹响指半年余，数次针刺疗法后，拇指尚无法弯曲，掌面掌指关节压痛，活动时酸楚。",
    pastHistory: "",
    physicalExam: "掌面掌指关节压痛，活动时酸楚，拇指屈曲受限",
    diagnosis: "弹响指（屈指肌腱腱鞘炎）",
    pattern: "气血瘀滞",
    prescription: "阿是穴，合谷穴",
  },

  // 003 — 阳痿 / 肝郁肾虚 / 方药
  {
    consultationName: "阳痿肝郁肾虚",
    prescriptionType: ["方药"],
    patientAge: "65",
    patientSex: "男",
    chiefComplaint: "阳痿，偶尔无法完成射精",
    currentIllness: "近期出现阳痿，偶尔无法完成射精，近期压力较大，纳眠可，大便偏硬。",
    pastHistory: "高血压病史",
    physicalExam: "脉弦滑，舌尖红苔薄白根部裂纹",
    diagnosis: "阳痿",
    pattern: "肝郁肾虚",
    prescription: "六味地黄2.5 逍遥散2.5 菟丝子1 郁金1 枸杞子1 鸡血藤1 巴戟天1，服14日",
  },

  // 004 — 眩晕 / 肝阴虚 / 针灸
  {
    consultationName: "眩晕肝阴虚针灸",
    prescriptionType: ["针灸"],
    patientAge: "52",
    patientSex: "女",
    chiefComplaint: "眩晕，自觉不平衡，左眼内有压力感",
    currentIllness:
      "眩晕日久，数日前发作严重，天旋地转，之后自觉不平衡。左眼内有压力感，颈肩僵硬偶尔发作。视物有漂浮物。晨起目干，眼周浮肿；腹胀轻微，睡眠4-5小时间断，难以复睡。",
    pastHistory: "famotidine 1-2次/周，pantoprazole按需",
    physicalExam: "舌淡红胖苔薄白齿痕裂纹，脉弦",
    diagnosis: "眩晕",
    pattern: "肝阴虚",
    prescription: "印堂、四神聪、太阳、太溪、太冲、风池",
  },

  // 005 — 肩痛腰痛 / 肌肉劳损 / 综合调理
  {
    consultationName: "肩腰劳损推拿",
    prescriptionType: ["综合调理"],
    patientAge: "25",
    patientSex: "女",
    chiefComplaint: "右肩疼痛，左腰部僵硬不适",
    currentIllness:
      "近年频繁锻炼划龙舟，右肩疼痛加重；左腰部僵硬不适，活动后加重。",
    pastHistory: "",
    physicalExam: "右提肩肌压痛，左腰方肌压痛",
    diagnosis: "肌肉劳损",
    pattern: "气血瘀滞",
    prescription: "推拿：右肩提肩肌松解手法，左腰方肌松解手法",
  },

  // 006 — 腹胀便溏 / 脾虚湿盛 / 方药
  {
    consultationName: "腹胀脾虚湿盛",
    prescriptionType: ["方药"],
    patientAge: "28",
    patientSex: "女",
    chiefComplaint: "腹胀，大便溏",
    currentIllness:
      "腹胀已数月，晨起腹胀为主，大便日1次、便溏，饮食尚可，伴疲乏、精神差。",
    pastHistory: "",
    physicalExam: "舌淡红苔薄白腻，脉弦滑",
    diagnosis: "痞满",
    pattern: "脾虚湿盛",
    prescription: "二陈汤5 白术1 苍术1 山药1 香附1 艾叶1",
  },

  // 007 — 梨状肌综合征 / 综合调理
  {
    consultationName: "梨状肌综合征",
    prescriptionType: ["综合调理"],
    patientAge: "36",
    patientSex: "女",
    chiefComplaint: "左腰臀部疼痛酸楚，往左下肢外侧放射性麻痹",
    currentIllness:
      "1个月前左腰臀部出现酸楚，往左下肢外侧放射性麻痹。久坐可诱发，站立后略减轻。",
    pastHistory: "",
    physicalExam: "左侧梨状肌压痛（+），直腿抬高试验阴性",
    diagnosis: "梨状肌综合征",
    pattern: "气血瘀滞",
    prescription: "推拿：梨状肌松解手法，左腰臀部深层肌群放松",
  },

  // 008 — 中焦湿热 / GI / 方药
  {
    consultationName: "中焦湿热GI",
    prescriptionType: ["方药"],
    patientAge: "56",
    patientSex: "女",
    chiefComplaint: "腹胀，偶尔胃酸倒流，大便不净感",
    currentIllness:
      "腹胀已多时，餐前后均出现，偶尔胃酸倒流，纳可，大便不净感，咽干，口中异味，身热不扬。近次复诊：咽干、腹胀、大便不净感，自觉水肿。",
    pastHistory: "",
    physicalExam: "舌红苔黄白腻，脉弦",
    diagnosis: "中焦湿热",
    pattern: "湿热蕴结中焦",
    prescription: "防风通圣散5 泽泻1 枳实1 栀子1 厚朴1 萆薢1（每1代表1g颗粒=10g草药）",
  },

  // 009 — 不寐 / 心脾两虚 / 方药
  {
    consultationName: "不寐心脾两虚",
    prescriptionType: ["方药"],
    patientAge: "45",
    patientSex: "女",
    chiefComplaint: "入睡困难，多梦，醒后难以复睡",
    currentIllness:
      "失眠3个月余，入睡困难，多梦，醒后难以复睡，伴心悸，日间精神疲倦，纳可。",
    pastHistory: "",
    physicalExam: "舌淡红苔薄，脉细弱",
    diagnosis: "不寐",
    pattern: "心脾两虚",
    prescription:
      "归脾汤加减：黄芪15g 白术10g 茯苓10g 当归10g 远志10g 酸枣仁15g 龙眼肉10g 木香6g 炙甘草6g 大枣5枚",
  },

  // 010 — 颈椎病 / 气滞血瘀 / 综合调理
  {
    consultationName: "颈椎病综合调理",
    prescriptionType: ["针灸", "综合调理"],
    patientAge: "40",
    patientSex: "男",
    chiefComplaint: "颈肩酸痛，伴右上肢放射性麻木",
    currentIllness:
      "颈肩酸痛2年余，近2周症状加重，伴右上肢放射性麻木，低头久坐后明显。",
    pastHistory: "长期伏案工作",
    physicalExam: "颈椎活动受限，右臂丛神经牵拉试验阳性，舌淡苔薄白，脉弦",
    diagnosis: "颈椎病，颈肩综合征",
    pattern: "气滞血瘀",
    prescription:
      "针刺：风池、颈夹脊、肩井、曲池、合谷\n推拿：颈肩部松解，手法整脊",
  },
];

/** Minimal valid fixture for quick single-case tests */
export const MINIMAL_VALID: StructuredCaseForm = {
  consultationName: "",
  prescriptionType: ["方药"],
  patientAge: "30",
  patientSex: "女",
  chiefComplaint: "头痛，眩晕",
  currentIllness: "头痛2周余，伴轻度眩晕，无外伤史。",
  pastHistory: "",
  physicalExam: "舌淡红苔薄白，脉弦细",
  diagnosis: "头痛",
  pattern: "肝阳上亢",
  prescription: "天麻钩藤饮加减：天麻10g 钩藤15g 石决明20g 牛膝15g 黄芩10g",
};
