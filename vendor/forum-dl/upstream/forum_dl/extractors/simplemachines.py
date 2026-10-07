# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from urllib.parse import urljoin
import dateparser
import re

from .common import normalize_url, regex_match, regex_search
from .common import HtmlExtractor, ExtractorOptions, Board, Thread, Post, PageState
from ..session import Session
from ..soup import Soup, SoupTag

if TYPE_CHECKING:
    from requests import Response


class SimplemachinesExtractor(HtmlExtractor):
    tests = [
        {
            "url": "https://simplemachines.org/community",
            "test_base_url": "https://www.simplemachines.org/community/",
            "test_boards": {
                ("2",): {
                    "title": "Simple Machines",
                },
                ("2", "1"): {
                    "title": "News and Updates",
                },
                ("2", "244"): {
                    "title": "Organizational News and Updates",
                },
                ("3",): {
                    "title": "SMF Support",
                },
                ("3", "254"): {
                    "title": "SMF 2.1.x Support",
                },
                ("3", "254", "255"): {
                    "title": "PostgreSQL Support",
                },
                ("3", "147"): {
                    "title": "SMF 2.0.x Support",
                },
                ("3", "147", "222"): {
                    "title": "PostgreSQL and SQLite Support",
                },
                ("3", "9"): {
                    "title": "SMF 1.1.x Support",
                },
                ("3", "12"): {
                    "title": "Language Specific Support",
                },
                ("3", "20"): {
                    "title": "Converting to SMF",
                },
                ("3", "20", "132"): {
                    "title": "IPB",
                },
                ("3", "20", "11"): {
                    "title": "MyBB",
                },
                ("3", "20", "133"): {
                    "title": "phpBB",
                },
                ("3", "20", "134"): {
                    "title": "vBulletin",
                },
                ("3", "20", "135"): {
                    "title": "YaBB/YaBB SE",
                },
                ("18",): {
                    "title": "Customizing SMF",
                },
                ("18", "60"): {
                    "title": "SMF Coding Discussion",
                },
                ("18", "33"): {
                    "title": "Bridges and Integrations",
                },
                ("18", "59"): {
                    "title": "Modifications and Packages",
                },
                ("18", "59", "79"): {
                    "title": "Mod Requests",
                },
                ("18", "34"): {
                    "title": "Graphics and Templates",
                },
                ("18", "34", "106"): {
                    "title": "Theme Site Themes",
                },
                ("18", "34", "178"): {
                    "title": "Theme Previews",
                },
                ("18", "72"): {
                    "title": "Tips and Tricks",
                },
                ("18", "72", "115"): {
                    "title": "Now Available",
                },
                ("18", "116"): {
                    "title": "Building Your Community and other Forum Advice",
                },
                ("15",): {
                    "title": "SMF Development",
                },
                ("15", "3"): {
                    "title": "Feature Requests",
                },
                ("15", "3", "38"): {
                    "title": "Applied or Declined Requests",
                },
                ("15", "3", "228"): {
                    "title": "Next SMF Discussion",
                },
                ("15", "137"): {
                    "title": "Bug Reports",
                },
                ("15", "137", "37"): {
                    "title": "Fixed or Bogus Bugs",
                },
                ("15", "137", "197"): {
                    "title": "Bugtracker (Github)",
                },
                ("4",): {
                    "title": "General Community",
                },
                ("4", "19"): {
                    "title": "Site Comments, Issues and Concerns",
                },
                ("4", "8"): {
                    "title": "Scripting Help",
                },
                ("4", "7"): {
                    "title": "Test Board",
                },
                ("16",): {
                    "title": "Simple Machines Blogs",
                },
                ("16", "128"): {
                    "title": "SMF Team Blog",
                },
                ("16", "129"): {
                    "title": "Developers' Blog",
                },
                ("5",): {
                    "title": "Archived Boards and Threads...",
                },
                ("5", "136"): {
                    "title": "Archived Boards",
                },
                ("5", "136", "2"): {
                    "title": "SMF Feedback and Discussion",
                },
                ("5", "136", "41"): {
                    "title": "Parham's PHP Tutorials",
                },
                ("5", "136", "96"): {
                    "title": "Classic Themes",
                },
                ("5", "136", "144"): {
                    "title": "MotM Travel Blog",
                },
                ("5", "136", "77"): {
                    "title": "Mambo Bridge Support",
                },
                ("5", "136", "138"): {
                    "title": "Joomla Bridge Support",
                },
                ("5", "136", "10"): {
                    "title": "Install and Upgrade Help",
                },
            },
        },
        {
            "url": "https://www.simplemachines.org/community/index.php?board=255.0",
            "test_base_url": "https://www.simplemachines.org/community/",
            "test_boards": {
                ("3", "254", "255"): {
                    "title": "PostgreSQL Support",
                },
                ("3", "20", "134"): {
                    "title": "vBulletin",
                },
                ("4", "19"): {
                    "title": "Site Comments, Issues and Concerns",
                },
            },
        },
        {
            "url": "https://www.simplemachines.org/community/index.php?topic=573.0",
            "test_base_url": "https://www.simplemachines.org/community/",
            "test_contents_hash": "daaf0300248ec6a1891aa1498c6637a89769dd7e",
            "test_item_count": 6,
        },
        {
            "url": "https://www.simplemachines.org/community/index.php?topic=197.0",
            "test_base_url": "https://www.simplemachines.org/community/",
            "test_contents_hash": "cd53463ffb3965590f925807902b6962893a1d5a",
            "test_item_count": 50,
        },
        {
            "url": "https://www.eevblog.com/forum/cooking/",
            "test_base_url": "https://www.eevblog.com/forum/",
            "test_min_item_count": 150,
        },
        {
            "url": "https://www.eevblog.com/forum/eda/best-sub-$2k-pcb-design-software/",
            "test_base_url": "https://www.eevblog.com/forum/",
            # EEVBlog forum uses a PHPSESSID query for tracking, which makes the hash unpredictable.
            # So, we don't test the hash.
            # "test_contents_hash": "f9288cedb415d05e70887e658234a3c0976990c6",
            "test_item_count": 69,
        },
        {
            "url": "http://www.bay12forums.com/smf/index.php?board=10.0",
            "test_base_url": "http://www.bay12forums.com/smf/",
            "test_min_item_count": 150,
        },
        {
            "url": "http://www.bay12forums.com/smf/index.php?topic=406.0",
            "test_base_url": "http://www.bay12forums.com/smf/",
            "test_item_count": 31,
            "test_contents_hash": "4e2c2d065d83c23592379ef97c6d48dbea4f9f4f",
        },
    ]

    _board_item_css = 'span[id^="msg_"]'
    _thread_item_css = "div.post_wrapper, :has(> .postarea)"
    _board_next_page_css = 'a.nav_page:has(span.next_page), a.navPages:-soup-contains("Next"), strong + a.navPages'
    _thread_next_page_css = 'a.nav_page:has(span.next_page), a.navPages:-soup-contains("Next"), strong + a.navPages'

    _category_id_regex = re.compile(r"^c(\d+)$")
    _board_id_regex = re.compile(r"^b(\d+)$")
    _div_id_regex = re.compile(r"^msg_(\d+)$")
    _span_id_regex = re.compile(r"^msg_(\d+)$")
    _subject_id_regex = re.compile(r"^subject_(\d+)$")

    @staticmethod
    def _detect(session: Session, url: str, options: ExtractorOptions):
        response = session.try_get(url, should_cache=True, should_retry=False)
        soup = Soup(response.content)

        link = soup.find("link", attrs={"rel": "contents"})
        base_url = normalize_url(link.get("href"))

        simplemachines_anchor = soup.find(
            "a",
            attrs={
                "href": re.compile(r"https?://www.simplemachines.org"),
                "title": "Simple Machines",
            },
        )

        if simplemachines_anchor:
            return SimplemachinesExtractor(session, base_url, options)

    def _fetch_top_boards(self):
        self._are_subboards_fetched[self.root.path] = True

        response = self._session.get(self.base_url, should_cache=True)
        soup = Soup(response.content)

        category_anchors = soup.find_all("a", id=self._category_id_regex)
        for category_anchor in category_anchors:
            category_id = regex_match(
                self._category_id_regex, category_anchor.get("id")
            ).group(1)
            category_title = str(category_anchor.next_sibling).strip()

            self._set_board(
                path=(category_id,),
                url=urljoin(response.url, f"index.php#c{category_id}"),
                origin=response.url,
                data={},
                title=category_title,
                are_subboards_fetched=True,
            )

            for parent in category_anchor.parents:
                board_anchors = parent.find_all("a", id=self._board_id_regex)

                if not board_anchors:
                    board_anchors = parent.find_all(
                        "a", attrs={"name": self._board_id_regex}
                    )

                if board_anchors:
                    for board_anchor in board_anchors:
                        if board_anchor.get("id"):
                            board_id = regex_match(
                                self._board_id_regex, board_anchor.get("id")
                            ).group(1)
                        else:
                            board_id = regex_match(
                                self._board_id_regex, board_anchor.get("name")
                            ).group(1)

                        self._set_board(
                            path=(category_id, board_id),
                            url=board_anchor.get("href"),
                            origin=response.url,
                            data={},
                            title=str(board_anchor.string).strip(),
                            are_subboards_fetched=True,
                        )
                    break

    def _do_fetch_subboards(self, board: Board):
        if not board.url:
            return

        # Don't fetch top boards.
        if len(board.path) <= 1:
            return

        response = self._session.get(board.url, should_cache=True)
        soup = Soup(response.content)

        subboard_anchors = soup.find_all("a", attrs={"id": self._board_id_regex})

        for subboard_anchor in subboard_anchors:
            subboard_id = regex_match(
                self._board_id_regex, subboard_anchor.get("id")
            ).group(1)
            self._set_board(
                path=board.path + (subboard_id,),
                url=subboard_anchor.get("href"),
                origin=response.url,
                data={},
                title=str(subboard_anchor.string).strip(),
                are_subboards_fetched=True,
            )

    def _resolve_url(self, url: str):
        return normalize_url(
            self._session.get(url, should_cache=True).url,
            append_slash=True,
            keep_queries=["board", "topic"],
        )

    def _get_node_from_url(self, url: str):
        response = self._session.get(url, should_cache=True)
        soup = Soup(response.content)

        breadcrumbs = soup.try_find(class_="navigate_section")
        if not breadcrumbs:
            breadcrumbs = soup.find(class_="linktree")

        breadcrumb_lis = breadcrumbs.find_all("li")
        breadcrumb_as = [li.find("a") for li in breadcrumb_lis]

        # Thread.
        if soup.try_find("div", id="forumposts"):
            breadcrumb_urls = [a.get("href") for a in breadcrumb_as]
            board = self.find_board_from_urls(tuple(breadcrumb_urls[1:-1]))

            topic_input = soup.find("input", attrs={"name": "topic"})
            thread_id = topic_input.get("value")
            title_title = soup.find("title")

            return Thread(
                path=board.path + (thread_id,),
                url=url,
                origin=response.url,
                data={},
                title=str(title_title.string),
            )

        # Board.
        else:
            self._fetch_lower_boards(self.root)

            board_href = self._resolve_url(breadcrumb_as[-1].get("href"))

            for cur_board in self._boards:
                if cur_board.url == board_href:
                    return cur_board

        raise ValueError

    def _fetch_lazy_subboard(self, board: Board, subboard_id: str):
        pass

    def _fetch_lazy_subboards(self, board: Board):
        yield from ()

    def _extract_board_page_thread(
        self, board: Board, state: PageState, response: Response, tag: SoupTag
    ):
        thread_id = regex_match(self._span_id_regex, tag.get("id")).group(1)
        msg_anchor = tag.tags[0]

        return Thread(
            path=board.path + (thread_id,),
            url=msg_anchor.get("href"),
            origin=response.url,
            data={},
            title=str(msg_anchor.string),
        )

    def _extract_thread_page_post(
        self, thread: Thread, state: PageState, response: Response, tag: SoupTag
    ):
        msg_div = tag.find("div", id=self._div_id_regex)
        subject_tag = tag.find({"h5", "div"}, id=self._subject_id_regex)

        time_tag = subject_tag.find_next({"a", "div"}, class_="smalltext")

        # This is ugly, but it's the best I can do for now.
        date = regex_search(
            re.compile(
                r"(January|February|March|April|May|June|July|August|September|October|November|December|Yesterday|Today) [a-zA-Z0-9,: ]+"
            ),
            time_tag.tag.get_text(),  # Get rid of HTML tags.
        ).group(0)

        poster_div = tag.find("div", class_="poster")
        poster_h4 = poster_div.find("h4")

        if poster_anchor := poster_h4.try_find("a"):
            author = poster_anchor.string
        else:
            author = poster_h4.string.strip()

        return Post(
            path=thread.path,
            subpath=(regex_match(self._div_id_regex, msg_div.get("id")).group(1),),
            url=subject_tag.find("a").get("href"),
            origin=response.url,
            data={},
            author=author,
            creation_time=dateparser.parse(date),
            content="".join(str(v) for v in msg_div.contents).strip(),
        )
