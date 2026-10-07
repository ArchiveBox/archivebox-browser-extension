# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from pathlib import PurePosixPath
from urllib.parse import urljoin, urlparse
import dateparser
import re

from .common import normalize_url
from .common import Extractor, ExtractorOptions, Board, Thread, Post, PageState
from ..session import Session
from ..soup import Soup


class HyperkittyExtractor(Extractor):
    tests = [
        {
            "url": "https://mail.python.org/archives/",
            "board_count": 5,
            "test_base_url": "https://mail.python.org/archives/",
            "test_boards": {
                ("numpy-discussion@python.org",): {
                    "title": "NumPy-Discussion",
                    # "content": "Discussion of Numerical Python",
                },
                ("scipy-dev@python.org",): {
                    "title": "SciPy-Dev",
                    # "content": "SciPy Developers List",
                },
                ("charlottepython@python.org",): {
                    "title": "CharlottePython",
                    # "content": "List for the Python user group in Charlotte, North Carolina.",
                },
                ("python-dev@python.org",): {
                    "title": "Python-Dev",
                    # "content": "Python core developers",
                },
                ("python-ideas@python.org",): {
                    "title": "Python-ideas",
                    # "content": "Discussions of speculative Python language ideas",
                },
            },
        },
        {
            "url": "https://mail.python.org/archives/list/mm3_test@python.org",
            "test_base_url": "https://mail.python.org/archives/",
            "test_titles_hash": "ecbc317707691b486caff90204ab15230fcc11a7",
            "test_item_count": 21,
        },
        {
            "url": "https://mail.python.org/archives/list/mm3_test@python.org/thread/NGFDAQJOJQDRPOU4WLRZEB55KAXPJWGN/",
            "test_base_url": "https://mail.python.org/archives/",
            "test_contents_hash": "a24cd22d0d460688f42b2bfa40805616075f22c0",
            "test_item_count": 5,
        },
        {
            "url": "https://mail.python.org/archives/list/mm3_test@python.org/thread/JNBVEQQBAI67DBT4HFXI3PO4APTKGQZO/",
            "test_base_url": "https://mail.python.org/archives/",
            "test_contents_hash": "ac64c15360e035c1bf5e4778869244ce81333844",
            "test_item_count": 2,
        },
        {
            "url": "https://mail.python.org/archives/list/mm3_test@python.org/thread/IWRIV5ULS4BHY43TRYCHE2TXJB7KZQ7U/",
            "test_base_url": "https://mail.python.org/archives/",
            "test_contents_hash": "887446d5b46aed3076cae2115a0ba408ba8133e0",
            "test_item_count": 1,
        },
    ]

    _reply_level_regex = re.compile(r"reply-level-(\d+)")

    @staticmethod
    def _detect(session: Session, url: str, options: ExtractorOptions):
        response = session.try_get(
            normalize_url(url, append_slash=False),
            should_cache=True,
            should_retry=False,
        )
        soup = Soup(response.content)

        if extractor := HyperkittyExtractor.detect_postorius(
            session, url, soup, options
        ):
            return extractor

        if extractor := HyperkittyExtractor.detect_hyperkitty(
            session, url, soup, options
        ):
            return extractor

    @staticmethod
    def detect_postorius(
        session: Session, url: str, soup: Soup, options: ExtractorOptions
    ):
        if not (footer := soup.try_find("footer")):
            return None

        if not footer.try_find("a", string="Postorius Documentation"):
            return False

        if not (nav_link_anchors := soup.find_all("a", class_="nav-link")):
            return None

        base_url = normalize_url(urljoin(url, nav_link_anchors[1].get("href")))
        return HyperkittyExtractor(session, base_url, options)

    @staticmethod
    def detect_hyperkitty(
        session: Session, url: str, soup: Soup, options: ExtractorOptions
    ):
        if not (footer := soup.try_find("footer")):
            return None

        if not footer.try_find("a", string="HyperKitty"):
            return False

        if not (navbar_brand_anchor := soup.try_find("a", class_="navbar-brand")):
            return None

        base_url = normalize_url(urljoin(url, navbar_brand_anchor.get("href")))
        return HyperkittyExtractor(session, base_url, options)

    def _fetch_top_boards(self):
        pass

    def _do_fetch_subboards(self, board: Board):
        pass

    def _get_node_from_url(self, url: str):
        response = self._session.get(url, should_cache=True)
        resolved_url = normalize_url(response.url)

        if resolved_url == self.base_url:
            return self.root

        parsed_url = urlparse(resolved_url)
        path = PurePosixPath(parsed_url.path)

        if len(path.parts) >= 4 and path.parts[-2] == "thread":
            board_id = path.parts[-3]
            thread_id = path.parts[-1]

            soup = Soup(response.content)
            thread_header_div = soup.find("div", class_="thread-header")
            thread_h3 = thread_header_div.find("h3")

            return Thread(
                path=(board_id, thread_id),
                url=resolved_url,
                origin=resolved_url,
                data={},
                title=thread_h3.string,
            )
        elif len(path.parts) >= 2 and path.parts[-2] == "list":
            return self.find_board((path.parts[-1],))

        raise ValueError

    def _fetch_lazy_subboard(self, board: Board, subboard_id: str):
        url = normalize_url(urljoin(self.base_url, f"list/{subboard_id}"))
        response = self._session.get(url, should_cache=True)
        soup = Soup(response.content)

        title = ""

        if title_section := soup.try_find("section", id="title"):
            if h1 := title_section.try_find("h1"):
                title = h1.string.strip()
            elif h2 := title_section.try_find("h2"):
                title = h2.string.strip()

        return self._set_board(
            path=(subboard_id,),
            url=url,
            origin=response.url,
            data={},
            # data={"description": description},
            title=title,
        )

    def _fetch_lazy_subboards(self, board: Board):
        href: str = ""
        url: str = self.base_url

        while href != "#":
            response = self._session.get(url, should_cache=True)
            soup = Soup(response.content)
            list_anchors = soup.find_all("a", class_="list-name")

            for list_anchor in list_anchors:
                list_id = PurePosixPath(urlparse(list_anchor.get("href")).path).parts[
                    -1
                ]
                yield self._fetch_lazy_subboard(board, list_id)

            page_link_anchors = soup.find_all("a", class_="page-link")
            next_page_anchor = page_link_anchors[-1]

            href = next_page_anchor.get("href")
            url = urljoin(self.base_url, href)

    def _fetch_board_page_threads(self, board: Board, state: PageState):
        match = re.match(r"^.*latest\?page=(\d+)$", state.url)

        if match:
            cur_page = int(match.group(1))
        else:
            cur_page = 1

        if board == self.root:
            return None

        if state.url == board.url:
            state.url = urljoin(state.url, "latest")

        origin = state.url

        response = self._session.get(origin)
        soup = Soup(response.content)

        thread_anchors = soup.find_all("a", class_="thread-title")

        if not thread_anchors:
            thread_spans = soup.find_all("span", class_="thread-title")
            thread_anchors = [thread_span.find("a") for thread_span in thread_spans]

        for thread_anchor in thread_anchors:
            yield Thread(
                path=board.path + (thread_anchor.get("name"),),
                url=urljoin(state.url, thread_anchor.get("href")),
                origin=origin,
                data={},
                title=str(thread_anchor.tag.contents[-1]).strip(),
            )

        if page_link_tags := soup.find_all(class_="page-link"):
            last_page = int(page_link_tags[-2].string)

            if cur_page < last_page:
                return PageState(
                    url=urljoin(state.url, f"latest?page={cur_page + 1}"),
                    page=state.page + 1,
                )

    def _fetch_thread_page_posts(self, thread: Thread, state: PageState):
        origin = state.url
        response = self._session.get(origin)

        if state.url == thread.url:
            soup = Soup(response.content)

            email_author_div = soup.find("div", class_="email-author")
            email_time_div = soup.find("div", class_="time")
            email_time_span = email_time_div.find("span")
            time = email_time_span.get("title").removeprefix("Sender's time: ")

            email_body_div = soup.find("div", class_="email-body")

            yield Post(
                path=thread.path,
                subpath=(),
                url=urljoin(
                    origin,
                    soup.find("div", class_="messagelink").find("a").get("href"),
                ),
                origin=origin,
                data={},
                author=str(email_author_div.find("a").string),
                creation_time=dateparser.parse(time),
                content="".join(str(v) for v in email_body_div.contents),
            )

            return PageState(
                url=urljoin(state.url, "replies?sort=thread"), page=state.page + 1
            )

        json = response.json()

        replies_html = json["replies_html"]
        soup = Soup(replies_html)

        reply_level_divs = soup.find_all("div", class_=["even", "odd"])
        prev_reply_level = 0
        subpath: list[str] = []

        for reply_level_div in reply_level_divs:
            for klass in reply_level_div.get_list("class"):
                if match := self._reply_level_regex.match(klass):
                    cur_reply_level = int(match.group(1))
                    break
            else:
                cur_reply_level = 0

            email_header_div = reply_level_div.find("div", class_="email-header")
            post_id = email_header_div.get("id")

            if cur_reply_level > prev_reply_level:
                subpath.append(post_id)
            else:
                subpath[-(prev_reply_level - cur_reply_level - 1) :] = [post_id]

            email_author_div = reply_level_div.find("div", class_="email-author")

            email_time_div = soup.find("div", class_="time")
            email_time_span = email_time_div.find("span")
            time = email_time_span.get("title").removeprefix("Sender's time: ")

            email_body_div = reply_level_div.find("div", class_="email-body")

            yield Post(
                path=thread.path,
                subpath=tuple(subpath),
                url=urljoin(
                    origin, soup.find("div", class_="messagelink").find("a").get("href")
                ),
                origin=origin,
                data={},
                author=str(email_author_div.find("a").string),
                creation_time=dateparser.parse(time),
                content="".join(str(v) for v in email_body_div.contents),
            )

            prev_reply_level = cur_reply_level

        if json["more_pending"]:
            next_offset = json["next_offset"]
            return PageState(
                url=urljoin(state.url, f"replies?sort=thread&offset={next_offset}"),
                page=state.page + 1,
            )
