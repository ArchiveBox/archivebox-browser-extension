# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from mailbox import MH, MHMessage
from email.mime.multipart import MIMEMultipart

from .common import FolderedMailWriter, WriterOptions
from ..extractors.common import Extractor


class MhWriter(FolderedMailWriter):
    tests = []

    def __init__(self, extractor: Extractor, options: WriterOptions):
        super().__init__(
            extractor,
            MH(options.output_path),
            options,
        )

    def _new_message(self):
        return MHMessage(MIMEMultipart("mixed"))
