# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

from abc import ABC, abstractmethod
from pydantic import BaseModel
from mailbox import Mailbox, Message
from urllib.parse import urlparse
from base64 import b64encode, b64decode
from urllib.parse import quote_plus
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.encoders import encode_base64

import email.utils
import os
import re

try:
    from html2text import html2text
except ImportError:
    pass

from datetime import datetime, timezone
import sys

from ..extractors.common import Extractor, Item, Thread, Board, Post, File, PageState
from ..version import __version__


class WriterOptions(BaseModel):
    output_path: str
    files_output_path: str
    write_board_objects: bool
    write_thread_objects: bool
    write_post_objects: bool
    write_file_objects: bool
    write_outside_file_objects: bool
    textify: bool
    content_as_title: bool
    author_as_addr_spec: bool


class WriterState(BaseModel):
    board_path: tuple[str, ...] | None = None
    board_page: PageState | None = None
    thread_page: PageState | None = None


class Entry(BaseModel):
    generator: str
    version: str
    extractor: str
    download_time: datetime
    type: str
    item: Item

    class Config:
        json_encoders: dict[Any, Callable[[Any], str]] = {
            bytes: lambda content: b64encode(content).decode("ascii"),
        }


class Writer(ABC):
    tests: list[dict[str, Any]]

    def __init__(self, extractor: Extractor, options: WriterOptions):
        self._extractor = extractor
        self._options = options
        self._initial_state = WriterState()

    def write(self, url: str):
        self.read_metadata()

        base_node = self._extractor.node_from_url(url)

        if isinstance(base_node, Board):
            self.write_board(base_node)
        elif isinstance(base_node, Thread):
            self.write_thread(base_node)

    @abstractmethod
    def read_metadata(self):
        pass

    @abstractmethod
    def _write_board_object(self, board: Board):
        pass

    def _write_board_threads(self, board: Board):
        for item in self._extractor.threads_with_files(
            board, self._initial_state.board_page
        ):
            match item:
                case Thread():
                    self.write_thread(item)
                case File():
                    self.write_file(item)

    @final
    def write_board(self, board: Board):
        if self._options.write_board_objects:
            self._write_board_object(board)

        self._write_board_threads(board)

        for _, subboard in self._extractor.subboards(board).items():
            self.write_board(subboard)

    @abstractmethod
    def _write_thread_object(self, thread: Thread):
        pass

    def _write_thread_posts(self, thread: Thread):
        for item in self._extractor.posts_with_files(
            thread, self._initial_state.thread_page
        ):
            match item:
                case Post():
                    self.write_post(thread, item)
                case File():
                    self.write_file(item)

    @final
    def write_thread(self, thread: Thread):
        if self._options.write_thread_objects:
            self._write_thread_object(thread)

        self._write_thread_posts(thread)

    @abstractmethod
    def _write_post_object(self, thread: Thread, post: Post):
        pass

    @final
    def write_post(self, thread: Thread, post: Post):
        if self._options.write_post_objects:
            self._write_post_object(thread, post)

    @final
    def write_file(self, file: File):
        if not self._options.write_file_objects:
            return

        if not file.path and not self._options.write_outside_file_objects:
            return

        if self._options.files_output_path:
            os.makedirs(self._options.files_output_path, exist_ok=True)

            file_path = os.path.join(
                self._options.files_output_path, quote_plus(file.url)
            )

            if file.content:
                file.os_path = file_path

                with open(file_path, "wb") as f:
                    f.write(file.content)

                file.content = None
            elif match := re.match("data:(.+/.+);base64,(.*)", file.url):
                file.content_type = match.group(1)
                file.os_path = file_path

                with open(file_path, "wb") as f:
                    f.write(b64decode(match.group(2)))
            elif response := self._extractor.download_file(file):
                print(response.headers)
                file.content_type = response.headers.get(
                    "Content-Type", "application/octet-stream"
                )
                file.os_path = file_path

                with open(file_path, "wb") as f:
                    f.write(response.content)
        else:
            if file.content:
                file.content = b64encode(file.content)
            elif match := re.match("data:(.+/.+);base64,(.*)", file.url):
                file.content_type = match.group(1)
            else:
                if response := self._extractor.download_file(file):
                    file.content_type = response.headers.get(
                        "Content-Type", "application/octet-stream"
                    )
                    file.content = b64encode(response.content)

        self._write_file_object(file)

    @abstractmethod
    def _write_file_object(self, file: File):
        pass


class SimulatedWriter(Writer):
    def read_metadata(self):
        pass

    def _write_board_object(self, board: Board):
        pass

    def _write_thread_object(self, thread: Thread):
        pass

    def _write_post_object(self, thread: Thread, post: Post):
        pass

    def _write_file_object(self, file: File):
        pass


