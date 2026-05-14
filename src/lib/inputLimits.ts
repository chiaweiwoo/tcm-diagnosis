export const MAX_ORGANIZE_DRAFT_CHARS = 8_000;

export function validateDraftLength(draft: string) {
  const length = draft.trim().length;
  return {
    length,
    tooLong: length > MAX_ORGANIZE_DRAFT_CHARS,
  };
}
