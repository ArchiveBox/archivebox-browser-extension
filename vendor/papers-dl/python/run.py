"""Runs pinned papers-dl functions; ephemeral files never enter the archive."""
import json
import os
from fetch import fetch
from parse.parse import parse_ids_from_text, format_output
from archivebox_papers_network import RecorderSession
from loguru import logger
from archivebox_papers_io import log
import pdf2doi

logger.remove()
logger.add(lambda msg: log(str(msg)), format='{message}', level='INFO')

async def acquire(identifier, providers, user_agent=''):
    headers = {'User-Agent': user_agent} if user_agent else None
    result = await fetch.fetch(RecorderSession(headers), identifier, providers)
    if result is None:
        return json.dumps({'found': False})
    content, url = result
    # Preserve original bytes: native pdf2doi rewrites PDF metadata by default.
    # The ephemeral input is only used for lookup; WARC always owns originals.
    filename = fetch.generate_name(content)
    os.makedirs('/papers', exist_ok=True)
    path = '/papers/' + filename
    fetch.save(content, path)
    pdf2doi.config.set('save_identifier_metadata', False)
    renamed = fetch.rename('/papers', path)
    os.remove(renamed)
    return json.dumps({'found': True, 'url': url, 'size': len(content),
                       'filename': os.path.basename(renamed)})


def describe(content):
    os.makedirs('/papers', exist_ok=True)
    filename = fetch.generate_name(content)
    path = '/papers/' + filename
    fetch.save(content, path)
    pdf2doi.config.set('save_identifier_metadata', False)
    pdf2doi.config.set('verbose', False)
    result = pdf2doi.pdf2doi(path)
    os.remove(path)
    return json.dumps({'filename': filename, 'inference': result}, default=str)


def parse(text, match=None, format='jsonl'):
    return format_output(parse_ids_from_text(text, match), format)
