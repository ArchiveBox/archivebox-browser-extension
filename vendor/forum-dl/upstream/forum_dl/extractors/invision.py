# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

import re

from .common import (
    HtmlExtractor,
    ExtractorOptions,
    Board,
    Thread,
    Post,
    PageState,
    regex_match,
)
from ..session import Session
from ..soup import Soup, SoupTag

if TYPE_CHECKING:
    from requests import Response


class InvisionExtractor(HtmlExtractor):
    tests = [
        {
            "url": "https://invisioncommunity.com/forums",
            "test_base_url": "https://invisioncommunity.com/forums/",
            "test_boards": {
                ("180", "528"): {
                    "title": "Invision Community Insider",
                },
                ("180", "499"): {
                    "title": "Feedback",
                },
                ("180", "320"): {
                    "title": "Community Manager Chat",
                },
                ("492", "505"): {
                    "title": "General Questions",
                },
                ("492", "497"): {
                    "title": "Technical Problems",
                },
                ("492", "497", "524"): {
                    "title": "Classic self-hosted technical help",
                },
                ("492", "500"): {
                    "title": "Design and Customization",
                },
                ("492", "477"): {
                    "title": "Community Manager Idea Sharing",
                },
                ("307", "504"): {
                    "title": "Developer Connection",
                },
                ("307", "521"): {
                    "title": "Marketplace",
                },
            },
        },
        {
            "url": "https://invisioncommunity.com/forums/topic/367687-important-seo-step-that-is-often-overlooked/",
            "test_base_url": "https://invisioncommunity.com/forums/",
            "test_contents_hash": "2a0a5ff4d936045e3148bd910f207e07ed4a0ed3",
            "test_item_count": 65,
        },
        {
            "url": "https://invisioncommunity.com/forums/topic/447328-guide-joels-guide-to-subscriptions/",
            "test_base_url": "https://invisioncommunity.com/forums/",
            "test_contents_hash": "1e0e0413cf82cf82bf83cfdf69813309594a06e4",
            "test_item_count": 52,
        },
    ]

    _board_item_css = 'li[data-controller="forums.frontforum.topicRow"]'
    _board_next_page_css = 'link[rel="next"]'
    _thread_item_css = "article.ipsComment"
    _thread_next_page_css = 'link[rel="next"]'

    @staticmethod
    def _detect(session: Session, url: str, options: ExtractorOptions):
        response = session.try_get(url, should_cache=True, should_retry=False)
        soup = Soup(response.content)

        breadcrumbs_ul = soup.find("ul", attrs={"data-role": "breadcrumbList"})
        breadcrumb_lis = breadcrumbs_ul.find_all("li")
        base_url = url

        if len(breadcrumb_lis) >= 2:
            base_url = breadcrumb_lis[1].find("a").get("href")

        if soup.find("a", attrs={"title": "Invision Community"}):
            return InvisionExtractor(session, base_url, options)

    def _fetch_top_boards(self):
        self._are_subboards_fetched[self.root.path] = True

        response = self._session.get(self.base_url, should_cache=True)
        soup = Soup(response.content)

        category_lis = soup.find_all("li", class_="cForumRow")
        for category_li in category_lis:
            category_id = category_li.get("data-categoryid")
            category_anchor = category_li.find("h2").find_all("a")[1]

            self._set_board(
                path=(category_id,),
                url=category_anchor.get("href"),
                origin=response.url,
                data={},
                title=category_anchor.string,
                are_subboards_fetched=True,
            )

            board_divs = category_li.find_all("div", class_="cForumGrid")
            for board_div in board_divs:
                board_id = board_div.get("data-forumid")
                board_h3 = board_div.find("h3", class_="cForumGrid__title")
                board_anchor = board_h3.find("a")

                self._set_board(
                    path=(category_id, board_id),
                    url=board_anchor.get("href"),
                    origin=response.url,
                    data={},
                    title=category_anchor.string,
                    are_subboards_fetched=True,
                )

        self._fetch_lower_boards(self.root)

    def _do_fetch_subboards(self, board: Board):
        if board is self.root:
            return

        response = self._session.get(board.url, should_cache=True)
        soup = Soup(response.content)

        subboard_divs = soup.find_all("div", class_="cForumGrid")
        for subboard_div in subboard_divs:
            subboard_id = subboard_div.get("data-forumid")
            subboard_h3 = subboard_div.find("h3")
            subboard_anchor = subboard_h3.find("a")

            self._set_board(
                path=board.path + (subboard_id,),
                url=subboard_anchor.get("href"),
                origin=response.url,
                data={},
                title=subboard_anchor.string,
                are_subboards_fetched=True,
            )

    def _get_node_from_url(self, url: str):
        response = self._session.get(url, should_cache=True)
        soup = Soup(response.content)

        breadcrumbs_ul = soup.find("ul", attrs={"data-role": "breadcrumbList"})
        breadcrumb_lis = breadcrumbs_ul.find_all("li")

        if len(breadcrumb_lis) <= 2:
            return self.root

        # Thread.
        if soup.try_find("article"):
            board_href = breadcrumb_lis[-2].find("a").get("href")
            thread_id = soup.find("body").get("data-pageid")
            title_meta = soup.find("meta", attrs={"property": "og:title"})

            for cur_board in self._boards:
                if cur_board.url == board_href:
                    return Thread(
                        path=cur_board.path + (thread_id,),
                        url=url,
                        origin=response.url,
                        data={},
                        title=str(title_meta.get("content")),
                    )
        # Board.
        else:
            for cur_board in self._boards:
                if cur_board.url == url:
                    return cur_board

        raise ValueError

    def _fetch_lazy_subboard(self, board: Board, subboard_id: str):
        pass

    def _fetch_lazy_subboards(self, board: Board):
        yield from ()

    def _extract_board_page_thread(
        self, board: Board, state: PageState, response: Response, tag: SoupTag
    ):
        thread_id = tag.get("data-rowid")
        title_h4 = tag.find("h4", class_="ipsDataItem_title")
        thread_anchor = title_h4.find("a", attrs={"title": True})

        return Thread(
            path=board.path + (thread_id,),
            url=thread_anchor.get("href"),
            origin=response.url,
            data={},
            title=thread_anchor.get("title"),
        )

    def _extract_thread_page_post(
        self, thread: Thread, state: PageState, response: Response, tag: SoupTag
    ):
        content_div = tag.find("div", attrs={"data-role": "commentContent"})
        author_div = tag.find("div", class_="cAuthorPane_content")
        time_tag = author_div.find("time")

        author_h3 = author_div.find("h3", class_="cAuthorPane_author")
        url_div = author_div.find("div")
        post_id = regex_match(re.compile(r"^elComment_(\d+)"), tag.get("id")).group(1)

        return Post(
            path=thread.path,
            subpath=(post_id,),
            url=url_div.find("a").get("href"),
            origin=response.url,
            data={},
            author=author_h3.find("a").string,
            creation_time=time_tag.get("datetime"),
            content="".join(str(v) for v in content_div.contents),
        )
