# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from .common import SimulatedWriter


# The WARC writer does nothing, as both WARC recording and writing is actually performed by
# `Session`.
class WarcWriter(SimulatedWriter):
    pass
