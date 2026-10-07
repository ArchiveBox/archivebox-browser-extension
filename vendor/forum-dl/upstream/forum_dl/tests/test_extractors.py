# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from .. import extractors
from ..extractors.common import Extractor, ExtractorOptions, Board, Thread
from ..session import Session, SessionOptions
from ..version import __version__

import itertools

import hashlib
import pytest

testdata: list[tuple[Type[Extractor], list[Any]]] = []
for cls in extractors.list_classes():
    for test in cls.tests:
        testdata.append((cls, test))


@pytest.mark.parametrize("cls,test", testdata)
def test_extractors(cls: Type[Extractor], test: dict[str, Any]):
    session = Session(
        SessionOptions(
            timeout=5,
            retries=1,
            retry_sleep=1,
            retry_sleep_multiplier=0,
            warc_output="",
            user_agent=f"Forum-dl {__version__}",
            get_urls=False,
        )
    )

    url = test.pop("url")
    print(f"url: {url}")

    extractor = cls.detect(session, url, ExtractorOptions(path=True))

    assert isinstance(extractor, cls)

    if test_extractor_type := test.pop("test_extractor_type", None):
        assert isinstance(extractor, eval(test_extractor_type))

    if test_base_url := test.pop("test_base_url", None):
        assert extractor.base_url == test_base_url

    extractor.fetch()

    base_node = extractor.node_from_url(url)

    test_boards = test.pop("test_boards", None)
    test_board_count = test.pop("test_board_count", None)

    if test_boards or test_board_count:
        assert isinstance(base_node, Board)

        boards = list(
            itertools.islice(
                extractor.subboards(base_node), test.pop("board_count", None)
            )
        )
        print(f"boards: {boards}")

        if test_boards:
            for path, test_board in test_boards.items():
                board = extractor.find_board(path)
                assert path == board.path

                if test_title := test_board.pop("title"):
                    assert board.title == test_title

                assert not test_board

        if test_board_count:
            assert extractor.board_count() == test_board_count

    if isinstance(base_node, Board):
        initial_page = test.pop("initial_page", None)
        items = list(
            itertools.islice(
                extractor.threads(base_node, initial_page),
                test.pop("item_count", None),
            )
        )
        print(items)

        if test_titles_hash := test.pop("test_titles_hash", None):
            titles = [item.title for item in items]
            hash = hashlib.sha1("\0".join(titles).encode("utf-8")).hexdigest()
            print(f"hash: {hash}")

            assert hash == test_titles_hash
    elif isinstance(base_node, Thread):
        initial_page = test.pop("initial_page", None)
        items = list(
            itertools.islice(
                extractor.posts(base_node, initial_page),
                test.pop("item_count", None),
            )
        )
        print(items)

        if test_contents_hash := test.pop("test_contents_hash", None):
            contents = [item.content for item in items]
            hash = hashlib.sha1("\0".join(contents).encode("utf-8")).hexdigest()
            print(f"hash: {hash}")

            assert hash == test_contents_hash
    else:
        items = None

    if test_items := test.pop("test_items", None):
        assert items

        for i, item in enumerate(items):
            if test_item := test_items.pop(i, None):
                print(i, test_item)

                if test_title := test_item.pop("title"):
                    assert isinstance(item, Thread) and item.title == test_title

                if test_path := test_item.pop("path"):
                    assert item.path == test_path

                assert not test_item

        assert not test_items

    if test_item_count := test.pop("test_item_count", None):
        assert items
        assert len(items) == test_item_count

    if test_min_item_count := test.pop("test_min_item_count", None):
        assert items
        assert len(items) >= test_min_item_count

    assert not test
