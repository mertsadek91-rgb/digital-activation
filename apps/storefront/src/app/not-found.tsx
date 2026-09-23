import type { Metadata } from 'next';

/**
 * The 404 for a path that is not under a locale at all.
 *
 * `/wp-admin/`, `/xmlrpc.php`, a mistyped first segment: the locale layout
 * rejects these before it renders, so there is no header, no stylesheet and no
 * language to render in — Next showed its built-in English page. This is the
 * store's own instead, in both languages because nothing says which one the
 * visitor reads, Arabic first because it is the store's default.
 *
 * Inline styles for the same reason `global-error.tsx` uses them: the global
 * stylesheet is imported by the locale layout, which is exactly what did not
 * run.
 */
export const metadata: Metadata = {
  title: 'الصفحة غير موجودة · Page not found',
  robots: { index: false, follow: false },
};

const link = {
  display: 'inline-block',
  padding: '0.6rem 1.2rem',
  borderRadius: '999px',
  background: '#0f766e',
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 700,
} as const;

export default function RootNotFound() {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: '#fbfbfa',
          color: '#1a1a18',
          font: '16px/1.7 system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <main style={{ maxWidth: '34rem', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '3rem', fontWeight: 800, color: '#0f766e' }}>404</p>

          <h1 style={{ fontSize: '1.5rem', margin: '0.25rem 0 0.5rem' }}>الصفحة غير موجودة</h1>
          <p style={{ margin: '0 0 1.25rem', color: '#5c5c57' }}>
            الرابط الذي فتحته لا يشير إلى صفحة في المتجر.
          </p>
          <a href="/" style={link}>
            العودة إلى المتجر
          </a>

          <div lang="en" dir="ltr" style={{ marginTop: '2.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>Page not found</h2>
            <p style={{ margin: '0 0 1.25rem', color: '#5c5c57' }}>
              The link you opened does not point to a page in this store.
            </p>
            <a href="/en" style={link}>
              Back to the store
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
