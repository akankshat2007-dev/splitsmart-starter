import './globals.css';
import SessionControl from './session-control';

export const metadata = {
  title: 'SplitSmart',
  description: 'Split expenses with your group — the easy way.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}<SessionControl /></body>
    </html>
  );
}
