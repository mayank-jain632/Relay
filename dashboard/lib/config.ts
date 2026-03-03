export function getApiBaseUrl(): string {
  const configured = process.env.RELAY_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const normalized = String(configured).trim().replace(/\/$/, '');

  if (normalized) {
    return normalized;
  }

  if (process.env.VERCEL) {
    throw new Error('RELAY_API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL) is required in Vercel environment.');
  }

  return 'http://localhost:8787';
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
