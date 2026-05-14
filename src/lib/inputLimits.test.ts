import { describe, expect, it } from "vitest";
import { MAX_ORGANIZE_DRAFT_CHARS, validateDraftLength } from "./inputLimits";

describe("validateDraftLength", () => {
  it("accepts drafts at or under the size limit", () => {
    const draft = "A".repeat(MAX_ORGANIZE_DRAFT_CHARS);
    expect(validateDraftLength(draft)).toEqual({
      length: MAX_ORGANIZE_DRAFT_CHARS,
      tooLong: false,
    });
  });

  it("flags drafts above the size limit", () => {
    const draft = "A".repeat(MAX_ORGANIZE_DRAFT_CHARS + 1);
    expect(validateDraftLength(draft)).toEqual({
      length: MAX_ORGANIZE_DRAFT_CHARS + 1,
      tooLong: true,
    });
  });
});
