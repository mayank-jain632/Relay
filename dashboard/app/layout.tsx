import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Relay Dashboard',
  description: 'Relay PM control panel'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
