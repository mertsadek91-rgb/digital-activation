'use client';

/**
 * The last resort: the layout itself failed.
 *
 * This replaces the document rather than rendering inside it, which is why it
 * carries its own `<html>` and its own styles. Nothing can be relied on here —
 * not the stylesheet, not the font, not the header — because the thing that
 * would have provided them is what threw.
 *
 * So it is deliberately the plainest page on this store: Arabic, right to left,
 * one sentence, one link. Arabic unconditionally, because the locale is decided
 * by the layout and the layout is gone; Arabic is the default language of the
 * store and the root URL, so it is the right guess when there is no information
 * left to make a better one.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
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
        <main style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', margin: '0 0 0.75rem' }}>المتجر متوقّف مؤقّتاً</h1>
          <p style={{ margin: '0 0 1.5rem', color: '#5c5c57' }}>
            نعمل على إصلاح الأمر. إن كنت في منتصف طلب فلم يضِع شيء — راسِلنا وسنُكمله معك.
          </p>
          <a
            href="mailto:help@digital-activation.com"
            style={{
              display: 'inline-block',
              padding: '0.7rem 1.4rem',
              borderRadius: '8px',
              background: '#1a1a18',
              color: '#fbfbfa',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            راسِل الدعم
          </a>
          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#8a8a82' }}>
              رقم الخطأ: <code dir="ltr">{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
