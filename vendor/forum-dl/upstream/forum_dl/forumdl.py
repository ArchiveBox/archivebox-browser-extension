# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from urllib.parse import quote_plus

from . import extractors
from . import writers
from .session import SessionOptions
from .extractors.common import ExtractorOptions
from .writers.common import WriterOptions


class ForumDl:
    def download(
        self,
        urls: list[str],
        output_format: str,
        session_options: SessionOptions,
        extractor_options: ExtractorOptions,
        writer_options: WriterOptions,
    ):
        for url in urls:
            self.download_url(
                url,
                output_format,
                session_options,
                extractor_options,
                writer_options,
            )

    def download_url(
        self,
        url: str,
        output_format: str,
        session_options: SessionOptions,
        extractor_options: ExtractorOptions,
        writer_options: WriterOptions,
    ):
        extractor = extractors.find(url, session_options, extractor_options)

        if extractor:
            extractor.fetch()
            writer_options.output_path = writer_options.output_path or quote_plus(url)
            writer = writers.find(
                extractor, output_format, session_options, writer_options
            )
            writer.write(url)

    def list_extractors(self):
        return extractors.modules

    def list_output_formats(self):
        return writers.modules
