# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from abc import ABC, abstractmethod
from pydantic import BaseModel
from urllib.parse import urljoin, urlparse, urlunparse, parse_qs, urlencode
from pathlib import PurePosixPath
from datetime import datetime
import logging
import traceback

from ..session import Session
from ..soup import Soup, SoupTag
from ..exceptions import AttributeSearchError, SearchError
from ..version import __version__

if TYPE_CHECKING:
    from requests import Response


def get_relative_url(url: str, base_url: str):
    parsed_base_url = urlparse(base_url)
    parsed_url = urlparse(url)

    base_path = PurePosixPath(str(parsed_base_url.path))
    path = PurePosixPath(str(parsed_url.path))

    if str(base_path) == ".":
        return path

    return str(path.relative_to(base_path))


def normalize_url(
    url: str,
    remove_suffixes: list[str] = ["index.php"],
    append_slash: bool = True,
    keep_queries: list[str] = [],
):
    parsed_url = urlparse(url)
    new_path = parsed_url.path.removesuffix("/")

    if not keep_queries or not parsed_url.query:
        for remove_suffix in remove_suffixes:
            new_path = new_path.removesuffix(remove_suffix)

    new_path = new_path.removesuffix("/")

    query = parse_qs(parsed_url.query)
    new_query = {key: query[key] for key in keep_queries if key in query}

    new_parsed_url = parsed_url._replace(
        path=new_path, params="", query=urlencode(new_query, doseq=True), fragment=""
    )

    new_url = urlunparse(new_parsed_url)

    if append_slash and not new_parsed_url.query:
        return f"{new_url}/"

    return str(new_url)


def regex_match(pattern: Pattern[str], strings: list[str] | str):
    if isinstance(strings, str):
        strings = [strings]

    for string in strings:
        result = pattern.match(string)

        if result:
            return result

    raise ValueError


def regex_search(pattern: Pattern[str], strings: list[str] | str):
    if isinstance(strings, str):
        strings = [strings]

    for string in strings:
        result = pattern.search(string)

        if result:
            return result

    raise ValueError


class ExtractorOptions(BaseModel):
    path: bool


class PageState(BaseModel):
    url: str
    page: int


class Item(BaseModel):
    path: tuple[str, ...]
    url: str
    origin: str
    data: dict[str, Any]


class Post(Item):
    subpath: tuple[str, ...]
    author: str
    creation_time: datetime | None
    content: str


class Thread(Item):
    title: str


class Board(Item):
    title: str


class File(Item):
    subpath: tuple[str, ...]
    content_type: str | None = None
    content: bytes | None = None
    os_path: str | None = None


