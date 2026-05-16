-- Assessment samples library + job tracking
-- Run once in Supabase SQL editor.
-- Samples live only in DB — never committed to the codebase.

-- 1. Sample library
create table if not exists assessment_samples (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  form_data  jsonb not null,
  notes      text,
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 2. Assessment job (one row per admin-triggered run)
create table if not exists assessment_jobs (
  id           uuid primary key default gen_random_uuid(),
  triggered_by text not null,
  status       text not null default 'running',
  sample_count int,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- 3. One result row per sample per job
create table if not exists assessment_job_results (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references assessment_jobs(id) on delete cascade,
  sample_id   uuid not null references assessment_samples(id),
  form_data   jsonb not null,
  analysis    jsonb,
  error       text,
  duration_ms int,
  created_at  timestamptz not null default now()
);

-- Seed 10 samples
insert into assessment_samples (label, form_data, sort_order) values

(
  '女 33岁（素食者）· 停经9月余',
  '{
    "consultationName": "",
    "prescriptionType": ["方药"],
    "patientSex": "女",
    "patientAge": "33",
    "chiefComplaint": "停经9月余",
    "currentIllness": "有PCOS。服用荷尔蒙药物2周催经，停药后月经来潮。点滴不畅，少许痛经。服药5日后月经干净，转以调理下次周期为主。",
    "pastHistory": "IVF 失败",
    "physicalExam": "舌淡胖苔薄白齿痕",
    "diagnosis": "闭经",
    "pattern": "脾肾亏虚",
    "prescription": "初诊：杏仁10g 红花10g 熟地黄10g 赤芍10g 补骨脂10g 三棱5g 莪术5g 香附10g 丹参10g 益母草10g 肉苁蓉10g 巴戟天10g；调理：六味地黄5g 巴戟天1g 女贞子1g 枸杞子1g 香附1g 熟地黄1g 肉苁蓉1g",
    "doctorQuestion": ""
  }'::jsonb,
  1
),

(
  '女 54岁 · 右侧拇指弹响指半年余',
  '{
    "consultationName": "",
    "prescriptionType": ["针灸"],
    "patientSex": "女",
    "patientAge": "54",
    "chiefComplaint": "右侧拇指弹响指半年余",
    "currentIllness": "数次针刺疗法后，拇指尚无法弯曲，掌面掌指关节压痛，活动时酸楚。",
    "pastHistory": "",
    "physicalExam": "掌面掌指关节压痛（缺舌脉）",
    "diagnosis": "弹响指",
    "pattern": "气血瘀滞",
    "prescription": "阿是穴 合谷穴",
    "doctorQuestion": ""
  }'::jsonb,
  2
),

(
  '男 65岁 · 近期阳痿',
  '{
    "consultationName": "",
    "prescriptionType": ["方药"],
    "patientSex": "男",
    "patientAge": "65",
    "chiefComplaint": "近期阳痿",
    "currentIllness": "偶尔无法完成射精，近期压力较大，纳眠可，大便偏硬",
    "pastHistory": "高血压史",
    "physicalExam": "脉弦滑 舌尖红苔薄白根部裂纹",
    "diagnosis": "阳痿",
    "pattern": "肝郁肾虚",
    "prescription": "六味地黄2.5 逍遥散2.5 菟丝子1 郁金1 枸杞子1 鸡血藤1 巴戟天1，14d（每1代表10g草药）",
    "doctorQuestion": ""
  }'::jsonb,
  3
),

(
  '女 52岁 · 眩晕日久',
  '{
    "consultationName": "",
    "prescriptionType": ["针灸"],
    "patientSex": "女",
    "patientAge": "52",
    "chiefComplaint": "眩晕日久",
    "currentIllness": "数日前发作严重，天旋地转，之后自觉不平衡。左眼内有压力感，颈肩僵硬偶尔发作。视物有漂浮物。晨起目干，眼周浮肿；腹胀轻微；睡眠4-5h间断，难以复睡",
    "pastHistory": "famotidine 1-2次/周、pentaprazole按需（仅列药名，未注明对应病名）",
    "physicalExam": "舌淡红胖苔薄白齿痕裂纹 脉弦",
    "diagnosis": "眩晕",
    "pattern": "肝阴虚",
    "prescription": "印堂 四神聪 太阳 太溪 太冲 风池",
    "doctorQuestion": ""
  }'::jsonb,
  4
),

