import type { ReactNode } from "react";

/** The site's "i" disclosure: details stay one click away instead of on the page. */
export function Info({ label, children, className = "" }: { readonly label: string; readonly children: ReactNode; readonly className?: string }) {
  return (
    <details className={`mod-more info-inline ${className}`.trim()}>
      <summary>
        <span className="mod-info" aria-hidden="true">i</span>
        {label}
      </summary>
      <div className="info-body">{children}</div>
    </details>
  );
}