class Extractor(ABC):
    tests: list[dict[str, Any]]

    @final
    @classmethod
    def detect(
        cls, session: Session, url: str, options: ExtractorOptions
    ) -> Extractor | None:
        try:
            return cls._detect(session, url, options)
        except SearchError:
            pass

    @staticmethod
    @abstractmethod
    def _detect(
        session: Session, url: str, options: ExtractorOptions
    ) -> Extractor | None:
        pass

    def __init__(self, session: Session, base_url: str, options: ExtractorOptions):
        self._session = session
        self.base_url = base_url
        self.root = Board(
            path=(), url=self._resolve_url(base_url), origin=base_url, data={}, title=""
        )
        self._boards: list[Board] = [self.root]
        self._subboards: dict[tuple[str, ...], dict[str, Board]] = {(): {}}
        self._are_subboards_fetched: dict[tuple[str, ...], bool] = {(): False}
        self._are_all_boards_fetched: bool = False
        self._options = options

        self.board_state: PageState | None = None
        self.thread_state: PageState | None = None

    @final
    def fetch(self):
        self._fetch_top_boards()
        # self._fetch_lower_boards(self.root)

    @abstractmethod
    def _fetch_top_boards(self):
        pass

    def _set_board(
        self,
        *,
        path: tuple[str, ...],
        replace_path: tuple[str, ...] | None = None,
        are_subboards_fetched: bool | None = None,
        **kwargs: Any,
    ):
        if replace_path is None:
            replace_path = path

        parent_board = self._find_board(replace_path[:-1])

        if replace_path[-1] in self._subboards[parent_board.path]:
            for k, v in kwargs.items():
                setattr(self._subboards[parent_board.path][replace_path[-1]], k, v)

            new_parent_board = self._find_board(path[:-1])
            self._subboards[new_parent_board.path][path[-1]] = self._subboards[
                parent_board.path
            ].pop(replace_path[-1])
            self._subboards[replace_path] = {}

            if are_subboards_fetched is not None:
                self._are_subboards_fetched[replace_path] = are_subboards_fetched
            else:
                self._are_subboards_fetched[replace_path] = False

            return self._subboards[new_parent_board.path][path[-1]]
        else:
            # We use self.root's type because it may be a subclass of Board.
            self._subboards[parent_board.path][replace_path[-1]] = type(self.root)(
                path=replace_path, **kwargs
            )
            self._subboards[replace_path] = {}
            self._boards.append(self._subboards[parent_board.path][replace_path[-1]])

            if are_subboards_fetched is not None:
                self._are_subboards_fetched[replace_path] = are_subboards_fetched
            else:
                self._are_subboards_fetched[replace_path] = False

            return self._subboards[parent_board.path][replace_path[-1]]

    @final
    def _fetch_lower_boards(self, board: Board):
        if self._are_all_boards_fetched:
            return

        i = 0
        while i < len(self._boards):
            cur_board = self._boards[i]

            if cur_board.path[: len(board.path)] == board.path:
                self._fetch_subboards(cur_board)

            i += 1

        if not board.path:
            self._are_all_boards_fetched = True

    @final
    def _fetch_subboards(self, board: Board):
        try:
            self._do_fetch_subboards(board)
        except Exception as e:
            logging.warning(repr(e))
            logging.warning(traceback.format_exc())

    @abstractmethod
    def _do_fetch_subboards(self, board: Board):
        pass

    def _resolve_url(self, url: str):
        return url

    @abstractmethod
    def _get_node_from_url(self, url: str) -> Item | tuple[str, ...]:
        pass

    @final
    def find_board(self, path: tuple[str, ...]):
        # For now, `find_board` always needs all subboards to be fetched.
        if not self._are_all_boards_fetched:
            self._fetch_lower_boards(self.root)

        return self._find_board(path)

    @final
    def _find_board(self, path: tuple[str, ...]):
        cur_board: Board = self.root

        for path_part in path:
            if path_part not in self._subboards[cur_board.path]:
                self._fetch_lazy_subboard(cur_board, path_part)

            cur_board = self._subboards[cur_board.path][path_part]

        return cur_board

    @final
    def find_board_from_urls(self, urls: tuple[str, ...]):
        cur_board: Board = self.root

        for url in urls:
            subboard_urls = [
                subboard.url for _, subboard in self._subboards[cur_board.path].items()
            ]

            if url not in subboard_urls:
                self._fetch_lazy_subboards(cur_board)

            for _, subboard in self._subboards[cur_board.path].items():
                if subboard.url == url:
                    cur_board = subboard

        return cur_board

    @final
    def node_from_url(self, url: str):
        node = self._get_node_from_url(self._resolve_url(url))

        if isinstance(node, Board):
            return self.find_board(node.path)

        return node

    def _fetch_lazy_subboard(self, board: Board, subboard_id: str) -> Board | None:
        if not self._are_subboards_fetched[board.path]:
            for _ in self._fetch_lazy_subboards(board):
                pass

            self._are_subboards_fetched[board.path] = True

        return self._subboards[board.path][subboard_id]

    @abstractmethod
    def _fetch_lazy_subboards(self, board: Board) -> Generator[Board, None, None]:
        self._do_fetch_subboards(board)
        return iter(self._subboards[board.path])

    @final
    def board_count(self):
        return len(self._boards)

    @final
    def subboards(self, board: Board):
        if not self._are_subboards_fetched[board.path]:
            for _ in self._fetch_lazy_subboards(board):
                pass

            self._are_subboards_fetched[board.path] = True

        return self._subboards[board.path]

    @abstractmethod
    def _fetch_board_page_threads(
        self, board: Board, state: PageState
    ) -> Generator[Thread | File, None, PageState | None]:
        pass

    @final
    def _fetch_board_threads(
        self, board: Board, initial_state: PageState | None = None
    ):
        try:
            self.board_state = initial_state or PageState(url=board.url, page=1)
            while self.board_state:
                self.board_state = yield from self._fetch_board_page_threads(
                    board, self.board_state
                )
        except Exception as e:
            logging.warning(repr(e))
            logging.warning(traceback.format_exc())

    @abstractmethod
    def _fetch_thread_page_posts(
        self, thread: Thread, state: PageState
    ) -> Generator[Post | File, None, PageState | None]:
        pass

    @final
    def _fetch_thread_posts(
        self, thread: Thread, initial_state: PageState | None = None
    ):
        try:
            self.thread_state = initial_state or PageState(url=thread.url, page=1)
            while self.thread_state:
                self.thread_state = yield from self._fetch_thread_page_posts(
                    thread, self.thread_state
                )
        except Exception as e:
            logging.warning(repr(e))
            logging.warning(traceback.format_exc())

    @final
    def threads(self, board: Board, initial_state: PageState | None = None):
        for item in self._fetch_board_threads(board, initial_state):
            # if isinstance(item, Thread):
            match item:
                case Thread():
                    yield item
                case File():
                    pass

    @final
    def threads_with_files(self, board: Board, initial_state: PageState | None = None):
        yield from self._fetch_board_threads(board, initial_state)

    @final
    def posts(self, thread: Thread, initial_state: PageState | None = None):
        for item in self._fetch_thread_posts(thread, initial_state):
            match item:
                case Post():
                    yield item
                case File():
                    pass

    @final
    def posts_with_files(self, thread: Thread, initial_state: PageState | None = None):
        yield from self._fetch_thread_posts(thread, initial_state)

    @final
    def download_file(self, file: File):
        try:
            return self._session.try_get(file.url, should_cache=True)
        except Exception as e:
            logging.warning(repr(e))
            logging.warning(traceback.format_exc())


