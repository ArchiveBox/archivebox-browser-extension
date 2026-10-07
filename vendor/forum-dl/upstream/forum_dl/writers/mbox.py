# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from mailbox import mbox, mboxMessage
from email.mime.multipart import MIMEMultipart

from .common import MailWriter, WriterOptions
from ..extractors.common import Extractor


class MboxWriter(MailWriter):
    tests = []

    def __init__(self, extractor: Extractor, options: WriterOptions):
        super().__init__(extractor, mbox(options.output_path), options)

    def _new_message(self):
        return mboxMessage(MIMEMultipart("mixed"))