class FileWriter(Writer):
    def __init__(self, extractor: Extractor, options: WriterOptions):
        super().__init__(extractor, options)

        if options.output_path != "-":
            self._file = open(options.output_path, "w")
        else:
            self._file = None

    def __del__(self):
        if self._file:
            self._file.close()

    def read_metadata(self):
        pass  # TODO.

    def _write_board_object(self, board: Board):
        entry = self._make_entry(board)

        if self._file:
            self._file.write(f"{self._serialize_entry(entry)}\n")
        else:
            sys.stdout.write(f"{self._serialize_entry(entry)}\n")

    def _write_thread_object(self, thread: Thread):
        entry = self._make_entry(thread)

        if self._file:
            self._file.write(f"{self._serialize_entry(entry)}\n")
        else:
            sys.stdout.write(f"{self._serialize_entry(entry)}\n")

    def _write_post_object(self, thread: Thread, post: Post):
        entry = self._make_entry(post)

        if self._file:
            self._file.write(f"{self._serialize_entry(entry)}\n")
        else:
            sys.stdout.write(f"{self._serialize_entry(entry)}\n")

    def _write_file_object(self, file: File):
        entry = self._make_entry(file)

        if self._file:
            self._file.write(f"{self._serialize_entry(entry)}\n")
        else:
            sys.stdout.write(f"{self._serialize_entry(entry)}\n")

    def _make_entry(self, item: Item):
        match item:
            case Board():
                typ = "board"
            case Thread():
                typ = "thread"
            case Post():
                typ = "post"
            case File():
                typ = "file"
            case Item():
                raise ValueError

        return Entry(
            generator="forum-dl",
            version=__version__,
            extractor=self._extractor.__class__.__module__.split(".")[-1],
            download_time=datetime.now(timezone.utc),
            type=typ,
            item=item,
        )

    @abstractmethod
    def _serialize_entry(self, entry: Entry) -> str:
        pass


class MailWriter(Writer):
    def __init__(
        self,
        extractor: Extractor,
        mailbox: Mailbox[Any],
        options: WriterOptions,
    ):
        super().__init__(extractor, options)
        self._mailbox = mailbox
        self._message_key = None

        for key, msg in self._mailbox.iteritems():
            if msg.get("X-Forumdl-Version"):
                self._metadata_key = key
        else:
            msg = self._new_message()
            self._metadata_key = self._mailbox.add(msg)

    def __del__(self):
        self._mailbox.flush()
        self._mailbox.close()

    def write(self, url: str):
        self._mailbox.lock()
        super().write(url)
        self._mailbox.unlock()

    def read_metadata(self):
        pass  # TODO.

    def _write_board_object(self, board: Board):
        pass  # TODO.

    def _write_thread_object(self, thread: Thread):
        pass  # TODO.

    def _write_post_object(self, thread: Thread, post: Post):
        self._post = post
        self._message_key = self._mailbox.add(self._build_message(thread, post))

    def _write_file_object(self, file: File):
        if file.subpath[:-1] == self._post.subpath:
            part = Message()
            part["Content-Type"] = file.content_type
            part["MIME-Version"] = "1.0"

            if response := self._extractor.download_file(file):
                part.set_payload(response.content)

            encode_base64(part)

            part.add_header(
                f"Content-Disposition",
                f"attachment; filename={quote_plus(file.url)}",
            )
            self._attach_part(part)

    def _attach_part(self, part: Message):
        if self._message_key:
            msg = self._mailbox[self._message_key]
            msg.attach(part)
            self._mailbox[self._message_key] = msg

    @abstractmethod
    def _new_message(self) -> Message:
        pass

    def _build_message(self, thread: Thread, post: Post):
        msg = self._new_message()
        msg.set_payload([])

        path = post.path + post.subpath

        msg["Message-ID"] = "<" + ".".join(path) + ">"
        msg["Content-Location"] = post.url
        msg["Date"] = email.utils.formatdate(
            datetime.fromisoformat(post.creation_time).timestamp()
        )

        if self._options.author_as_addr_spec:
            domain = urlparse(self._extractor.base_url).netloc

            msg["From"] = f"{post.author} <{post.author}@{domain}>"
        else:
            msg["From"] = post.author

        if len(path) >= 2:
            msg["In-Reply-To"] = f"<{'.'.join(path[:-1])}>"

            refs = f"{path[0]}"
            for ref in post.path[1:-1]:
                refs += f" <{ref}>"

        if len(post.subpath) >= 1 and self._options.content_as_title:
            msg["Subject"] = html2text(post.content[:98]).partition("\n")[0]
        else:
            msg["Subject"] = thread.title

        # msg["Date"] = formatdate(post.date)

        alternativeMsg = MIMEMultipart("alternative")
        msg.attach(alternativeMsg)

        if self._options.textify:
            alternativeMsg.attach(MIMEText(html2text(post.content)))
        else:
            alternativeMsg.attach(MIMEText(post.content, "html"))

        return msg


class FolderedMailWriter(MailWriter):
    def __init__(
        self,
        extractor: Extractor,
        mailbox: Mailbox[Any],
        options: WriterOptions,
    ):
        super().__init__(extractor, mailbox, options)
        self.folders: dict[str, Mailbox[Any]] = {}
        self._folder_name = None

    def _get_folder_name(self, board: Board):
        return ".".join(board.path)

    def _write_board_object(self, board: Board):
        folder_name = self._get_folder_name(board)

        if folder_name not in self.folders:
            self.folders[folder_name] = getattr(self._mailbox, "add_folder")(
                folder_name
            )

        super()._write_board_object(board)

    def _write_post_object(self, thread: Thread, post: Post):
        board = self._extractor.find_board(thread.path[:-1])
        folder_name = self._get_folder_name(board)

        if folder_name not in self.folders:
            self.folders[folder_name] = getattr(self._mailbox, "add_folder")(
                folder_name
            )

        self._post = post
        self._folder_name = folder_name
        self._message_key = self.folders[folder_name].add(
            self._build_message(thread, post)
        )

    def _attach_part(self, part: Message):
        if self._folder_name and self._message_key:
            msg = self.folders[self._folder_name][self._message_key]
            msg.attach(part)
            self.folders[self._folder_name][self._message_key] = msg
