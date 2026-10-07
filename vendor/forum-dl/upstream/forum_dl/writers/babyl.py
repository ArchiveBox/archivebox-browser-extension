# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from mailbox import Babyl, BabylMessage
from email.mime.multipart import MIMEMultipart

from .common import FolderedMailWriter, WriterOptions
from ..extractors.common import Extractor


class BabylWriter(FolderedMailWriter):
    tests = []

    def __init__(self, extractor: Extractor, options: WriterOptions):
        super().__init__(extractor, Babyl(options.output_path), options)

    def _new_message(self):
        return BabylMessage(MIMEMultipart("mixed"))
