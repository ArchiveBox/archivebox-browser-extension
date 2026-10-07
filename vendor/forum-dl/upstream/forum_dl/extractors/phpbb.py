# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from pathlib import PurePosixPath
from urllib.parse import urljoin, urlparse, parse_qs
import dateparser
import re

from .common import get_relative_url, normalize_url, regex_match
from .common import HtmlExtractor, ExtractorOptions, Board, Thread, Post, PageState
from ..session import Session
from ..soup import Soup, SoupTag

if TYPE_CHECKING:
    from requests import Response


class PhpbbExtractor(HtmlExtractor):
    tests = [
        {
            "url": "https://phpbb.com/community",
            "test_base_url": "https://www.phpbb.com/community/",
            "test_boards": {
                ("47",): {
                    "title": "General",
                },
                ("551",): {
                    "title": "Support Forums",
                },
                ("451",): {
                    "title": "Extensions Forums",
                },
                ("471",): {
                    "title": "Styles Forums",
                },
                ("52",): {
                    "title": "Non-support Specific",
                },
                ("48",): {
                    "title": "phpBB Archives",
                },
            },
        },
        {
            "url": "https://phpbb.com/community/viewforum.php?f=556",
            "item_count": 0,
            "test_base_url": "https://www.phpbb.com/community/",
            "test_boards": {
                ("551", "556", "561"): {
                    "title": "[3.2.x] Convertors",
                },
                ("551", "556", "566"): {
                    "title": "[3.2.x] Translations",
                },
            },
        },
        {
            "url": "https://www.phpbb.com/community/viewtopic.php?t=2377611",
            "test_base_url": "https://www.phpbb.com/community/",
            "test_contents_hash": "d98797411be739205db624165f24fc248c93157b",
            "test_item_count": 7,
        },
        {
            "url": "https://www.phpbb.com/community/viewtopic.php?t=2534156",
            "test_base_url": "https://www.phpbb.com/community/",
            "test_contents_hash": "d88e2da2e01e843f71c70f62a874542a416efc5d",
            "test_item_count": 1,
        },
        {
            "url": "https://wikipediocracy.com/forum",
            "test_base_url": "https://wikipediocracy.com/forum/",
            "test_boards": {
                ("11",): {
                    "title": "Public Area",
                },
                ("11", "13"): {
                    "title": "Mission Statement, Terms of Service, and Welcome",
                },
                ("11", "8"): {
                    "title": "Wikipedia and Wikimedia Projects - General Discussion",
                },
                ("11", "8", "14"): {
                    "title": "Governance",
                },
                ("11", "8", "16"): {
                    "title": "Biographies (BLPs) & Privacy",
                },
                ("11", "8", "23"): {
                    "title": "The Money Trail",
                },
                ("11", "8", "17"): {
                    "title": "Jimboland",
                },
                ("11", "8", "42"): {
                    "title": "Sexism",
                },
                ("11", "8", "43"): {
                    "title": "Technology",
                },
                ("11", "8", "25"): {
                    "title": "Blog Posts",
                },
                ("11", "6"): {
                    "title": "News and Media",
                },
                ("11", "21"): {"title": "Web 2.0: The Emperor's New Clothes"},
            },
        },
        {
            "url": "https://wikipediocracy.com/forum/viewtopic.php?f=13&t=7003",
            "test_base_url": "https://wikipediocracy.com/forum/",
            "test_contents_hash": "173a8a4e8558ec8eebe419ecc8274be406054275",
            "test_item_count": 115,
        },
        {
            "url": "https://forum.scssoft.com/",
            "test_base_url": "https://forum.scssoft.com/",
            "test_board_count": 250,
        },
        {
            "url": "https://forum.scssoft.com/viewforum.php?f=137",
            "test_base_url": "https://forum.scssoft.com/",
            "test_boards": {
                ("137", "139"): {
                    "title": "American Truck Simulator",
                },
                ("137", "249"): {
                    "title": "Euro Truck Simulator 2",
                },
                ("137", "152"): {
                    "title": "ETS2 - dashboards at night",
                },
            },
        },
        {
            "url": "https://forum.scssoft.com/viewtopic.php?t=245658",
            "test_base_url": "https://forum.scssoft.com/",
            "test_contents_hash": "5982a8dfb095eb30f1e318342ba63741786c92c6",
            "test_item_count": 21,
        },
        {
            "url": "https://forums.themanaworld.org",
            "test_base_url": "https://forums.themanaworld.org/",
            "test_board_count": 30,
        },
        {
            "url": "https://forums.themanaworld.org/viewforum.php?f=82",
            "test_base_url": "https://forums.themanaworld.org/",
            "test_boards": {
                ("27", "82", "11"): {
                    "title": "Web Development",
                },
                ("27", "82", "63"): {
                    "title": "Tutorials",
                },
            },
        },
        {
            "url": "https://forums.themanaworld.org/viewtopic.php?t=362",
            "test_base_url": "https://forums.themanaworld.org/",
            "test_item_count": 37,
            "test_contents_hash": "25065476c54fdc7a60ee934b630a6b975a4e98dc",
        },
        {
            "url": "https://forum.minetest.net/",
            "test_base_url": "https://forum.minetest.net/",
            "test_board_count": 48,
        },
        {
            "url": "https://forum.minetest.net/",
            "test_base_url": "https://forum.minetest.net/",
            "test_board_count": 48,
        },
        {
            "url": "https://forum.minetest.net/viewforum.php?f=48",
            "test_base_url": "https://forum.minetest.net/",
            "test_boards": {
                ("38", "48", "15"): {
                    "title": "Game Releases",
                },
                ("38", "48", "49"): {
                    "title": "Game Discussion",
                },
                ("38", "48", "50"): {
                    "title": "WIP Games",
                },
                ("38", "48", "51"): {
                    "title": "Old Games",
                },
            },
        },
        {
            "url": "https://forum.minetest.net/viewtopic.php?f=51&t=9066",
            "test_base_url": "https://forum.minetest.net/",
            "test_item_count": 76,
            "test_contents_hash": "f370438d250e2d9b36412b83c4a5c8391f2cc38f",
            # TODO: Test for embeds.
        },
    ]

    _board_item_css = "a.topictitle"
    _board_next_page_css = ".next a"
    _thread_item_css = "div.post"
    _thread_next_page_css = ".next a"

    @staticmethod
    def _detect(session: Session, url: str, options: ExtractorOptions):
        # Check for the existence of "viewforum.php".
        response = session.try_get(
            urljoin(
                normalize_url(url, remove_suffixes=["viewforum.php", "viewtopic.php"]),
                "viewforum.php",
            ),
            should_cache=True,
            should_retry=False,
        )

        # A rather crude way to detect: we look for a <html> tag with "dir" attribute.
        soup = Soup(response.text)
        soup.find("html", attrs={"dir": True})

        return PhpbbExtractor(
            session,
            normalize_url(
                response.url, remove_suffixes=["viewforum.php", "viewtopic.php"]
            ),
            options,
        )

    def _is_viewforum_url(self, url: str):
        parsed_url = urlparse(url)
        path = PurePosixPath(str(parsed_url.path))

        if len(path.parts) != 1:
            try:
                get_relative_url(url, self.base_url)
            except ValueError:
                return False

        if path.parts[-1] != "viewforum.php":
            return False

        parsed_query = parse_qs(parsed_url.query)

        if "f" not in parsed_query:
            return False

        return True

    def _is_viewtopic_url(self, url: str, thread_id: int | None = None):
        parsed_url = urlparse(url)
        path = PurePosixPath(str(parsed_url.path))

        if len(path.parts) != 1:
            try:
                get_relative_url(url, self.base_url)
            except ValueError:
                return False

        if path.parts[-1] != "viewtopic.php":
            return False

        parsed_query = parse_qs(parsed_url.query)

        if "t" not in parsed_query:
            return False

        return True

    def _is_viewtopic_pagination_url(self, url: str, thread_id: int | None = None):
        if not self._is_viewtopic_url(url, thread_id):
            return False

        parsed_url = urlparse(url)
        parsed_query = parse_qs(parsed_url.query)

        if not {"t", "start"} <= parsed_query.keys():
            return False

        return True

    def _fetch_top_boards(self):
        self._are_subboards_fetched[self.root.path] = True

        response = self._session.get(self.base_url, should_cache=True)
        soup = Soup(response.content)

        board_lis = soup.find_all("div", class_="forabg")

        for board_li in board_lis:
            header_li = board_li.find("li", class_="header")
            board_id = None

            if board_anchor := header_li.try_find("a"):
                parsed_href = urlparse(board_anchor.get("href"))
                parsed_query = parse_qs(parsed_href.query)

                try:
                    board_id = parsed_query["f"][0]
                except KeyError:
                    continue

                board_title = board_anchor.string
                board_url = urljoin(self.base_url, f"viewforum.php?f={board_id}")

                self._set_board(
                    path=(board_id,),
                    url=board_url,
                    origin=response.url,
                    data={},
                    title=board_title,
                    are_subboards_fetched=True,
                )

            subboard_anchors = board_li.find_all("a", class_="forumtitle")

            for subboard_anchor in subboard_anchors:
                parsed_href = urlparse(subboard_anchor.get("href"))
                parsed_query = parse_qs(parsed_href.query)

                try:
                    subboard_id = parsed_query["f"][0]
                except KeyError:
                    continue

                subboard_title = subboard_anchor.string
                subboard_url = urljoin(self.base_url, f"viewforum.php?f={subboard_id}")

                self._set_board(
                    path=(board_id, subboard_id) if board_id else (subboard_id,),
                    url=subboard_url,
                    origin=response.url,
                    data={},
                    title=subboard_title,
                )

    def _do_fetch_subboards(self, board: Board):
        if board is self.root:
            return

        response = self._session.get(board.url, should_cache=True)

        try:
            get_relative_url(response.url, self.base_url)
        except ValueError:
            return

        soup = Soup(response.content)

        subboard_anchors = soup.find_all("a", class_="forumtitle")

        for subboard_anchor in subboard_anchors:
            parsed_href = urlparse(subboard_anchor.get("href"))
            parsed_query = parse_qs(parsed_href.query)

            try:
                subboard_id = parsed_query["f"][0]
            except KeyError:
                continue

            subboard_title = subboard_anchor.string
            subboard_url = urljoin(self.base_url, f"viewforum.php?f={subboard_id}")

            self._set_board(
                path=board.path + (subboard_id,),
                url=subboard_url,
                origin=response.url,
                data={},
                title=subboard_title,
                are_subboards_fetched=True,
            )

    def _resolve_url(self, url: str):
        return normalize_url(
            self._session.get(url, should_cache=True).url, keep_queries=["f", "t"]
        )

    def _get_node_from_url(self, url: str):
        response = self._session.get(url, should_cache=True)
        resolved_url = normalize_url(response.url, keep_queries=["f", "t"])

        parsed_url = urlparse(resolved_url)
        parts = PurePosixPath(parsed_url.path).parts

        if parts[-1] == "viewforum.php":
            self._fetch_lower_boards(self.root)

            parsed_query = parse_qs(parsed_url.query)

            if "f" not in parsed_query:
                return self.root

            board_id = parsed_query["f"][0]

            for board in self._boards:
                if board is not self.root and board.path[-1] == board_id:
                    return board

            raise ValueError
        elif parts[-1] == "viewtopic.php":
            topic_id = parse_qs(parsed_url.query)["t"][0]
            soup = Soup(response.content)
            breadcrumbs = soup.find(class_="breadcrumbs")

            breadcrumb_anchors = breadcrumbs.find_all("a", attrs={"itemprop": "item"})

            breadcrumb_urls = [
                self._resolve_url(urljoin(url, anchor.get("href")))
                for anchor in breadcrumb_anchors
            ]
            board = self.find_board_from_urls(tuple(breadcrumb_urls[1:]))

            title_h2 = soup.find("h2", class_="topic-title")
            title = title_h2.find("a").string

            return Thread(
                path=board.path + (topic_id,),
                url=resolved_url,
                origin=resolved_url,
                data={},
                title=title,
            )
        elif normalize_url(resolved_url) == self.base_url:
            return self.root

        raise ValueError

    def _fetch_lazy_subboard(self, board: Board, subboard_id: str):
        pass

    def _fetch_lazy_subboards(self, board: Board):
        yield from ()

    def _extract_board_page_thread(
        self, board: Board, state: PageState, response: Response, tag: SoupTag
    ):
        href = urljoin(self.base_url, tag.get("href"))
        parsed_href = urlparse(href)
        parsed_query = parse_qs(parsed_href.query)
        thread_id = parsed_query["t"][0]

        return Thread(
            path=board.path + (thread_id,),
            url=href,
            origin=response.url,
            data={},
            title=tag.string,
        )

    def _extract_thread_page_post(
        self, thread: Thread, state: PageState, response: Response, tag: SoupTag
    ):
        id_div_regex = re.compile(r"^post_content(\d+)$")
        id_div = tag.find("div", id=id_div_regex)
        content_div = tag.find("div", class_="content")

        author_p = tag.find("p", class_="author")

        username_tag = author_p.find(
            {"a", "span"}, class_={"username", "username-coloured"}
        )

        if time_tag := author_p.try_find("time"):
            creation_time = dateparser.parse(time_tag.get("datetime"))
        else:
            # Date-string begins right after &raquo;.
            date_match = re.search("»(.+)", author_p.tag.get_text(), re.MULTILINE)

            if date_match:
                creation_time = dateparser.parse(date_match.group(1))
            else:
                raise ValueError

        url_h3 = tag.find("h3")
        url_anchor = url_h3.find("a")

        return Post(
            path=thread.path,
            subpath=(regex_match(id_div_regex, id_div.get("id")).group(1),),
            url=urljoin(response.url, url_anchor.get("href")),
            origin=response.url,
            data={},
            author=username_tag.string,
            creation_time=creation_time,
            content=str("".join(str(v) for v in content_div.contents)),
        )
