export const RESUME_MAX_BYTES = 10 * 1024 * 1024;

/** Returns a user-facing error message, or null if the file is allowed. */
export function validateResumeFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && !name.endsWith(".docx")) {
    return "Use a PDF or Word (.docx) file.";
  }
  if (file.size > RESUME_MAX_BYTES) {
    return "File must be 10 MB or smaller.";
  }
  return null;
}
