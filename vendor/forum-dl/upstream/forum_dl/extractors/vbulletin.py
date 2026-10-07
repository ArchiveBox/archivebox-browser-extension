# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from urllib.parse import urljoin
import re

from .common import regex_match
from .common import HtmlExtractor, ExtractorOptions, Board, Thread, Post, PageState
from ..session import Session
from ..soup import Soup, SoupTag

if TYPE_CHECKING:
    from requests import Response


class VbulletinExtractor(HtmlExtractor):
    tests = [
        {
            "url": "https://forum.vbulletin.com",
            "test_base_url": "https://forum.vbulletin.com/",
            "test_boards": {
                ("14",): {
                    "title": "vBulletin Announcements",
                },
                ("14", "28"): {
                    "title": "vBulletin Announcements",
                },
                ("18",): {
                    "title": "vBulletin Sales and Feedback",
                },
                ("18", "40"): {
                    "title": "vBulletin Pre-sales Questions",
                },
                ("18", "29"): {
                    "title": "Site Feedback",
                },
                ("24",): {
                    "title": "vBulletin 5 Connect",
                },
                ("24", "72"): {
                    "title": "vBulletin 5 Connect Feedback",
                },
                ("24", "111"): {
                    "title": "Support Issues & Questions",
                },
                ("24", "111", "114"): {
                    "title": "vBulletin 5 Tutorials",
                },
                ("24", "70"): {
                    "title": "vBulletin 5 Suggestions",
                },
                ("24", "67"): {
                    "title": "vBulletin 5 Installs & Upgrades",
                },
                ("4014354",): {
                    "title": "vBCloud",
                },
                ("4014354", "4014355"): {
                    "title": "Account Management",
                },
                ("4014354", "4017486"): {
                    "title": "vB Cloud Support & Troubleshooting.",
                },
                ("4136723",): {
                    "title": "International Support",
                },
                ("4136723", "3954329"): {
                    "title": "Deutschsprachiger Support",
                },
                ("4136723", "3954329", "3967454"): {
                    "title": "vBulletin 5 - Fragen und Probleme",
                },
                ("4136723", "3954329", "3954332"): {
                    "title": "vBulletin 5 - Installation & Upgrade",
                },
                ("4136723", "3954329", "3954333"): {
                    "title": "vBulletin 5 - Tipps, Tricks & häufige Fragen",
                },
                ("4136723", "3954329", "3954334"): {
                    "title": "vBulletin 5 - Handbuch",
                },
                ("4136723", "4001685"): {
                    "title": "Assistance francophone",
                },
                ("4136723", "4055583"): {
                    "title": "Soporte de Español",
                },
                ("3955117",): {
                    "title": "vBulletin Mobile",
                },
                ("3955117", "62"): {
                    "title": "vBulletin Mobile Suite",
                },
                ("21",): {
                    "title": "vBulletin 4",
                },
                ("21", "55"): {
                    "title": "vB4 Support & Troubleshooting",
                },
                ("21", "55", "101"): {
                    "title": "vBulletin 4 Quick Tips and Customizations",
                },
                ("21", "54"): {
                    "title": "vBulletin 4 Installations and Upgrades",
                },
                ("20",): {
                    "title": "vBulletin 3.8",
                },
                ("20", "47"): {
                    "title": "vBulletin 3.8 Support & Troubleshooting",
                },
                ("20", "47", "97"): {
                    "title": "vBulletin Quick Tips and Customizations",
                },
                ("20", "48"): {
                    "title": "vBulletin 3.8 Installation and Upgrades",
                },
                ("13",): {
                    "title": "Customizing vBulletin",
                },
                ("13", "42"): {
                    "title": "vBulletin Languages & Phrases",
                },
                ("13", "42", "105"): {
                    "title": "vBulletin Mobile Languages",
                },
                ("13", "31"): {
                    "title": "vBulletin Templates, Graphics & Styles",
                },
                ("13", "45"): {
                    "title": "vBulletin Downloads",
                },
                ("13", "45", "91"): {
                    "title": "vBulletin Style Packs",
                },
                ("13", "45", "92"): {
                    "title": "vBulletin Language Packs",
                },
                ("13", "45", "93"): {
                    "title": "vBulletin Graphics and Other Resources",
                },
                ("12",): {
                    "title": "General",
                },
                ("12", "79"): {
                    "title": "vBulletin Showcase",
                },
                ("12", "32"): {
                    "title": "vBulletin Hosting Options",
                },
                ("12", "33"): {
                    "title": "PHP & HTML Questions",
                },
                ("12", "30"): {
                    "title": "Chit Chat",
                },
                ("19",): {
                    "title": "vBulletin Legacy Versions & Products",
                },
                ("19", "73"): {
                    "title": "Legacy vBulletin Versions",
                },
                ("19", "73", "100"): {
                    "title": "vBulletin 3.7 Questions, Problems and Troubleshooting",
                },
                ("19", "73", "96"): {
                    "title": "vBulletin 3.6 Questions, Problems and Troubleshooting",
                },
                ("19", "73", "94"): {
                    "title": "vBulletin 3.5 'How Do I' Questions and Troubleshooting",
                },
                ("19", "73", "86"): {
                    "title": "vBulletin 3.0 How Do I and Troubleshooting Forum",
                },
                ("19", "73", "85"): {
                    "title": "vBulletin 2 'How Do I' and Troubleshooting",
                },
                ("19", "73", "83"): {
                    "title": "vBulletin 1.1.x Archives",
                },
                ("19", "73", "84"): {
                    "title": "vBulletin Lite Archives",
                },
                ("19", "74"): {
                    "title": "Other Legacy Products",
                },
                ("19", "74", "99"): {
                    "title": "Pre-4.X Blog Archives",
                },
                ("19", "74", "98"): {
                    "title": "Project Tools Archives",
                },
                ("19", "74", "64"): {
                    "title": "vBulletin Facebook App",
                },
                ("19", "74", "44"): {
                    "title": "vBulletin Impex Import System",
                },
            },
        },
        {
            "url": "https://forum.vbulletin.com/forum/vbulletin-5-connect/vbulletin-5-connect-questions-problems-troubleshooting/vbulletin-5-tutorials/4131238-how-to-put-ads-after-first-post-in-thread-on-vb5-without-using-plugins",
            "test_base_url": "https://forum.vbulletin.com/",
            "test_contents_hash": "f369e03f9625e78acb0b070875c4f8ff83b62833",
            "test_item_count": 66,
        },
        {
            "url": "https://forum.vbulletin.com/forum/vbulletin-5-connect/vbulletin-5-connect-feedback/417300-cms-and-vbulletin-5",
            "test_base_url": "https://forum.vbulletin.com/",
            "test_contents_hash": "e358347798df127d65e4f96d9c95011063912ff2",
            "test_item_count": 42,
        },
    ]

    _board_item_css = "tr.topic-item"
    _board_next_page_css = "a.right-arrow[href]"
    _thread_item_css = "li.b-post"
    _thread_next_page_css = "a.right-arrow[href]"

    _forum_id_regex = re.compile(r"^forum(\d+)$")

    @staticmethod
    def _detect(session: Session, url: str, options: ExtractorOptions):
        response = session.try_get(url, should_cache=True, should_retry=False)
        soup = Soup(response.content)

        generator_meta = soup.find("meta", attrs={"name": "generator"})
        if not generator_meta.get("content").startswith("vBulletin"):
            return None

        base = soup.find("base")
        return VbulletinExtractor(session, base.get("href"), options)

    def _fetch_top_boards(self):
        self._are_subboards_fetched[self.root.path] = True

        response = self._session.get(self.base_url, should_cache=True)
        soup = Soup(response.content)

        trs = soup.find_all("tr", class_=["category-header", "forum-item"])
        category_id = ""

        for tr in trs:
            if "category-header" in tr.get_list("class"):
                category_id = regex_match(self._forum_id_regex, tr.get("id")).group(1)

                category_anchor = tr.find("a", class_="category")
                title = category_anchor.string

                self._set_board(
                    path=(category_id,),
                    url=category_anchor.get("href"),
                    origin=response.url,
                    data={},
                    title=title,
                    are_subboards_fetched=True,
                )
            else:
                board_id = regex_match(self._forum_id_regex, tr.get("id")).group(1)

                board_anchor = tr.find("a", class_="forum-title")
                title = board_anchor.string

                self._set_board(
                    path=(category_id, board_id),
                    url=board_anchor.get("href"),
                    origin=response.url,
                    data={},
                    title=title,
                )

    def _do_fetch_subboards(self, board: Board):
        # Don't fetch top boards.
        if len(board.path) <= 1:
            return

        response = self._session.get(board.url, should_cache=True)
        soup = Soup(response.content)

        trs = soup.find_all("tr", class_="forum-item")
        for tr in trs:
            subboard_id = regex_match(self._forum_id_regex, tr.get("id")).group(1)

            subboard_anchor = tr.find("a", class_="forum-title")
            self._set_board(
                path=board.path + (subboard_id,),
                url=subboard_anchor.get("href"),
                origin=response.url,
                data={},
                title=subboard_anchor.string.strip(),
            )

    def _get_node_from_url(self, url: str):
        response = self._session.get(url, should_cache=True)
        soup = Soup(response.content)

        breadcrumb_anchors = soup.find_all("a", class_="crumb-link")

        if len(breadcrumb_anchors) <= 1:
            return self.root

        # Thread.
        if soup.try_find("h2", class_="b-post__title"):
            breadcrumb_urls = [
                self._resolve_url(anchor.get("href")) for anchor in breadcrumb_anchors
            ]
            board = self.find_board_from_urls(tuple(breadcrumb_urls[2:]))

            thread_id = soup.find("input", attrs={"name": "nodeid"}).get("value")
            title_h1 = soup.find("h1", class_="main-title")

            return Thread(
                path=board.path + (thread_id,),
                url=urljoin(self.base_url, url),
                origin=response.url,
                data={},
                title=title_h1.string,
            )
        # Board.
        else:
            self._fetch_lower_boards(self.root)

            board_title = breadcrumb_anchors[-1].string

            for cur_board in self._boards:
                if cur_board.title == board_title:
                    return cur_board

        raise ValueError

    def _fetch_lazy_subboards(self, board: Board):
        yield from ()

    def _extract_board_page_thread(
        self, board: Board, state: PageState, response: Response, tag: SoupTag
    ):
        thread_id = tag.get("data-node-id")
        thread_anchor = tag.find("a", class_="topic-title")

        return Thread(
            path=board.path + (thread_id,),
            url=thread_anchor.get("href"),
            origin=response.url,
            data={},
            title=thread_anchor.string,
        )

    def _extract_thread_page_post(
        self, thread: Thread, state: PageState, response: Response, tag: SoupTag
    ):
        # No support for comments for now.
        if "b-comment" in tag.get_list("class"):
            return

        url_anchor = tag.find("a", class_="b-post__count")
        content_div = tag.find("div", class_="js-post__content-text")
        author_anchor = tag.find("div", class_="author").find("a")
        time_tag = tag.find("time", attrs={"itemprop": "dateCreated"})
        post_id = tag.get("data-node-id")

        return Post(
            path=thread.path,
            subpath=(post_id,),
            url=url_anchor.get("href"),
            origin=response.url,
            data={},
            author=author_anchor.string,
            creation_time=time_tag.get("datetime"),
            content="".join(str(v) for v in content_div.contents).strip(),
        )
