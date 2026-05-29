function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function cell(s: string, max: number): string {
  return truncate(s.replace(/[|\n\r]/g, " ").trim(), max);
}

function joinArray(arr: unknown, max = 1, sep = "；"): string {
  if (!Array.isArray(arr)) return "";
  return arr
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, max)
    .join(sep);
}

export function serializeConsultationsCompact(
  rows: Array<{ form_data: Record<string, unknown> | null; analysis_result: Record<string, unknown> | null }>,
): string {
  const SEP = " | ";
  const headers = [
    "#", "性/岁", "类型",
    "主诉", "诊断", "证型",
    "体检", "生命体征", "既往史",
    "处方", "医问",
    "AI重点", "AI建议", "AI复核", "AI风险",
  ].join(SEP);

  const dataRows = rows.map((row, i) => {
    const fd = row.form_data ?? {};
    const ar = row.analysis_result;

    const types = Array.isArray(fd.prescriptionType)
      ? (fd.prescriptionType as string[]).join("+")
      : String(fd.prescriptionType ?? "方药");

    const physicalExam = String(fd.physicalExam ?? "");
    const hasVitals = /血压|心率|体温|脉搏/.test(physicalExam);

    const groups = ar?.groups as Array<{ sections?: Array<{ items?: unknown[] }> }> | undefined;
    const g0 = groups?.[0];
    const g1 = groups?.[1];

    return [
      String(i + 1),
      `${fd.patientSex ?? "?"}/${fd.patientAge ?? "?"}`,
      cell(types, 20),
      cell(String(fd.chiefComplaint ?? ""), 50),
      cell(String(fd.diagnosis ?? ""), 30),
      cell(String(fd.pattern ?? ""), 30),
      cell(physicalExam, 60),
      hasVitals ? "[有]" : "[无]",
      fd.pastHistory ? cell(String(fd.pastHistory), 40) : "[未填]",
      cell(String(fd.prescription ?? ""), 80),
      fd.doctorQuestion ? cell(String(fd.doctorQuestion), 40) : "",
      cell(joinArray(ar?.keyPoints, 1), 50),
      cell(joinArray(g1?.sections?.[0]?.items, 1), 50),
      cell(joinArray(g0?.sections?.[1]?.items, 1), 50),
      cell(joinArray(ar?.cautions as unknown[], 1), 50),
    ].join(SEP);
  });

  return [
    "列说明：#=案例编号 | 生命体征=[有]/[无] | 既往史=[未填]表示未填写 | 医问=空表示未填写",
    headers,
    ...dataRows,
  ].join("\n");
}
