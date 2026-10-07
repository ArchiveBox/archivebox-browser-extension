# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from .common import FileWriter, Entry


class JsonlWriter(FileWriter):
    def _serialize_entry(self, entry: Entry):
        return entry.json(models_as_dict=False)
