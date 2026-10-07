"""Upstream yt-dlp network backend for the shared WACZ recorder (Pyodide JSPI)."""
import io
import json
from pyodide.ffi import run_sync, to_js
from js import Object
from archivebox_transport import request, log, solve
from yt_dlp import YoutubeDL
from yt_dlp.networking.common import RequestHandler, Response
from yt_dlp.networking.exceptions import HTTPError, TransportError
from yt_dlp.version import __version__
from yt_dlp.utils.networking import std_headers
from yt_dlp.utils import DownloadError, UnsupportedError


class ArchiveRecorderRH(RequestHandler):
    RH_NAME = 'ArchiveBox recorder'
    _SUPPORTED_URL_SCHEMES = ('http', 'https')

    def _check_extensions(self, extensions):
        super()._check_extensions(extensions)
        extensions.pop('timeout', None)
        extensions.pop('cookiejar', None)

    def _send(self, req):
        try:
            result = run_sync(request(req.url, req.method,
                to_js(self._get_headers(req), dict_converter=Object.fromEntries),
                to_js(req.data) if req.data is not None else None,
                self._calculate_timeout(req))).to_py()
        except Exception as exc:
            raise TransportError(str(exc)) from exc
        response = Response(io.BytesIO(bytes(result['body'])), result['url'],
                            result['headers'], result['status'])
        if not 200 <= response.status < 300:
            raise HTTPError(response)
        return response


class RecorderYoutubeDL(YoutubeDL):
    def build_request_director(self, handlers, preferences=None):
        # The supported extension point guarantees all extractor HTTP requests
        # use the recorder; native sockets cannot silently bypass the archive.
        return super().build_request_director([ArchiveRecorderRH], [])


from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
from yt_dlp.extractor.youtube.jsc.provider import register_provider, register_preference


@register_provider
class BrowserJCP(EJSBaseJCP):
    PROVIDER_NAME = 'archivebox'
    JS_RUNTIME_NAME = 'archivebox'

    def is_available(self):
        return self._available

    def _run_js_runtime(self, source):
        return run_sync(solve(source))


@register_preference(BrowserJCP)
def browser_preference(*_):
    return 2000


class Logger:
    def debug(self, message):
        log(message)
    info = debug
    warning = debug
    error = debug


def extract(url, playlist_limit, user_agent, format_selector):
    user_agent = user_agent or std_headers['User-Agent']
    with RecorderYoutubeDL({
        'logger': Logger(), 'cachedir': False, 'noprogress': True,
        'skip_download': True, 'writesubtitles': True,
        # Replay has upstream FFmpeg WASM for a lossless transient merge. Do not
        # let absence of a native executable downgrade upstream format selection.
        'format': format_selector,
        'writeautomaticsub': True, 'subtitleslangs': ['all'],
        'playlistend': playlist_limit, 'extractor_retries': 0,
        'retries': 0, 'socket_timeout': 30,
        'js_runtimes': {}, 'remote_components': [],
        'http_headers': {'User-Agent': user_agent},
    }) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except DownloadError as error:
            # Preserve upstream's typed applicability result. Network failures,
            # authentication errors and incomplete supported media still fail.
            if error.exc_info and isinstance(error.exc_info[1], UnsupportedError):
                return json.dumps({'version': __version__, 'userAgent': user_agent, 'supported': False, 'info': None})
            raise
        return json.dumps({'version': __version__, 'userAgent': user_agent, 'supported': True, 'info': ydl.sanitize_info(info)})
