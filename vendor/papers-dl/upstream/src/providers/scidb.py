from urllib.parse import urljoin

from loguru import logger
from parse.parse import find_pdf_url, parse_ids_from_text


async def get_url(session, identifier):
    base_url = "https://annas-archive.org/scidb/"
    # TODO: add support for .se and .li base_urls

    is_doi = parse_ids_from_text(identifier, ["doi"])
    if is_doi:
        url = urljoin(base_url, identifier)
        logger.info("searching SciDB: {}", url)
        try:
            res = await session.get(url)
        except Exception as e:
            logger.error("Couldn't connect to SciDB: {}", e)
            return None
        pdf_url = find_pdf_url(await res.read())
        if pdf_url is None:
            logger.info("No direct link to PDF found from SciDB")
        return pdf_url

    return None
