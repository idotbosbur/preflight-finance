import type { NotFoundProps } from "../ui-contracts.ts";

export function NotFoundPage({ message, homeHref, onLoadDemo }: NotFoundProps) {
  return (
    <div className="workspace notfound">
      <header className="page-head">
        <p className="eyebrow">Not found</p>
        <h1 className="page-title" tabIndex={-1}>This page isn't here</h1>
        <p className="lede">{message}</p>
      </header>
      <div className="row-actions">
        {onLoadDemo ? (
          <button type="button" className="btn btn-primary" onClick={onLoadDemo}>
            Load demo data
          </button>
        ) : null}
        <a className="btn btn-secondary" href={homeHref}>
          Go to the overview
        </a>
      </div>
    </div>
  );
}
