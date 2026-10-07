# from urllib.parse import urljoin

# from loguru import logger
from parse.parse import parse_ids_from_text


async def get_url(identifier):
    is_arxiv = parse_ids_from_text(identifier, ["arxiv"])
    if is_arxiv:
        pdf_url = f"https://arxiv.org/pdf/{identifier}.pdf"
        return pdf_url

    return None
