"""Test package: makes ``src`` importable when run from the project root.

Run all tests with: ``python -m unittest discover -s tests -t . -v``
"""

import os
import sys

_SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)
