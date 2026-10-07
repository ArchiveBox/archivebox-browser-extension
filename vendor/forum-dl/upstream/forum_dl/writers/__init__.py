# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from .common import Writer, SimulatedWriter, WriterOptions
from ..extractors.common import Extractor
from ..exceptions import WriterNotFoundError
from ..session import SessionOptions

# from .strictyaml import StrictYamlWriter
import inspect

modules = ["babyl", "jsonl", "maildir", "mbox", "mh", "mmdf", "warc"]


def find(
    extractor: Extractor,
    module_name: str,
    session_options: SessionOptions,
    writer_options: WriterOptions,
):
    if session_options.get_urls:
        return SimulatedWriter(extractor, writer_options)

    globals_ = globals()

    if module_name in modules:
        module = __import__(module_name, globals_, None, (), 1)

        for cls in module.__dict__.values():
            if (
                inspect.isclass(cls)
                and not inspect.isabstract(cls)
                and issubclass(cls, Writer)
            ):
                return cls(extractor, writer_options)

    raise WriterNotFoundError(module_name)
