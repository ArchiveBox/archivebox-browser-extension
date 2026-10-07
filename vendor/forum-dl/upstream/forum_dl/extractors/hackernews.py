# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from abc import abstractmethod
from urllib.parse import urljoin, urlparse, parse_qs
import logging
from datetime import datetime

from .common import Extractor, ExtractorOptions, Board, Thread, Post, PageState
from ..session import Session


class HackernewsExtractor(Extractor):
    tests = [
        {
            "url": "https://news.ycombinator.com",
            "test_base_url": "https://news.ycombinator.com/",
            "item_count": 5,
            "test_item_count": 5,
        },
        {
            "url": "https://news.ycombinator.com/item?id=1",
            "test_base_url": "https://news.ycombinator.com/",
            "test_contents_hash": "ead3fec1c434236fb09995727cb02c4b7e7dc3ca",
            "test_item_count": 18,
        },
        {
            "url": "https://news.ycombinator.com",
            "test_base_url": "https://news.ycombinator.com/",
            "initial_page": PageState(
                url="https://news.ycombinator.com/item?id=1000", page=1
            ),
            "item_count": 5,
            "test_titles_hash": "bd1ab966ced8daf8c68cc5ad9e51a7bd6c7b622c",
            "test_item_count": 5,
        },
        {
            "url": "https://news.ycombinator.com/newest",
            "test_base_url": "https://news.ycombinator.com/",
            "test_extractor_type": "extractors.hackernews.HackernewsNewExtractor",
            "item_count": 5,
            "test_item_count": 5,
        },
        {
            "url": "https://news.ycombinator.com/news",
            "test_base_url": "https://news.ycombinator.com/",
            "test_extractor_type": "extractors.hackernews.HackernewsTopExtractor",
            "item_count": 5,
            "test_item_count": 5,
        },
        {
            "url": "https://news.ycombinator.com/best",
            "test_base_url": "https://news.ycombinator.com/",
            "test_extractor_type": "extractors.hackernews.HackernewsBestExtractor",
            "item_count": 5,
            "test_item_count": 5,
        },
        {
            "url": "https://news.ycombinator.com/ask",
            "test_base_url": "https://news.ycombinator.com/",
            "test_extractor_type": "extractors.hackernews.HackernewsAskExtractor",
            "item_count": 5,
            "test_item_count": 5,
        },
        {
            "url": "https://news.ycombinator.com/show",
            "test_base_url": "https://news.ycombinator.com/",
            "test_extractor_type": "extractors.hackernews.HackernewsShowExtractor",
            "item_count": 5,
            "test_item_count": 5,
        },
        {
            "url": "https://news.ycombinator.com/jobs",
            "test_base_url": "https://news.ycombinator.com/",
            "test_extractor_type": "extractors.hackernews.HackernewsJobExtractor",
            "item_count": 5,
            "test_item_count": 5,
        },
    ]

    PAGE_SIZE = 1000

    @staticmethod
    def _detect(session: Session, url: str, options: ExtractorOptions):
        parsed_url = urlparse(url)
        if parsed_url.netloc == "news.ycombinator.com":
            if parsed_url.path == "/newest":
                return HackernewsNewExtractor(session, urljoin(url, "/"), options)

            if parsed_url.path == "/news":
                return HackernewsTopExtractor(session, urljoin(url, "/"), options)

            if parsed_url.path == "/best":
                return HackernewsBestExtractor(session, urljoin(url, "/"), options)

            if parsed_url.path == "/ask":
                return HackernewsAskExtractor(session, urljoin(url, "/"), options)

            if parsed_url.path == "/show":
                return HackernewsShowExtractor(session, urljoin(url, "/"), options)

            if parsed_url.path == "/jobs":
                return HackernewsJobExtractor(session, urljoin(url, "/"), options)

            return HackernewsExtractor(session, urljoin(url, "/"), options)

    def _calc_first_item_id(self, page_id: int):
        return 1 + (page_id * self.PAGE_SIZE)

    def _calc_page_id(self, item_id: int):
        return (item_id - 1) // self.PAGE_SIZE

    def _fetch_top_boards(self):
        firebase_url = f"https://hacker-news.firebaseio.com/v0/maxitem.json"
        self._max_item_id = int(self._session.get(firebase_url).content)
        self.pages: list[list[int]] = [[]] * (1 + self._calc_page_id(self._max_item_id))

    def _do_fetch_subboards(self, board: Board):
        pass

    def _get_node_from_url(self, url: str):
        parsed_url = urlparse(url)

        # The whole site.
        # TODO: Do this `if` properly by normalizing the URL beforehand.
        if parsed_url.path == "" or parsed_url.path == "/":
            return self.root
        # Thread.
        elif parsed_url.path == "/item":
            parsed_query = parse_qs(parsed_url.query)
            item_id = str(parsed_query["id"][0])

            return self._fetch_item_thread(int(item_id))

        raise ValueError

    def _fetch_lazy_subboard(self, board: Board, subboard_id: str):
        pass

    def _fetch_lazy_subboards(self, board: Board):
        yield from ()

    def _get_is_fetchable(self, item_id: int):
        if item_id > self._max_item_id:
            return False

        page_id = self._calc_page_id(item_id)

        if item_id in self.pages[page_id]:
            return False

        return True

    def _register_item(self, item_id: int):
        page_id = self._calc_page_id(item_id)

        if page_id >= len(self.pages):
            return False

        self.pages[page_id].append(item_id)
        return True

    def _fetch_item_thread(self, item_id: int):
        while True:
            firebase_url = f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json"
            response = self._session.get(firebase_url, should_cache=True)
            data = response.json()

            if "parent" in data:
                item_id = data["parent"]
            else:
                page_id = self._calc_page_id(item_id)
                self.pages[page_id].append(item_id)

                self._register_item(item_id)
                return Thread(
                    path=(
                        str(
                            item_id,
                        ),
                    ),
                    url=f"https://news.ycombinator.com/item?id={item_id}",
                    origin=response.url,
                    data=data,
                    title=data.get("title", None),
                )

    def _fetch_board_page_threads(self, board: Board, state: PageState):
        # FIXME: This is ineffective, as we connect twice for each non-top item.
        # We make artificial pages of 1000 items.

        parsed_state_url = urlparse(state.url)
        parsed_query = parse_qs(parsed_state_url.query)

        if "id" in parsed_query:
            state_item_id = int(parsed_query["id"][0])
            page_id = self._calc_page_id(state_item_id)
        else:
            page_id = self._calc_page_id(self._max_item_id)

        # Remove pages above the state item id.
        del self.pages[page_id + 1 :]

        for item_id in reversed(
            range(
                self._calc_first_item_id(page_id), self._calc_first_item_id(page_id + 1)
            )
        ):
            if not self._get_is_fetchable(item_id):
                continue

            yield self._fetch_item_thread(item_id)

        if page_id > 0:
            new_state_item_id = self._calc_first_item_id(page_id) - 1
            return PageState(
                url=f"https://news.ycombinator.com/item?id={new_state_item_id}",
                page=state.page + 1,
            )

    def _fetch_thread_page_posts(self, thread: Thread, state: PageState):
        post_paths: list[tuple[str, ...]] = [()]

        i = 0
        while True:
            post_path = post_paths[i]

            if post_path:
                post_id = post_path[-1]
            else:
                post_id = thread.path[-1]

            firebase_url = f"https://hacker-news.firebaseio.com/v0/item/{post_id}.json"

            response = self._session.get(firebase_url)
            data = response.json()

            if data:
                self._register_item(int(post_id))
                yield Post(
                    path=thread.path,
                    subpath=post_path,
                    url=thread.url,
                    origin=response.url,
                    data=data,
                    author=data.get("by", ""),
                    creation_time=datetime.utcfromtimestamp(data.get("time")),
                    content=data.get("text", ""),
                )

                for kid_id in data.get("kids", []):
                    post_paths.append(post_path + (str(kid_id),))

            else:
                logging.warning(f"Item at post_id={post_path[-1]} is null")

            i += 1
            if i == len(post_paths):
                break


