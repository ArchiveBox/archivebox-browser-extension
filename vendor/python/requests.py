"""Requests transport adapter over original recorder/WACZ response bytes.

Requests retains preparation, redirects, authentication, cookie handling and
streaming semantics. The injected transport owns actual capture/offline I/O.
"""
import io
from email.message import Message as HeadersMessage
from types import SimpleNamespace
import requests
from requests.adapters import BaseAdapter
from requests.cookies import extract_cookies_to_jar
from requests.structures import CaseInsensitiveDict
from pyodide.ffi import run_sync, to_js
from js import Object


class RecorderAdapter(BaseAdapter):
    def __init__(self, request):
        super().__init__()
        self._request = request

    def send(self, req, stream=False, timeout=None, verify=True, cert=None, proxies=None):
        if proxies or cert or verify is not True:
            raise requests.exceptions.InvalidSchema(
                'Browser transport does not support proxy, client certificate or TLS verification overrides')
        body = req.body
        if isinstance(body, str):
            body = body.encode()
        elif body is not None and not isinstance(body, (bytes, bytearray)):
            if hasattr(body, 'read'):
                body = body.read()
            else:
                body = b''.join(body)
        if isinstance(timeout, tuple):
            timeout = max(value for value in timeout if value is not None)
        try:
            result = run_sync(self._request(req.url, req.method,
                to_js(dict(req.headers), dict_converter=Object.fromEntries),
                to_js(body) if body is not None else None, timeout or 30)).to_py()
        except Exception as exc:
            raise requests.exceptions.ConnectionError(str(exc), request=req) from exc
        response = requests.Response()
        response.status_code = result['status']
        response.url = result['url']
        response.headers = CaseInsensitiveDict(result['headers'])
        response.encoding = requests.utils.get_encoding_from_headers(response.headers)
        response.reason = result.get('reason', '')
        response.request = req
        response.connection = self
        # Fetch already decoded HTTP transfer/content encoding. Requests must
        # not decode these bytes again; iter_content uses the consumed content.
        response._content = bytes(result['body'])
        response._content_consumed = True
        response.raw = io.BytesIO(response._content)
        headers = HeadersMessage()
        for key, value in response.headers.items():
            headers[key] = value
        response.raw._original_response = SimpleNamespace(msg=headers)
        extract_cookies_to_jar(response.cookies, req, response.raw)
        return response

    def close(self):
        pass

