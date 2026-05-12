import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      状态: "未启用",
      说明: "当前版本仅提供本地模拟界面。正式接入时，此接口将在服务端验证医生身份、检查邮箱白名单、调用DeepSeek并保存交互记录。",
      默认模型: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    },
    { status: 501 },
  );
}
