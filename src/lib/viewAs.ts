import { apiError } from "@/lib/apiResponses";
import { isAdminDoctorEmail, isAllowedDoctorEmail, normalizeDoctorEmail } from "@/lib/auth";
import { getCurrentDoctor } from "@/lib/currentDoctor";
import { getServiceRoleClient } from "@/lib/supabase/server";

const VIEW_AS_HEADER = "X-View-As";

type DoctorIdentity = Awaited<ReturnType<typeof getCurrentDoctor>>;

export type ViewAsContext = {
  actualDoctor: DoctorIdentity;
  effectiveDoctor: DoctorIdentity;
  isViewAs: boolean;
};

export class ViewAsError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getRequestedViewAsDoctorId(request: Request) {
  const targetDoctorId = request.headers.get(VIEW_AS_HEADER)?.trim() ?? "";
  return targetDoctorId || null;
}

export async function getPreviewDoctorById(doctorId: string) {
  const admin = getServiceRoleClient();
  const { data, error } = await admin.auth.admin.getUserById(doctorId);
  if (error || !data.user?.id || !data.user.email) {
    return null;
  }

  const email = normalizeDoctorEmail(data.user.email);
  if (!email || !(await isAllowedDoctorEmail(email))) {
    return null;
  }

  return {
    id: data.user.id,
    email,
    isDevBypass: false,
  };
}

export async function getViewAsContext(request: Request): Promise<ViewAsContext> {
  const actualDoctor = await getCurrentDoctor();
  const targetDoctorId = getRequestedViewAsDoctorId(request);

  if (!targetDoctorId) {
    return {
      actualDoctor,
      effectiveDoctor: actualDoctor,
      isViewAs: false,
    };
  }

  if (!(await isAdminDoctorEmail(actualDoctor.email))) {
    throw new ViewAsError(403, "VIEW_AS_FORBIDDEN", "仅管理员可使用预览医生工作台。");
  }

  const targetDoctor = await getPreviewDoctorById(targetDoctorId);
  if (!targetDoctor) {
    throw new ViewAsError(404, "VIEW_AS_TARGET_NOT_FOUND", "找不到可预览的医生账号。");
  }

  return {
    actualDoctor,
    effectiveDoctor: targetDoctor,
    isViewAs: true,
  };
}

export function assertWritable(context: ViewAsContext) {
  if (!context.isViewAs) return null;
  return apiError(403, "VIEW_AS_READ_ONLY", "预览医生工作台为只读模式，不能执行此操作。");
}
