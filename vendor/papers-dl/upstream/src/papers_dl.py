import argparse
import asyncio
import os
import sys

import aiohttp
from loguru import logger
from fetch import fetch
from parse.parse import format_output, id_patterns, parse_file, parse_ids_from_text


async def fetch_paper(args) -> str:
    providers = args.providers
    id = args.query
    out = args.output

    headers = None
    if args.user_agent is not None:
        headers = {
            "User-Agent": args.user_agent,
        }

    async with aiohttp.ClientSession(headers=headers) as sess:
        result = await fetch.fetch(sess, id, providers)

    if result is None:
        return None

    pdf_content, url = result

    path = os.path.join(out, fetch.generate_name(pdf_content))
    fetch.save(pdf_content, path)
    new_path = fetch.rename(out, path)
    return f"Successfully downloaded paper from {url}.\n Saved to {new_path}"


def parse_ids(args) -> str:
    output = None
    if hasattr(args, "path") and args.path:
        output = parse_file(args.path, args.match)
    else:
        # if a path isn't passed or is empty, read from stdin
        output = parse_ids_from_text(sys.stdin.read(), args.match)
    return format_output(output, args.format)


async def run():
    name = "papers-dl"
    parser = argparse.ArgumentParser(
        prog=name,
        description="Download scientific papers from the command line",
    )

    from version import __version__

    parser.add_argument(
        "--version", "-V", action="version", version=f"{name} {__version__}"
    )

    parser.add_argument(
        "--verbose", "-v", action="store_true", help="increase verbosity"
    )

    subparsers = parser.add_subparsers()

    # FETCH
    parser_fetch = subparsers.add_parser(
        "fetch", help="try to download a paper with the given identifier"
    )

    parser_fetch.add_argument(
        "query",
        metavar="(DOI|PMID|URL)",
        type=str,
        help="the identifier to try to download",
    )

    parser_fetch.add_argument(
        "-o",
        "--output",
        metavar="path",
        help="optional output directory for downloaded papers",
        default=".",
        type=str,
    )

    parser_fetch.add_argument(
        "-p",
        "--providers",
        help="comma separated list of providers to try fetching from",
        default="all",
        type=str,
    )

    parser_fetch.add_argument(
        "-A",
        "--user-agent",
        help="",
        default=None,
        type=str,
    )

    # PARSE
    parser_parse = subparsers.add_parser(
        "parse", help="parse identifiers from a file or stdin"
    )
    parser_parse.add_argument(
        "-m",
        "--match",
        metavar="type",
        help="the type of identifier to search for",
        type=str,
        choices=id_patterns.keys(),
        action="append",
    )
    parser_parse.add_argument(
        "-p",
        "--path",
        help="the path of the file to parse",
        type=str,
    )
    parser_parse.add_argument(
        "-f",
        "--format",
        help="the output format for printing",
        metavar="fmt",
        default="raw",
        choices=["raw", "jsonl", "csv"],
        nargs="?",
    )

    parser_fetch.set_defaults(func=fetch_paper)
    parser_parse.set_defaults(func=parse_ids)

    args = parser.parse_args()

    logger.remove(0)
    if args.verbose:
        logger.add(sys.stderr, level="INFO", enqueue=True, format="{message}")
    else:
        logger.add(sys.stderr, level="ERROR", enqueue=True, format="{message}")

    if hasattr(args, "func"):
        if asyncio.iscoroutinefunction(args.func):
            result = await args.func(args)
        else:
            result = args.func(args)

        if result:
            print(result)
        else:
            # TODO: change this to be more general
            print("No papers found")
    else:
        parser.print_help()


def main():
    asyncio.run(run())


if __name__ == "__main__":
    asyncio.run(run())