class HtmlExtractor(Extractor):
    _board_item_css: str
    _board_next_page_css: str
    _thread_item_css: str
    _thread_next_page_css: str

    @final
    def _fetch_board_page_threads(self, board: Board, state: PageState):
        response = self._session.get(state.url)
        soup = Soup(response.content)

        for tag in soup.soup.select(self._board_item_css):
            if thread := self._extract_board_page_thread(
                board, state, response, SoupTag(tag)
            ):
                yield thread

        yield from self._extract_file_objects((), (), soup, response)
        return self._extract_board_next_page_state(board, state, response, soup)

    @abstractmethod
    def _extract_board_page_thread(
        self, board: Board, state: PageState, response: Response, tag: SoupTag
    ) -> Thread | None:
        pass

    def _extract_board_next_page_state(
        self, board: Board, state: PageState, response: Response, soup: Soup
    ):
        if next_page_tag := soup.soup.select_one(self._board_next_page_css):
            href = cast(str, next_page_tag.get("href"))

            return PageState(url=urljoin(response.url, href), page=state.page + 1)

    @final
    def _fetch_thread_page_posts(self, thread: Thread, state: PageState):
        response = self._session.get(state.url)
        soup = Soup(response.content)

        content_file_urls: list[str] = []

        for tag in soup.soup.select(self._thread_item_css):
            if post := self._extract_thread_page_post(
                thread, state, response, SoupTag(tag)
            ):
                yield post

                # TODO: Don't reparse text.
                new_content_file_urls = yield from self._extract_file_objects(
                    post.path, post.subpath, Soup(post.content), response
                )
                content_file_urls.extend(new_content_file_urls)

        for file in self._extract_file_objects((), (), soup, response):
            if file.url not in content_file_urls:
                yield file

        return self._extract_thread_next_page_state(thread, state, response, soup)

    @abstractmethod
    def _extract_thread_page_post(
        self, thread: Thread, state: PageState, response: Response, tag: SoupTag
    ) -> Post | None:
        pass

    def _extract_thread_next_page_state(
        self, thread: Thread, state: PageState, response: Response, soup: Soup
    ):
        if next_page_tag := soup.soup.select_one(self._thread_next_page_css):
            href = cast(str, next_page_tag.get("href"))

            if not href:
                return

            return PageState(url=urljoin(response.url, href), page=state.page + 1)

    @final
    def _extract_file_objects(
        self,
        path: tuple[str, ...],
        subpath: tuple[str, ...],
        soup_or_tag: Soup | SoupTag,
        response: Response,
    ):
        match soup_or_tag:
            case Soup():
                obj = soup_or_tag.soup
            case SoupTag():
                obj = soup_or_tag.tag

        embeds = obj.select(
            'link[rel="stylesheet"], embed, audio, img, object, svg, video'
        )

        urls: list[str] = []

        for embed in embeds:
            embed = SoupTag(embed)
            url = None

            if embed.tag.name == "link":
                url = urljoin(response.url, embed.get("href"))
                yield File(
                    path=path,
                    url=url,
                    origin=response.url,
                    data={},
                    subpath=subpath + (url,),
                )
            elif embed.tag.name == "embed":
                url = urljoin(response.url, embed.get("src"))

                yield File(
                    path=path,
                    url=url,
                    origin=response.url,
                    data={},
                    subpath=subpath + (url,),
                )
            elif embed.tag.name == "audio":
                for source in embed.tag.find_all("source"):
                    url = urljoin(response.url, source.get("src"))
                    yield File(
                        path=path,
                        url=url,
                        origin=response.url,
                        data={},
                        subpath=subpath + (url,),
                    )
            elif embed.tag.name == "img":
                try:
                    url = urljoin(response.url, embed.get("src"))
                except AttributeSearchError:
                    url = urljoin(response.url, embed.get("data-src"))

                yield File(
                    path=path,
                    url=url,
                    origin=response.url,
                    data={},
                    subpath=subpath + (url,),
                )
            elif embed.tag.name == "object":
                url = urljoin(response.url, embed.get("data"))
                yield File(
                    path=path,
                    url=url,
                    origin=response.url,
                    data={},
                    subpath=subpath + (url,),
                )
            elif embed.tag.name == "svg":
                yield File(
                    path=path,
                    url=response.url,
                    origin=response.url,
                    data={},
                    subpath=subpath,
                    content_type="image/svg+xml",
                    content=embed.encode_contents(),
                )

            if url:
                urls.append(url)

        return urls
