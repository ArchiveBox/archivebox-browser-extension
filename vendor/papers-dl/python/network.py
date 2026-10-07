"""Real HTTP adapter: Requests/urllib supported handlers and async recorder session.

Only this I/O layer knows about JavaScript. All site bytes come from the WACZ
transport; no Python socket or browser fetch can bypass the recorder.
"""
import io
from http.client import responses as status_phrases
import urllib.request
import urllib.response
from urllib.parse import urljoin
from email.message import Message
from pyodide.ffi import run_sync, to_js
from js import Object
from archivebox_papers_io import request, log
import requests
from archivebox_requests import RecorderAdapter


def send(url, method='GET', headers=None, body=None, timeout=30):
    log(f'papers-dl HTTP: {method} {url}')
    try:
        result = run_sync(request(str(url), method,
            to_js(dict(headers or {}), dict_converter=Object.fromEntries),
            to_js(body) if body is not None else None, timeout)).to_py()
    except Exception as exc:
        log(f'papers-dl HTTP failed: {method} {url}: {exc}')
        raise
    result['body'] = bytes(result['body'])
    return result




session = requests.Session()
session.mount('http://', RecorderAdapter(request))
session.mount('https://', RecorderAdapter(request))
get = session.get


class RecorderURLHandler(urllib.request.BaseHandler):
    # Use urllib's documented handler extension point for google/feedparser.
    handler_order = 100

    def http_open(self, req):
        result = send(req.full_url, req.get_method(), req.headers, req.data)
        headers = Message()
        for key, value in result['headers'].items():
            headers[key] = value
        response = urllib.response.addinfourl(io.BytesIO(result['body']), headers,
                                              result['url'], result['status'])
        response.msg = status_phrases.get(result['status'], '')
        response.reason = response.msg
        return response

    https_open = http_open


urllib.request.install_opener(urllib.request.build_opener(RecorderURLHandler()))


class RecorderResponse:
    def __init__(self, result):
        from urllib.parse import urlparse
        self.result = result
        self.url = result['url']
        self.content_type = next((v for k, v in result['headers'].items()
                                  if k.lower() == 'content-type'), '').split(';')[0].strip().lower()

    async def read(self):
        return self.result['body']

    async def text(self):
        # Use Requests' response encoding machinery, matching HTTP charsets.
        response = requests.Response()
        response._content = self.result['body']
        response.headers.update(self.result['headers'])
        response.encoding = requests.utils.get_encoding_from_headers(response.headers)
        return response.text


class RecorderSession:
    # papers-dl pins aiohttp 3.9.5 and constructs ClientSession without a
    # timeout override. Its DEFAULT_TIMEOUT applies 300 seconds to the complete
    # response, including the PDF body; a 30-second transport default truncates
    # larger papers that the native CLI downloads successfully.
    timeout = 300

    def __init__(self, headers=None):
        self.headers = headers or {}

    async def get(self, url):
        # aiohttp GET follows redirects with max_redirects=10. Live browser Fetch
        # may already have followed them; reused original navigation records may
        # expose the original redirect, whose target must also come from WACZ.
        for _ in range(10):
            result = (await request(str(url), 'GET', to_js(self.headers, dict_converter=Object.fromEntries), None, self.timeout)).to_py()
            result['body'] = bytes(result['body'])
            location = next((value for key, value in result['headers'].items()
                             if key.lower() == 'location'), None)
            if result['status'] not in (301, 302, 303, 307, 308) or not location:
                return RecorderResponse(result)
            url = urljoin(result['url'], location)
        raise requests.TooManyRedirects('papers-dl GET exceeded 10 redirects')
