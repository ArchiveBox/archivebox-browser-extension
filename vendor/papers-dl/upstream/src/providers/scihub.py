import asyncio
import enum
import re
from urllib.parse import urljoin

import aiohttp
from bs4 import BeautifulSoup
from loguru import logger
from parse.parse import find_pdf_url

# URL-DIRECT - openly accessible paper
# URL-NON-DIRECT - pay-walled paper
# PMID - PubMed ID
# DOI - digital object identifier
IDClass = enum.Enum("identifier", ["URL-DIRECT", "URL-NON-DIRECT", "PMD", "DOI"])

DEFAULT_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15"


class IdentifierNotFoundError(Exception):
    pass


async def get_available_scihub_urls() -> list[str]:
    """
    Finds available Sci-Hub urls via https://sci-hub.now.sh/
    """

    # NOTE: This misses some valid URLs. Alternatively, we could parse
    # the HTML more finely by navigating the parsed DOM, instead of relying
    # on filtering. That might be more brittle in case the HTML changes.
    # Generally, we don't need to get all URLs.
    scihub_domain = re.compile(r"^http[s]*://sci.hub", flags=re.IGNORECASE)
    urls = []

    try:
        async with aiohttp.request("GET", "https://sci-hub.now.sh/") as res:
            s = BeautifulSoup(await res.text(), "html.parser")
    except Exception as e:
        logger.info("Couldn't find Sci-Hub URLs: {}", e)
        return []

    text_matches = s.find_all(
        "a",
        href=True,
        string=re.compile(scihub_domain),
    )

    href_matches = s.find_all(
        "a",
        re.compile(scihub_domain),
        href=True,
    )

    full_match_set = set(text_matches) | set(href_matches)
    for a in full_match_set:
        if "sci" in a or "sci" in a["href"]:
            urls.append(a["href"])

    return urls


async def get_direct_urls(
    session,
    identifier: str,
    base_urls: list[str] | None = None,
) -> list[str]:
    """
    Finds the direct source url for a given identifier.
    """

    if base_urls is None:
        base_urls = await get_available_scihub_urls()

    logger.info("searching Sci-Hub urls: {}", base_urls)

    # catch exceptions so that they don't cancel the task group
    async def get_wrapper(url):
        try:
            return await session.get(url)
        except Exception as e:
            logger.info("Couldn't connect to {}: {}", url, e)
            return None

    if classify(identifier) == IDClass["URL-DIRECT"]:
        return [identifier]

    async with asyncio.TaskGroup() as tg:
        tasks = [
            tg.create_task(get_wrapper(urljoin(base_url, identifier)))
            for base_url in base_urls
        ]

    direct_urls = []
    try:
        for task in tasks:
            res = await task
            if res is None:
                continue
            path = find_pdf_url(await res.text())
            if isinstance(path, list):
                path = path[0]
            if isinstance(path, str) and path.startswith("//"):
                direct_urls.append("https:" + path)
            elif isinstance(path, str) and path.startswith("/"):
                direct_urls.append(urljoin(res.url.human_repr(), path))

    except Exception as err:
        logger.error("Error while looking for PDF urls: {}", err)

    if not direct_urls:
        logger.info("No direct link to PDF found from Sci-Hub")

    return list(set(direct_urls))


def classify(identifier) -> IDClass:
    """
    Classify the type of identifier:
    url-direct - openly accessible paper
    url-non-direct - pay-walled paper
    pmid - PubMed ID
    doi - digital object identifier
    """
    if identifier.startswith("http") or identifier.startswith("https"):
        if identifier.endswith("pdf"):
            return IDClass["URL-DIRECT"]
        else:
            return IDClass["URL-NON-DIRECT"]
    elif identifier.isdigit():
        return IDClass["PMID"]
    else:
        return IDClass["DOI"]
