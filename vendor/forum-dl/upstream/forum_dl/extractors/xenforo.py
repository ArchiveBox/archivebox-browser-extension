# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from urllib.parse import urljoin
import re

from .common import normalize_url, regex_match
from .common import HtmlExtractor, ExtractorOptions, Board, Thread, Post, PageState
from ..session import Session
from ..soup import Soup, SoupTag

if TYPE_CHECKING:
    from requests import Response


class XenforoExtractor(HtmlExtractor):
    tests = [
        {
            "url": "https://xenforo.com/community",
            "test_base_url": "https://xenforo.com/community/",
            "test_boards": {
                ("1",): {
                    "title": "Official forums",
                },
                ("1", "2"): {
                    "title": "Announcements",
                },
                ("1", "3"): {
                    "title": "Have you seen...?",
                },
                ("1", "19"): {
                    "title": "Frequently asked questions",
                },
                ("17",): {
                    "title": "Public forums",
                },
                ("17", "5"): {
                    "title": "XenForo pre-sales questions",
                },
                ("17", "18"): {
                    "title": "XenForo suggestions",
                },
                ("46",): {
                    "title": "XenForo bug reports",
                },
                ("46", "91"): {
                    "title": "Bug reports",
                },
                ("46", "105"): {
                    "title": "Importer bug reports",
                },
                ("46", "92"): {
                    "title": "Resolved bug reports",
                },
                ("46", "43"): {
                    "title": "Future-fix bug reports",
                },
                ("22",): {
                    "title": "Customer forums",
                },
                ("22", "23"): {
                    "title": "Installation, upgrade, and import support",
                },
                ("22", "24"): {
                    "title": "Troubleshooting and problems",
                },
                ("22", "25"): {
                    "title": "XenForo questions and support",
                },
                ("22", "47"): {
                    "title": "Styling and customization questions",
                },
                ("22", "48"): {
                    "title": "Server configuration and hosting",
                },
                ("22", "84"): {
                    "title": "Forum management",
                },
                ("22", "79"): {
                    "title": "Tips and guides [1.x]",
                },
                ("22", "94"): {
                    "title": "Tips and guides [2.x]",
                },
                ("22", "45"): {
                    "title": "Other XenForo discussions and feedback",
                },
                ("22", "49"): {
                    "title": "XenForo help and manual",
                },
                ("54",): {
                    "title": "Official XenForo add-ons",
                },
                ("54", "86"): {
                    "title": "Media Gallery suggestions",
                },
                ("54", "87"): {
                    "title": "Media Gallery support",
                },
                ("54", "88"): {
                    "title": "Media Gallery bug reports",
                },
                ("54", "65"): {
                    "title": "Resource Manager suggestions",
                },
                ("54", "82"): {
                    "title": "Resource Manager support",
                },
                ("54", "66"): {
                    "title": "Resource Manager bug reports",
                },
                ("54", "55"): {
                    "title": "Enhanced Search suggestions",
                },
                ("54", "56"): {
                    "title": "Enhanced Search support",
                },
                ("54", "57"): {
                    "title": "Enhanced Search bug reports",
                },
                ("60",): {
                    "title": "XenForo resources and add-ons",
                },
                ("60", "70"): {
                    "title": "Resources and add-ons",
                },
                ("60", "71"): {
                    "title": "Resource and add-on releases [1.x]",
                },
                ("60", "93"): {
                    "title": "Resource and add-on releases [2.x]",
                },
                ("60", "68"): {
                    "title": "Resource and add-on requests",
                },
                ("60", "63"): {
                    "title": "Resource and add-on discussions",
                },
                ("60", "69"): {
                    "title": "Custom service/development requests",
                },
                ("60", "42"): {
                    "title": "Third-party services & offers",
                },
                ("60", "62"): {
                    "title": "Resource and add-on archive",
                },
                ("51",): {
                    "title": "Development help",
                },
                ("51", "106"): {
                    "title": "Resource standards",
                },
                ("51", "80"): {
                    "title": "Development tutorials and resources [1.x]",
                },
                ("51", "101"): {
                    "title": "Development tutorials [2.x]",
                },
                ("51", "34"): {
                    "title": "XenForo development discussions",
                },
                ("51", "52"): {
                    "title": "General PHP and MySQL discussions",
                },
                ("4",): {
                    "title": "General discussions",
                },
                ("4", "53"): {
                    "title": "Forum showcase and critiques",
                },
                ("4", "7"): {
                    "title": "Off topic",
                },
                ("14",): {
                    "title": "Tests and examples",
                },
                ("14", "109"): {
                    "title": "Resolved bugs",
                },
                ("14", "110"): {
                    "title": "Implemented suggestions",
                },
                ("14", "11"): {
                    "title": "Example page",
                },
            },
        },
        {
            "url": "https://xenforo.com/community/threads/darkness-free-xenforo-2-gaming-skin-deleted.154782/",
            "test_base_url": "https://xenforo.com/community/",
            "test_contents_hash": "0c49d593c65d6a3a57a27115a7659391d889a78d",
            "test_item_count": 53,
        },
        {
            "url": "https://xenforo.com/community/threads/steam-authentication-deleted.141309/",
            "test_base_url": "https://xenforo.com/community/",
            "test_contents_hash": "ba129ef0ceb4fdb92aee79e2b0ba1a4eabf24557",
            "test_item_count": 26,
        },
        {
            "url": "https://forums.tomshardware.com/categories/hardware.1/",
            "test_base_url": "https://forums.tomshardware.com/",
            "test_boards": {
                ("1", "9"): {
                    "title": "Graphics Cards",
                },
                ("1", "7"): {
                    "title": "Systems",
                },
                ("1", "3"): {
                    "title": "Components",
                },
                ("1", "2"): {
                    "title": "CPUs",
                },
                ("1", "5"): {
                    "title": "Motherboards",
                },
                ("1", "8"): {
                    "title": "Storage",
                },
                ("1", "4"): {
                    "title": "Overclocking",
                },
                ("1", "6"): {
                    "title": "Memory",
                },
                ("1", "10"): {
                    "title": "Displays",
                },
                ("1", "44"): {
                    "title": "Prebuilt & Enterprise",
                },
                ("1", "77"): {
                    "title": "Cases",
                },
                ("1", "74"): {
                    "title": "Cooling",
                },
                ("1", "75"): {
                    "title": "Power Supplies",
                },
                ("1", "78"): {
                    "title": "Raspberry Pi & Single Board Computers",
                },
            },
        },
        {
            "url": "https://forums.tomshardware.com/threads/windows-11.3707807/",
            "test_base_url": "https://forums.tomshardware.com/",
            "test_contents_hash": "5c6b603554ae10ad04c1d75918edeed4ec5875f5",
            "test_item_count": 96,
        },
        {
            "url": "https://www.kanyetothe.com/threads/music-is-life-music-is-love.5820610/",
            "test_base_url": "https://www.kanyetothe.com/forums/",
            # "test_contents_hash": "ae49ef2fa8a742b32815e95817a7750171138fa3",
            # FIXME: The initial post is duplicated at each page.
            "test_item_count": 54,
        },
    ]

    _board_item_css = ".structItem--thread"
    _board_next_page_css = "a.pageNav-jump--next"
    _thread_item_css = "article.message, .MessageCard"
    _thread_next_page_css = "a.pageNav-jump--next"

    _board_class_regex = re.compile(r"^node--id(\d+)$")
    _thread_class_regex = re.compile(r"^js-threadListItem-(\d+)$")
    _thread_key_regex = re.compile(r"^thread-(\d+)$")
    _post_id_regex = re.compile(r"^post-(\d+)$")

    @staticmethod
    def _detect(session: Session, url: str, options: ExtractorOptions):
        response = session.try_get(
            normalize_url(url, remove_suffixes=[], append_slash=False),
            should_cache=True,
            should_retry=False,
        )

        if not re.search(r'<html[^>]+id="XF"', response.text, re.MULTILINE):
            return None

        soup = Soup(response.content)

        data_nav_id_anchor = soup.try_find("a", attrs={"data-nav-id": "forums"})
        if data_nav_id_anchor:
            base_url = normalize_url(urljoin(url, data_nav_id_anchor.get("href")))
        else:
            header_forum_listing_anchor = soup.find("a", id="header-forum-listing")
            base_url = normalize_url(
                urljoin(url, header_forum_listing_anchor.get("href"))
            )

        return XenforoExtractor(session, base_url, options)

    def _fetch_top_boards(self):
        self._are_subboards_fetched[self.root.path] = True

        response = self._session.get(self.base_url, should_cache=True)
        soup = Soup(response.content)

        block_divs = soup.find_all("div", class_="block")
        for block_div in block_divs:
            if category_header := block_div.try_find("h2", class_="block-header"):
                url = urljoin(response.url, category_header.find("a").get("href"))
                title = category_header.find("a").string.strip()

                try:
                    category_id = regex_match(
                        re.compile(r"^block--category(\d+)$"),
                        block_div.get_list("class"),
                    ).group(1)
                except:
                    continue
            elif category_span := block_div.tag.find_previous_sibling(
                "span", class_="u-anchorTarget"
            ):
                url = urljoin(response.url, f"#{category_span.get('id')}")

                category_id = regex_match(
                    re.compile(r"^.*\.(\d)+$"), category_span.get("id")
                ).group(1)

                title = block_div.find("div", class_="section-header").string
            else:
                continue

            self._set_board(
                path=(category_id,),
                url=url,
                origin=response.url,
                data={},
                title=title,
                are_subboards_fetched=True,
            )

            node_id_divs = block_div.find_all("div", class_=self._board_class_regex)

            for node_id_div in node_id_divs:
                subboard_id = regex_match(
                    self._board_class_regex, node_id_div.get_list("class")
                ).group(1)

                node_description_anchor = node_id_div.find(
                    "a", attrs={"data-shortcut": "node-description"}
                )

                href = node_description_anchor.get("href")

                self._set_board(
                    path=(category_id, subboard_id),
                    url=urljoin(self.base_url, href),
                    origin=response.url,
                    data={},
                    title=node_description_anchor.string.strip(),
                )

        self._fetch_lower_boards(self.root)

    def _do_fetch_subboards(self, board: Board):
        if board is self.root:
            return

        if len(board.path) <= 1:
            return

        response = self._session.get(board.url, should_cache=True)
        soup = Soup(response.content)

        node_id_divs = soup.find_all("div", class_=self._board_class_regex)

        for node_id_div in node_id_divs:
            subboard_id = regex_match(
                self._board_class_regex, node_id_div.get_list("class")
            ).group(1)

            node_description_anchor = node_id_div.find(
                "a", attrs={"data-shortcut": "node-description"}
            )

            href = node_description_anchor.get("href")

            self._set_board(
                path=board.path + (subboard_id,),
                url=urljoin(self.base_url, href),
                origin=response.url,
                data={},
                title=node_description_anchor.string.strip(),
            )

    def _get_node_from_url(self, url: str):
        response = self._session.get(url, should_cache=True)
        soup = Soup(response.content)

        if breadcrumbs_ul := soup.try_find("ul", class_="p-breadcrumbs"):
            breadcrumb_anchors = breadcrumbs_ul.find_all(
                "a", attrs={"itemprop": "item"}
            )

            if len(breadcrumb_anchors) <= 1:
                return self.root
        else:
            return self.root

        # Thread.
        if soup.try_find("article") or soup.try_find("div", class_="MessageCard"):
            board_url = urljoin(url, breadcrumb_anchors[-2].get("href"))
            block_div = soup.find(
                "div", class_="block-container", attrs={"data-lb-id": True}
            )
            thread_id = regex_match(
                self._thread_key_regex, block_div.get("data-lb-id")
            ).group(1)
            title_h1 = soup.find("h1")

            print(board_url)
            print(self._boards)

            for cur_board in self._boards:
                if cur_board.url == board_url:
                    return Thread(
                        path=cur_board.path + (thread_id,),
                        url=urljoin(self.base_url, url),
                        origin=response.url,
                        data={},
                        title=title_h1.string,
                    )
        # Board.
        else:
            # Instead of normalizing the URL, we go the easy way: we get the OpenGraph URL.
            board_href = soup.find("meta", attrs={"property": "og:url"}).get("content")

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
        thread_id = regex_match(
            self._thread_class_regex, tag.get_list("class")[-1]
        ).group(1)

        title_div = tag.find(True, class_="structItem-title")
        title_anchor = title_div.find("a", attrs={"data-tp-primary": True})

        url = urljoin(self.base_url, title_anchor.get("href"))

        return Thread(
            path=board.path + (thread_id,),
            url=url,
            origin=response.url,
            data={},
            title=title_anchor.string,
        )

    def _extract_thread_page_post(
        self, thread: Thread, state: PageState, response: Response, tag: SoupTag
    ):
        if message_attribution_ul := tag.try_find(
            "ul", class_="message-attribution-main"
        ):
            subpath = (
                regex_match(self._post_id_regex, tag.get("data-content")).group(1),
            )

            author = tag.get("data-author")
            url_anchor = message_attribution_ul.find("a")
            time_tag = message_attribution_ul.find("time")
        else:
            messagecard_header = tag.find("header", class_="MessageCard__header")

            subpath = (
                tag.find("div", class_="MessageCard__content").get("data-post-id"),
            )

            author = tag.find("a", class_="MessageCard__user-info__name").string
            url_anchor = messagecard_header.find(
                "a", class_="MessageCard__date-created"
            )
            time_tag = messagecard_header.find("time")

        bbwrapper_div = tag.find("div", class_="bbWrapper")

        return Post(
            path=thread.path,
            subpath=subpath,
            url=urljoin(state.url, url_anchor.get("href")),
            origin=response.url,
            data={},
            author=author,
            creation_time=time_tag.get("datetime"),
            content=bbwrapper_div.string,
        )
