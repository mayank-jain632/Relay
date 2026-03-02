export function getApiBaseUrl(): string {
  const raw =
    process.env.RELAY_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'http://localhost:8787';

  return String(raw).trim().replace(/\/$/, '');
}

export function getDashboardSessionSecret(): string {
  const secret = process.env.DASHBOARD_SESSION_SECRET || process.env.SESSION_SECRET || '';
  if (!secret.trim()) {
    throw new Error('DASHBOARD_SESSION_SECRET (or SESSION_SECRET) is required for dashboard sessions.');
  }
  return secret;
}

export function getDashboardBaseUrl(): string {
  const raw = process.env.DASHBOARD_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3001';
  return String(raw).trim().replace(/\/$/, '');
}

export function getAdminApiKey(): string {
  return String(
    process.env.DASHBOARD_ADMIN_API_KEY ||
      process.env.RELAY_ADMIN_API_KEY ||
      process.env.ADMIN_API_KEY ||
      ''
  ).trim();
}
