/**
 * Placeholders for the catalogue pages while their data is fetched.
 *
 * Without a `loading.tsx` the previous page stayed on screen, unresponsive,
 * for as long as the API took — on a phone that reads as a tap that did not
 * register, and it gets tapped again. These are drawn from the same layout
 * classes as the real pages, so nothing jumps when the content lands.
 *
 * A loading file receives no params, so the one sentence here is in both
 * languages; it is visually hidden and exists for screen readers.
 */
function Busy() {
  return <span className="visually-hidden">جارٍ التحميل · Loading</span>;
}

function CardSkeleton() {
  return (
    <div className="card skeleton-card" aria-hidden="true">
      <div className="card-media skeleton" />
      <div className="card-body">
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line skeleton-short" />
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <main className="shell" aria-busy="true">
      <Busy />
      <header className="page-head" aria-hidden="true">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" />
      </header>
      <div className="grid">
        {Array.from({ length: count }, (_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    </main>
  );
}

export function ProductSkeleton() {
  return (
    <main className="shell product" aria-busy="true">
      <Busy />
      <div className="product-top" aria-hidden="true">
        <div className="product-media-col">
          <div className="gallery skeleton" />
        </div>
        <div className="buybox">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line skeleton-short" />
          <div className="skeleton skeleton-block" />
        </div>
      </div>
    </main>
  );
}
