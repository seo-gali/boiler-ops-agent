export function Skeleton() {
  return <div className="view-skeleton" role="status" aria-label="화면 불러오는 중">
    <span className="sr-only">화면 불러오는 중…</span>
    <div className="skeleton-heading" aria-hidden="true" />
    <div className="skeleton-cards" aria-hidden="true"><span /><span /><span /></div>
    <div className="skeleton-content" aria-hidden="true"><span /><span /><span /></div>
  </div>;
}
