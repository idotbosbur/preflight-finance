"""Server-rendered HTML views (pure functions; no I/O).

Every function returns a complete HTML document string. All interpolated values
are escaped with ``html.escape(str(v), quote=True)``. Pages reference only
``/static/style.css`` and (Command Center only) ``/static/upload.js``.
"""

from preflight.views.batch import render_batch
from preflight.views.command_center import render_command_center
from preflight.views.finding import render_finding
from preflight.views.report import render_error, render_report

__all__ = [
    "render_command_center",
    "render_batch",
    "render_finding",
    "render_report",
    "render_error",
]
