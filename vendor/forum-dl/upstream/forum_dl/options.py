# pyright: strict
from __future__ import annotations
from typing import *  # type: ignore

import argparse
import logging

from .version import __version__


def build_parser():
    parser = argparse.ArgumentParser(
        add_help=False,
    )

    general = parser.add_argument_group("General Options")
    general.add_argument(
        "--help",
        action="help",
        help="Show this help message and exit",
    )
    general.add_argument(
        "--version",
        action="version",
        version=__version__,
        help="Print program version and exit",
    )
    general.add_argument(
        "--list-extractors",
        dest="list_extractors",
        action="store_true",
        help="List all supported extractors and exit",
    )
    general.add_argument(
        "--list-output-formats",
        dest="list_output_formats",
        action="store_true",
        help="List all supported output formats and exit",
    )

    session = parser.add_argument_group("Session Options")
    session.add_argument(
        "--timeout",
        metavar="SECONDS",
        dest="timeout",
        default="5",
        help="HTTP connection timeout",
    )
    session.add_argument(
        "-R",
        "--retries",
        metavar="N",
        dest="retries",
        default="4",
        help="Maximum number of retries for failed HTTP requests or -1 to retry infinitely (default: 4)",
    )
    session.add_argument(
        "--retry-sleep",
        metavar="SECONDS",
        dest="retry_sleep",
        default="1",
        help="Time to sleep between retries, in seconds (default: 1)",
    )
    session.add_argument(
        "--retry-sleep-multiplier",
        metavar="K",
        dest="retry_sleep_multiplier",
        default="2",
        help="A constant by which sleep time is multiplied on each retry (default: 2)",
    )
    session.add_argument(
        "--user-agent",
        metavar="UA",
        dest="user_agent",
        default=f"Forum-dl {__version__}",
        help="User-Agent request header",
    )

    output = parser.add_argument_group("Output Options")
    output.add_argument(
        "-q",
        "--quiet",
        dest="loglevel",
        default=logging.INFO,
        action="store_const",
        const=logging.ERROR,
        help="Activate quiet mode",
    )
    output.add_argument(
        "-v",
        "--verbose",
        dest="loglevel",
        action="store_const",
        const=logging.DEBUG,
        help="Print various debugging information",
    )
    output.add_argument(
        "-g",
        "--get-urls",
        dest="get_urls",
        action="store_true",
        help="Print URLs instead of downloading",
    )
    output.add_argument(
        "-o",
        "--output",
        metavar="OUTFILE",
        dest="output",
        default="-",
        help="Output all results concatenated to OUTFILE, or stdout if OUTFILE is - (default: -)",
    )
    output.add_argument(
        "-f",
        "--output-format",
        metavar="FORMAT",
        dest="output_format",
        default="jsonl",
        help="Output format. Use --list-output-formats for a list of possible arguments",
    )
    output.add_argument(
        "--warc-output",
        metavar="FILE",
        dest="warc_output",
        default="",
        help="Record HTTP requests, store them in FILE in WARC format",
    )
    output.add_argument(
        "--files-output",
        metavar="DIR",
        dest="files_output",
        default="",
        help="Store files in DIR instead of OUTFILE",
    )
    output.add_argument(
        "--boards",
        dest="boards",
        default=True,
        action=argparse.BooleanOptionalAction,
        help="Write board objects (default: True, --no-boards to negate)",
    )
    output.add_argument(
        "--threads",
        dest="threads",
        default=True,
        action=argparse.BooleanOptionalAction,
        help="Write thread objects (default: True, --no-threads to negate)",
    )
    output.add_argument(
        "--posts",
        dest="posts",
        default=True,
        action=argparse.BooleanOptionalAction,
        help="Write post objects (default: True, --no-posts to negate)",
    )
    output.add_argument(
        "--files",
        dest="files",
        default=True,
        action=argparse.BooleanOptionalAction,
        help="Write embedded files (--no-files to negate)",
    )
    output.add_argument(
        "--outside-files",
        dest="outside_files",
        default=False,
        action=argparse.BooleanOptionalAction,
        help="Write embedded files outside post content. Auto-enabled by --warc-output and -f warc (default: False, --no-outside-files to negate)",
    )
    output.add_argument(
        "--textify",
        dest="textify",
        action="store_true",
        help="Lossily convert HTML content to plaintext",
    )
    output.add_argument(
        "--content-as-title",
        dest="content_as_title",
        action="store_true",
        help="Write 98 initial characters of content in title field of each post",
    )
    output.add_argument(
        "--author-as-addr-spec",
        dest="author_as_addr_spec",
        action="store_true",
        help="Append author and domain as an addr-spec in the From header",
    )

    parser.add_argument(
        "urls",
        metavar="URL",
        nargs="*",
        help=argparse.SUPPRESS,
    )

    return parser
