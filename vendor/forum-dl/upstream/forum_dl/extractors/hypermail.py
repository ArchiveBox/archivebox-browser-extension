# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from pathlib import PurePosixPath
from urllib.parse import urljoin, urlparse, urlunparse
from itertools import islice
import bs4
import re

from .common import normalize_url, regex_match
from .common import Extractor, ExtractorOptions, Board, Thread, Post, PageState
from ..session import Session
from ..soup import Soup


class HypermailPageState(PageState):
    relative_urls: list[str]


class HypermailExtractor(Extractor):
    tests = [
        {
            "url": "https://hypermail-project.org/archive/08/index.html",
            "test_base_url": "https://hypermail-project.org/archive/",
            "test_titles_hash": "83b453b64d8d916717aebda6528f5371d50a3c57",
            "test_item_count": 1155,
        },
        {
            "url": "https://hypermail-project.org/archive/98/0001.html",
            "test_base_url": "https://hypermail-project.org/archive/",
            "test_contents_hash": "798dc3a69b3be638373447ad6f8ccd287297d03a",
            "test_item_count": 15,
        },
    ]

    _page_href_regex = re.compile(r"^(\d+)/index.html$")
    _post_href_regex = re.compile(r"^(\d+).html$")

    @staticmethod
    def _detect(session: Session, url: str, options: ExtractorOptions):
        response = session.try_get(
            normalize_url(url, remove_suffixes=[], append_slash=False),
            should_cache=True,
            should_retry=False,
        )
        soup = Soup(response.content)

        _ = soup.find(
            "meta",
            attrs={"name": "generator", "content": re.compile("^hypermail.*$")},
        )

        header_metas = soup.try_find(
            "meta", attrs={"name": re.compile("^(Author)|(Subject)|(Date)$")}
        )
        title_title = soup.try_find(
            "title",
            string=re.compile(
                "^.*?(by thread)|(by author)|(with attachments)|(by date)$"
            ),
        )

        if header_metas or title_title:
            parsed_url = urlparse(response.url)
            path = PurePosixPath(parsed_url.path)
            base_url = normalize_url(
                str(
                    urlunparse(
                        parsed_url._replace(path=str(PurePosixPath(*path.parts[:-2])))
                    )
                )
            )
            return HypermailExtractor(session, base_url, options)

        return HypermailExtractor(session, response.url, options)

    def _fetch_top_boards(self):
        pass

    def _do_fetch_subboards(self, board: Board):
        pass

    def _get_node_from_url(self, url: str):
        response = self._session.get(url, should_cache=True)
        resolved_url = normalize_url(response.url, append_slash=False)

        if resolved_url == self.base_url:
            return self.root

        parsed_url = urlparse(resolved_url)
        path = PurePosixPath(parsed_url.path)

        if len(path.parts) >= 2 and self._post_href_regex.match(path.parts[-1]):
            thread_id = path.parts[-1].removesuffix(".html")
            return Thread(
                path=(thread_id,),
                url=url,
                origin=resolved_url,
                data={},
                title="",  # TODO.
            )

        return self.root

    def _fetch_lazy_subboard(self, board: Board, subboard_id: str):
        pass

    def _fetch_lazy_subboards(self, board: Board):
        yield from ()

    def _fetch_board_page_threads(self, board: Board, state: PageState):
        if state.url == board.url:
            response = self._session.get(board.url)
            soup = Soup(response.content)

            page_anchors = soup.find_all("a", attrs={"href": self._page_href_regex})
            relative_urls = list(
                reversed([page_anchor.get("href") for page_anchor in page_anchors])
            )

            relative_url = relative_urls.pop()
            return HypermailPageState(
                url=urljoin(self.base_url, relative_url),
                relative_urls=relative_urls,
                page=state.page + 1,
            )

        state = cast(HypermailPageState, state)

        response = self._session.get(state.url)
        soup = Soup(response.content)

        messages_list_div = cast(
            bs4.element.Tag, soup.find("div", class_="messages-list")
        )
        root_ul = cast(bs4.element.Tag, messages_list_div.find("ul"))
        child_uls = root_ul.find_all("ul")

        for child_ul in child_uls:
            if not (
                thread_anchor := child_ul.try_find(
                    "a", attrs={"href": self._post_href_regex}
                )
            ):
                continue

            href = thread_anchor.get("href")
            thread_id = regex_match(self._post_href_regex, href).group(1)
            yield Thread(
                path=(thread_id,),
                url=urljoin(self.base_url, href),
                origin=response.url,
                data={},
                title="",  # TODO.
            )

        if state.relative_urls:
            relative_url = state.relative_urls.pop()
            return HypermailPageState(
                url=urljoin(self.base_url, relative_url),
                page=state.page + 1,
                relative_urls=state.relative_urls,
            )

    def _fetch_thread_page_posts(self, thread: Thread, state: PageState):
        if state.url == thread.url:
            state.url = urljoin(thread.url, ".")

        response = self._session.get(state.url)
        soup = Soup(response.content)

        root_anchor = soup.find("a", attrs={"href": f"{thread.path[-1]}.html"})
        root_pos = len(list(root_anchor.parents))

        href = root_anchor.get("href")
        yield self._fetch_post(state, thread.path, (), urljoin(thread.url, href))

        child_ul = root_anchor.find_next("ul")
        child_anchors = child_ul.find_all("a", attrs={"href": self._post_href_regex})

        prev_depth = 0
        subpath: list[str] = []

        for child_anchor in child_anchors:
            child_pos = len(list(child_anchor.parents))
            cur_depth = (child_pos - root_pos) // 2

            href = child_anchor.get("href")
            post_id = regex_match(self._post_href_regex, href).group(1)

            if cur_depth > prev_depth:
                subpath.append(post_id)
            else:
                subpath[-(prev_depth - cur_depth - 1) :] = [post_id]

            yield self._fetch_post(
                state, thread.path, tuple(subpath), urljoin(state.url, href)
            )

            prev_depth = cur_depth

    def _fetch_post(
        self,
        state: PageState,
        path: tuple[str, ...],
        subpath: tuple[str, ...],
        url: str,
    ):
        response = self._session.get(url)
        soup = Soup(response.content)

        author_meta = soup.find("meta", attrs={"name": "Author"})

        # TODO: We can use the isosent=... comment instead.
        date_meta = soup.find("meta", attrs={"name": "Date"})

        address = soup.find("address")

        return Post(
            path=path,
            subpath=subpath,
            url=url,
            origin=response.url,
            data={},
            author=author_meta.get("content"),
            creation_time=date_meta.get("content"),
            content="".join(str(v) for v in islice(address.next_siblings, 1, None)),
        )
