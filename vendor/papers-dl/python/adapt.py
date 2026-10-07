"""Explicit platform adaptations to pinned sources, applied before importing them.

No sys.modules replacements or monkeypatches: Requests and urllib use their real
adapter APIs. aiohttp-only I/O sites receive the recorder session explicitly.
"""
from pathlib import Path


def edit(filename, before, after):
    path = Path(filename)
    source = path.read_text()
    if before not in source:
        raise RuntimeError('Pinned source changed: ' + filename)
    path.write_text(source.replace(before, after))


root = '/papers-upstream/'
edit(root+'fetch/fetch.py', 'import aiohttp\n', '')
edit(root+'providers/scihub.py', 'import aiohttp\n', '')
edit(root+'providers/scihub.py', 'async def get_available_scihub_urls()', 'async def get_available_scihub_urls(session)')
edit(root+'providers/scihub.py', 'async with aiohttp.request("GET", "https://sci-hub.now.sh/") as res:\n            s = BeautifulSoup(await res.text(), "html.parser")',
     'res = await session.get("https://sci-hub.now.sh/")\n        s = BeautifulSoup(await res.text(), "html.parser")')
edit(root+'providers/scihub.py', 'await get_available_scihub_urls()', 'await get_available_scihub_urls(session)')
edit(root+'fetch/fetch.py', 'await scihub.get_available_scihub_urls()', 'await scihub.get_available_scihub_urls(session)')
edit(root+'providers/scihub.py', 'res.url.human_repr()', 'str(res.url)')
# Preserve response provenance: upstream zipped completion order with input order.
edit(root+'fetch/fetch.py', 'return (await res.read(), item[1])', 'return (await res.read(), str(res.url))')

site = '/lib/python3.13/site-packages/'
edit(site+'pdf2doi/finders.py', 'import requests\n', 'import archivebox_papers_network as requests\n')
# MuPDF's real WASM structured-text walker supplies spans to the unchanged
# font-counting/title algorithm. It is not an emulation of the fitz API.
edit(site+'pdf2doi/find_title_via_pymupdf.py', 'import fitz',
     'import json\nfrom archivebox_papers_io import mupdf_spans\nfrom pyodide.ffi import to_js')
edit(site+'pdf2doi/find_title_via_pymupdf.py', "blocks = page.get_text('dict')['blocks']", "blocks = page['blocks']")
edit(site+'pdf2doi/find_title_via_pymupdf.py', 'blocks = page.get_text("dict")["blocks"]', 'blocks = page["blocks"]')
edit(site+'pdf2doi/find_title_via_pymupdf.py', 'doc = fitz.open(file)',
     'position = file.tell()\n    file.seek(0)\n    doc = json.loads(mupdf_spans(to_js(file.read())))\n    file.seek(position)')
# The recorder must settle every already-started original before WACZ sealing.
edit(root+'fetch/fetch.py', 'tasks = [get_wrapper(url) for url in urls if url]',
     'tasks = [asyncio.create_task(get_wrapper(url)) for url in urls if url]')
edit(root+'fetch/fetch.py', 'return (await res.read(), str(res.url))',
     'await asyncio.gather(*tasks, return_exceptions=True)\n        return (await res.read(), str(res.url))')
# feedparser builds its own urllib opener, bypassing the installed handler;
# pass the real parser our handler through its documented handlers API.
edit(site+'pdf2doi/finders.py', 'result = feedparser.parse(url)',
     'result = feedparser.parse(url, handlers=[requests.RecorderURLHandler()])')
