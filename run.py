"""Start the local Stage 1 prototype: ``python run.py`` then open http://127.0.0.1:8765/

Binds to 127.0.0.1 only. Synthetic data only.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from preflight.app import create_server  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Preflight Finance Stage 1 (synthetic, local only)")
    parser.add_argument("--db", default=os.path.join("data", "preflight.sqlite"), help="SQLite file path")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(args.db)), exist_ok=True)
    server = create_server(args.db, args.port)
    print(f"Preflight Finance Stage 1 (synthetic data only) at {server.url}  — Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
