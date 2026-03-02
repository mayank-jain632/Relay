import { redirect } from 'next/navigation';
import { getDashboardSession } from './session';

export async function requireDashboardSession() {
  const session = await getDashboardSession();
  if (!session) {
    redirect('/login');
  }
  return session;
}
