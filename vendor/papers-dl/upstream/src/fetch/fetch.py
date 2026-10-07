import asyncio
import hashlib
import json
import os
from typing import Iterable

import aiohttp
import pdf2doi
import providers.scidb as scidb
import providers.scihub as scihub
import providers.arxiv as arxiv
from loguru import logger

all_providers = ["scihub", "scidb", "arxiv"]


def match_available_providers(
    providers, available_providers: Iterable[str] | None = None
) -> list[str]:
    "Find the providers that are included in available_providers"
    if not available_providers:
        available_providers = all_providers
    matching_providers = []
    for provider in providers:
        for available_provider in available_providers:
            # a user-supplied provider might be a substring of a supported
            # provider (e.g. sci-hub.ee instead of https://sci-hub.ee)
            if provider in available_provider:
                matching_providers.append(available_provider)
    return matching_providers


async def get_urls(session, identifier, providers):
    urls = []
    if providers == "all":
        urls.append(await scidb.get_url(session, identifier))
        urls.extend(await scihub.get_direct_urls(session, identifier))
        urls.append(await arxiv.get_url(identifier))
        return urls

    providers = [provider.strip() for provider in providers.split(",")]
    logger.info(f"given providers: {providers}")

    matching_providers = match_available_providers(providers)
    logger.info(f"matching providers: {matching_providers}")
    for mp in matching_providers:
        if mp == "scihub":
            urls.extend(await scihub.get_direct_urls(session, identifier))
        if mp == "scidb":
            urls.append(await scidb.get_url(session, identifier))
        if mp == "arxiv":
            urls.append(await arxiv.get_url(identifier))

    # if the catch-all "scihub" provider isn't given, we look for
    # specific Sci-Hub urls. if we find specific Sci-Hub URLs in the
    # user input, we only use those
    if "scihub" not in providers:
        matching_scihub_urls = match_available_providers(
            providers, await scihub.get_available_scihub_urls()
        )
        logger.info(f"matching scihub urls: {matching_scihub_urls}")
        if len(matching_scihub_urls) > 0:
            urls.extend(
                await scihub.get_direct_urls(
                    session, identifier, base_urls=matching_scihub_urls
                )
            )

    return urls


async def fetch(session, identifier, providers) -> tuple | None:
    # catch exceptions so that they don't cancel the task group
    async def get_wrapper(url):
        try:
            return await session.get(url)
        except Exception as e:
            logger.error("error: {}", e)
            return None

    urls = await get_urls(session, identifier, providers)

    urls = [url for url in urls if url is not None]

    if len(urls) > 0:
        logger.info("PDF urls: {}", "\n".join(urls))
    tasks = [get_wrapper(url) for url in urls if url]
    for item in zip(asyncio.as_completed(tasks), urls):
        res = await item[0]
        if res is None or res.content_type != "application/pdf":
            logger.info("couldn't find url at {}", item[1])
            continue
        return (await res.read(), item[1])
    return None


def save(data, path):
    """
    Save a file give data and a path.
    """
    try:
        logger.info(f"Saving file to {path}")

        with open(path, "wb") as f:
            f.write(data)
    except Exception as e:
        logger.error(f"Failed to write to {path} {e}")
        raise e


def generate_name(content):
    "Generate unique filename for paper"

    pdf_hash = hashlib.md5(content).hexdigest()
    return f"{pdf_hash}" + ".pdf"


def rename(out_dir, path, name=None) -> str:
    """
    Renames a PDF to either the given name or its appropriate title, if
    possible. Adds the PDF extension. Returns the new path if renaming was
    successful, or the original path if not.
    """

    logger.info("Finding paper title")
    pdf2doi.config.set("verbose", False)

    try:
        if name is None:
            result_info = pdf2doi.pdf2doi(path)
            if not result_info:
                return path
            raw_validation_info = result_info["validation_info"]
            if isinstance(raw_validation_info, (str, bytes, bytearray)):
                validation_info = json.loads(raw_validation_info)
            else:
                validation_info = raw_validation_info
            name = validation_info.get("title")

        if name:
            name += ".pdf"
            new_path = os.path.join(out_dir, name)
            os.rename(path, new_path)
            logger.info(f"File renamed to {new_path}")
            return new_path
        else:
            return path
    except Exception as e:
        logger.error(f"Couldn't get paper title from PDF at {path}: {e}")
        return path
