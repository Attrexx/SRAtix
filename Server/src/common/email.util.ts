export function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? '').trim().toLowerCase();
}
