import json
import re

from bs4 import BeautifulSoup
from loguru import logger


# from https://isbn-checker.netlify.app
def valid_isbn(subject):
    "Check if the subject is a valid ISBN"

    isbn_regex = re.compile(
        r"^(?:ISBN(?:-1[03])?:? )?(?=[0-9X]{10}$|(?=(?:[0-9]+[- ]){3})[- 0-9X]{13}$|97[89][0-9]{10}$|(?=(?:[0-9]+[- ]){4})[- 0-9]{17}$)(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9X]$"
    )

    # Check if the subject matches the ISBN pattern
    if isbn_regex.match(subject):
        chars = re.sub(r"[- ]|^ISBN(?:-1[03])?:?", "", subject)
        chars = list(chars)
        last = chars.pop()
        sum = 0
        check = 0

        if len(chars) == 9:
            chars.reverse()
            for i in range(len(chars)):
                sum += (i + 2) * int(chars[i])
            check = 11 - (sum % 11)
            if check == 10:
                check = "X"
            elif check == 11:
                check = "0"
        else:
            for i in range(len(chars)):
                sum += (i % 2 * 2 + 1) * int(chars[i])
            check = 10 - (sum % 10)
            if check == 10:
                check = "0"

        if str(check) == last:
            return True
        else:
            return False
    else:
        return False


# these are the currently supported identifier types that we can parse, along
# with their regex patterns
id_patterns = {
    # These come from https://gist.github.com/oscarmorrison/3744fa216dcfdb3d0bcb
    "isbn": [
        r"(?:ISBN(?:-10)?:?\ )?(?=[0-9X]{10}|(?=(?:[0-9]+[-\ ]){3})[-\ 0-9X]{13})[0-9]{1,5}[-\ ]?[0-9]+[-\ ]?[0-9]+[-\ ]?[0-9X]",
        r"(?:ISBN(?:-13)?:?\ )?(?=[0-9]{13}|(?=(?:[0-9]+[-\ ]){4})[-\ 0-9]{17})97[89][-\ ]?[0-9]{1,5}[-\ ]?[0-9]+[-\ ]?[0-9]+[-\ ]?[0-9]",
    ],
    # doi regexes taken from https://www.crossref.org/blog/dois-and-matching-regular-expressions/
    # listed in decreasing order of goodness. Not fully tested yet.
    "doi": [
        r"10.\d{4,9}\/[-._;()\/:A-Z0-9]+",
        r"10.1002\/[^\s]+",
        r"10.\d{4}\/\d+-\d+X?(\d+)\d+<[\d\w]+:[\d\w]*>\d+.\d+.\w+;\d",
        r"10.1021\/\w\w\d++",
        r"10.1207/[\w\d]+\&\d+_\d+",
    ],
    # arXiv ids: https://info.arxiv.org/help/arxiv_identifier.html
    "arxiv": [
        # identifiers since March 2007
        r"arXiv:\d{4}\.\d{4,5}(v\d+)?",
        # identifiers before March 2007
        r"arXiv:[A-Za-z-]{3,10}(\.[A-Z]{2})?\/\d{4,8}",
    ],
}

# these can eliminate false positives
# TODO: remove duplication of validation logic and parsing logic
id_validators = {
    "isbn": valid_isbn,
}


def find_pdf_url(html_content) -> str | None:
    "Given HTML content, find an embedded link to a PDF."

    s = BeautifulSoup(html_content, "html.parser")

    # look for a dynamically loaded PDF
    script_element = s.find("script", string=re.compile("PDFObject.embed"))

    if script_element:
        match = re.search(r'PDFObject\.embed\("([^"]+)"', script_element.string)
        if match:
            return match.group(1)

    # look for the "<embed>" element (scihub)
    embed_element = s.find("embed", {"id": "pdf", "type": "application/pdf"})

    if embed_element:
        direct_url = embed_element["src"]
        if isinstance(direct_url, list):
            direct_url = direct_url[0]
        if direct_url:
            return direct_url

    # look for an iframe
    iframe = s.find("iframe", {"type": "application/pdf"})

    if iframe:
        logger.info(f"found iframe: {iframe}")
        direct_url = iframe.get("src")
        if isinstance(direct_url, list):
            direct_url = direct_url[0]
        if direct_url:
            return direct_url

    return None


def parse_ids_from_text(
    s: str, id_types: list[str] | None = None
) -> list[dict[str, str]]:
    """
    Find all matches for the given id types in a string. If id_types isn't
    given, it will parse all the types in id_patterns by default.
    """

    # we look for all ID patterns by default
    if id_types is None:
        id_types = list(id_patterns)

    seen = set()
    matches = []
    for id_type in id_types:
        validator = id_validators.get(id_type)
        for regex in id_patterns[id_type]:
            for match in re.finditer(regex, s, re.IGNORECASE):
                mg = match.group()
                valid_id = validator(mg) if validator else True
                if mg not in seen and valid_id:
                    matches.append({"id": mg, "type": id_type})
                seen.add(mg)
    return matches


def parse_file(path, id_types: list[str] | None = None):
    """
    Find all matches for the given id types in a file. If id_types isn't given,
    defaults to the types in id_patterns.
    """

    matches = []
    try:
        with open(path) as f:
            content = f.read()
        matches = parse_ids_from_text(content, id_types)
    except Exception as e:
        print(f"Error: {e}")

    return matches


def format_output(output: list[dict[str, str]], format: str = "raw") -> str:
    """
    Formats a list of dicts of ids and id types into a string according to the
    given format type. 'raw' formats ids by line, ignoring type. 'jsonl' and
    'csv' formats ids and types.
    """

    lines: list[str] = []
    if format == "raw":
        lines = [line["id"] for line in output]
    elif format == "jsonl":
        lines = [json.dumps(line) for line in output]
    elif format == "csv":
        lines = [f"{line['id']},{line['type']}" for line in output]
    else:
        raise Exception(f"invalid format {format}")
    return "\n".join(lines)