(
  '女 25岁 · 右肩疼痛',
  '{
    "consultationName": "",
    "prescriptionType": ["综合调理"],
    "patientSex": "女",
    "patientAge": "25",
    "chiefComplaint": "右肩疼痛",
    "currentIllness": "近年频繁锻炼划龙舟，右肩疼痛加重；左腰部僵硬不适",
    "pastHistory": "",
    "physicalExam": "右提肩肌、左腰方肌压痛（缺舌脉）",
    "diagnosis": "肌肉劳损",
    "pattern": "气血瘀滞",
    "prescription": "推拿",
    "doctorQuestion": ""
  }'::jsonb,
  5
),

(
  '女 28岁 · 腹胀',
  '{
    "consultationName": "",
    "prescriptionType": ["方药"],
    "patientSex": "女",
    "patientAge": "28",
    "chiefComplaint": "腹胀",
    "currentIllness": "晨起腹胀，大便日1次，便溏，饮食可。疲乏，精神差",
    "pastHistory": "",
    "physicalExam": "舌淡红苔薄白腻 脉弦滑",
    "diagnosis": "痞满",
    "pattern": "脾虚湿盛",
    "prescription": "二陈汤5 白术1 苍术1 山药1 香附1 艾叶1",
    "doctorQuestion": ""
  }'::jsonb,
  6
),

(
  '女 36岁 · 左腰臀部疼痛酸楚1月余',
  '{
    "consultationName": "",
    "prescriptionType": ["综合调理"],
    "patientSex": "女",
    "patientAge": "36",
    "chiefComplaint": "左腰臀部疼痛酸楚1月余",
    "currentIllness": "1月前左腰臀部出现酸楚，往左下肢外侧放射性麻痹，久坐可诱发",
    "pastHistory": "",
    "physicalExam": "左侧梨状肌压痛（缺舌脉）",
    "diagnosis": "梨状肌综合征",
    "pattern": "气血瘀滞",
    "prescription": "推拿",
    "doctorQuestion": ""
  }'::jsonb,
  7
),

(
  '女 56岁 · 腹胀',
  '{
    "consultationName": "",
    "prescriptionType": ["方药"],
    "patientSex": "女",
    "patientAge": "56",
    "chiefComplaint": "腹胀",
    "currentIllness": "腹胀，餐前后均有，偶尔胃酸倒流，纳可，大便不净感，咽干，口中异味，身热不扬。随访13/05/26：咽干、腹胀、大便不净感、自觉水肿",
    "pastHistory": "",
    "physicalExam": "舌红苔黄白腻 脉弦",
    "diagnosis": "痞满",
    "pattern": "中焦湿热",
    "prescription": "防风通圣散5 泽泻1 枳实1 栀子1 厚朴1 萆薢1（每1g颗粒=10g草药）",
    "doctorQuestion": ""
  }'::jsonb,
  8
),

(
  '女 47岁 · 咽痛2周',
  '{
    "consultationName": "",
    "prescriptionType": ["方药"],
    "patientSex": "女",
    "patientAge": "47",
    "chiefComplaint": "咽痛2周",
    "currentIllness": "初起感冒，咳嗽4日，服西药后缓解，随后出现咽痛。干痛无痰，疼痛甚，影响吞咽，饮水不解。夜间口干加重，咽喉干涩",
    "pastHistory": "",
    "physicalExam": "舌红苔少 脉细数",
    "diagnosis": "咽痛",
    "pattern": "肾阴虚",
    "prescription": "六味地黄丸5 麦冬1 五味子1 天花粉1 桔梗1 玄参1，日2次，共7日",
    "doctorQuestion": ""
  }'::jsonb,
  9
),

(
  '女 27岁 · 腹胀反复发作数月',
  '{
    "consultationName": "",
    "prescriptionType": ["方药"],
    "patientSex": "女",
    "patientAge": "27",
    "chiefComplaint": "腹胀反复发作数月",
    "currentIllness": "晨起尤甚，随后逐渐减少。进食后诱发腹胀，纳呆，便秘2-3日1行，无便意，小便可。工作压力较大，夜间睡眠尚可",
    "pastHistory": "",
    "physicalExam": "舌边红胖苔薄白 脉左关弦右关沉",
    "diagnosis": "痞满",
    "pattern": "肝郁脾虚",
    "prescription": "逍遥散5 香附1 佛手1 枳实1 薏苡仁1 石菖蒲1",
    "doctorQuestion": ""
  }'::jsonb,
  10
);