class HackernewsSpecificExtractor(HackernewsExtractor):
    tests = []

    @staticmethod
    @abstractmethod
    def get_firebase_url() -> str:
        return ""

    def _get_node_from_url(self, url: str):
        return self.root

    def _fetch_board_page_threads(self, board: Board, state: PageState):
        json = self._session.get(self.get_firebase_url()).json()

        for story_id in json:
            firebase_url = f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json"
            response = self._session.get(firebase_url)
            data = response.json()

            yield Thread(
                path=(str(story_id),),
                url=f"https://news.ycombinator.com/item?id={story_id}",
                origin=response.url,
                data=data,
                title=data.get("title", ""),
            )


class HackernewsNewExtractor(HackernewsSpecificExtractor):
    @staticmethod
    def get_firebase_url():
        return "https://hacker-news.firebaseio.com/v0/newstories.json"


class HackernewsTopExtractor(HackernewsSpecificExtractor):
    @staticmethod
    def get_firebase_url():
        return "https://hacker-news.firebaseio.com/v0/topstories.json"


class HackernewsBestExtractor(HackernewsSpecificExtractor):
    @staticmethod
    def get_firebase_url():
        return "https://hacker-news.firebaseio.com/v0/beststories.json"


class HackernewsAskExtractor(HackernewsSpecificExtractor):
    @staticmethod
    def get_firebase_url():
        return "https://hacker-news.firebaseio.com/v0/askstories.json"


class HackernewsShowExtractor(HackernewsSpecificExtractor):
    @staticmethod
    def get_firebase_url():
        return "https://hacker-news.firebaseio.com/v0/showstories.json"


class HackernewsJobExtractor(HackernewsSpecificExtractor):
    @staticmethod
    def get_firebase_url():
        return "https://hacker-news.firebaseio.com/v0/jobstories.json"
