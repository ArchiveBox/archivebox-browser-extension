# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore
from types import ModuleType

import inspect

from .common import Extractor, ExtractorOptions
from ..exceptions import ExtractorNotFoundError
from ..session import Session, SessionOptions

modules = [
    "hackernews",
    "hyperkitty",
    "pipermail",
    "hypermail",
    "xenforo",
    "vbulletin",
    "proboards",
    "invision",
    "discourse",
    "simplemachines",
    "phpbb",
]


def find(
    url: str, session_options: SessionOptions, extractor_options: ExtractorOptions
):
    session = Session(session_options)

    for cls in list_classes():
        obj = cls.detect(session, url, extractor_options)
        if obj:
            return obj

    raise ExtractorNotFoundError(url)


def list_classes() -> Iterable[Any]:
    globals_ = globals()

    for module_name in modules:
        module = __import__(module_name, globals_, None, (), 1)
        yield from _get_classes(module)


def _get_classes(module: ModuleType):
    return [
        cls
        for cls in module.__dict__.values()
        if (
            inspect.isclass(cls)
            and not inspect.isabstract(cls)
            and issubclass(cls, Extractor)
        )
    ]
