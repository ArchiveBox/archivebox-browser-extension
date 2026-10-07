# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore
from re import Pattern

from .exceptions import TagSearchError, AttributeSearchError, PropertyError
import bs4

SoupInput = Callable[[Any], bool] | Pattern[str] | set[str] | str | bool | None


class Soup:
    def __init__(self, markup: str | bytes):
        self.soup = bs4.BeautifulSoup(markup, "lxml")

    def try_find(
        self,
        name: SoupInput | None = None,
        attrs: dict[str, Any] = {},
        recursive: bool = True,
        string: SoupInput | None = None,
        **kwargs: Any,
    ) -> SoupTag | None:
        result = self.soup.find(name, attrs, recursive, string, **kwargs)

        if result is not None and not isinstance(result, bs4.element.Tag):
            raise TagSearchError(self.soup, name, attrs, recursive, string, kwargs)

        if result:
            return SoupTag(result)

    def find(
        self,
        name: SoupInput | None = None,
        attrs: dict[str, Any] = {},
        recursive: bool = True,
        string: SoupInput | None = None,
        **kwargs: Any,
    ) -> SoupTag:
        result = self.try_find(name, attrs, recursive, string, **kwargs)

        if not result:
            raise TagSearchError(self.soup, name, attrs, recursive, string, kwargs)

        return result

    def find_all(
        self,
        name: SoupInput | None = None,
        attrs: dict[str, Any] = {},
        recursive: bool = True,
        string: SoupInput | None = None,
        limit: int | None = None,
        **kwargs: Any,
    ) -> list[SoupTag]:
        result = self.soup.find_all(name, attrs, recursive, string, limit, **kwargs)

        return [SoupTag(tag) for tag in result]


class SoupTag:
    def __init__(self, tag: bs4.element.Tag):
        self.tag = tag

    def try_find(
        self,
        name: SoupInput | None = None,
        attrs: dict[str, Any] = {},
        recursive: bool = True,
        string: SoupInput | None = None,
        **kwargs: Any,
    ) -> SoupTag | None:
        result = self.tag.find(name, attrs, recursive, string, **kwargs)

        if result is not None and not isinstance(result, bs4.element.Tag):
            raise TagSearchError(self.tag, name, attrs, recursive, string, kwargs)

        if result:
            return SoupTag(result)

    def find(
        self,
        name: SoupInput | None = None,
        attrs: dict[str, Any] = {},
        recursive: bool = True,
        string: SoupInput | None = None,
        **kwargs: Any,
    ):
        result = self.try_find(name, attrs, recursive, string, **kwargs)

        if not result:
            raise TagSearchError(self.tag, name, attrs, recursive, string, kwargs)

        return result

    def find_all(
        self,
        name: SoupInput | None = None,
        attrs: dict[str, Any] = {},
        recursive: bool = True,
        string: SoupInput | None = None,
        limit: int | None = None,
        **kwargs: Any,
    ):
        result = self.tag.find_all(name, attrs, recursive, string, limit, **kwargs)

        return [SoupTag(tag) for tag in result]

    def find_next(
        self,
        name: SoupInput | None = None,
        attrs: dict[str, Any] = {},
        string: SoupInput | None = None,
        **kwargs: Any,
    ):
        result = self.tag.find_next(name, attrs, string, **kwargs)

        if not isinstance(result, bs4.element.Tag):
            raise TagSearchError(self.tag, name, attrs, string, kwargs)

        return SoupTag(result)

    def find_previous(
        self,
        name: SoupInput | None = None,
        attrs: dict[str, Any] = {},
        string: SoupInput | None = None,
        **kwargs: Any,
    ):
        result = self.tag.find_previous(name, attrs, string, **kwargs)

        if not isinstance(result, bs4.element.Tag):
            raise TagSearchError(self.tag, name, attrs, string, kwargs)

        return SoupTag(result)

    def try_get(self, key: str, default: str | list[str] | None = None):
        return self.tag.get(key, default)

    def get(self, key: str, default: str | list[str] | None = None):
        result = self.try_get(key, default)

        if not isinstance(result, str):
            raise AttributeSearchError(self.tag, key)

        return result

    def get_list(self, key: str, default: str | list[str] | None = None) -> list[str]:
        result = self.tag.get(key, default)

        if not isinstance(result, list):
            raise AttributeSearchError(self.tag, key)

        return result

    def encode_contents(self):
        # TODO: Error handling?
        return self.tag.encode_contents()

    @property
    def string(self):
        return "".join(str(v) for v in self.tag.contents)

    @property
    def contents(self):
        if not self.tag.contents:
            raise PropertyError(self.tag, "contents")

        return self.tag.contents

    @property
    def tags(self):
        tags = [SoupTag(e) for e in self.contents if isinstance(e, bs4.element.Tag)]

        if not tags:
            raise PropertyError

        return tags

    @property
    def parents(self):
        return self.tag.parents

    @property
    def next_sibling(self):
        if not isinstance(self.tag.next_sibling, bs4.element.Tag):
            raise ValueError

        return SoupTag(self.tag.next_sibling)

    @property
    def next_siblings(self):
        return self.tag.next_siblings

    @property
    def previous_sibling(self):
        if not isinstance(self.tag.previous_sibling, bs4.element.Tag):
            raise ValueError

        return SoupTag(self.tag.previous_sibling)

    @property
    def previous_siblings(self):
        return self.tag.previous_siblings
