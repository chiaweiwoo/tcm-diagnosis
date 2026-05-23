import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockListConsultations = vi.hoisted(() => vi.fn());
const mockCreateConsultation = vi.hoisted(() => vi.fn());
const mockViewAsContext = vi.hoisted(() => vi.fn());
const mockAssertWritable = vi.hoisted(() => vi.fn());

vi.mock("@/lib/consultations", () => ({
  listConsultations: mockListConsultations,
  createConsultation: mockCreateConsultation,
  updateConsultation: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({ client: "session" }),
  getServiceRoleClient: vi.fn().mockReturnValue({ client: "service" }),
}));

vi.mock("@/lib/logging", () => ({
  logServerEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/viewAs", () => ({
  getViewAsContext: mockViewAsContext,
  assertWritable: mockAssertWritable,
  ViewAsError: class ViewAsError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import { GET, POST } from "../route";

describe("consultations view-as routes", () => {
  beforeEach(() => {
    mockListConsultations.mockReset();
    mockCreateConsultation.mockReset();
    mockViewAsContext.mockReset();
    mockAssertWritable.mockReset();

    mockListConsultations.mockResolvedValue([]);
    mockCreateConsultation.mockResolvedValue({ id: "created-1" });
    mockAssertWritable.mockReturnValue(null);
  });

  it("lists the target doctor's consultations in view-as mode", async () => {
    mockViewAsContext.mockResolvedValue({
      actualDoctor: { id: "admin-1", email: "admin@example.com", isDevBypass: false },
      effectiveDoctor: { id: "doctor-2", email: "doctor@example.com", isDevBypass: false },
      isViewAs: true,
    });

    const response = await GET(new NextRequest("http://localhost/api/consultations", {
      headers: { "X-View-As": "doctor-2" },
    }));

    expect(response.status).toBe(200);
    expect(mockListConsultations).toHaveBeenCalledWith(
      { client: "service" },
      { doctorId: "doctor-2" },
    );
  });

  it("blocks consultation creation in view-as mode", async () => {
    mockViewAsContext.mockResolvedValue({
      actualDoctor: { id: "admin-1", email: "admin@example.com", isDevBypass: false },
      effectiveDoctor: { id: "doctor-2", email: "doctor@example.com", isDevBypass: false },
      isViewAs: true,
    });
    mockAssertWritable.mockReturnValue(
      new Response(JSON.stringify({ code: "VIEW_AS_READ_ONLY" }), { status: 403 }),
    );

    const response = await POST(new NextRequest("http://localhost/api/consultations", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json", "X-View-As": "doctor-2" },
    }));

    expect(response.status).toBe(403);
    expect(mockCreateConsultation).not.toHaveBeenCalled();
  });
});
