"""Run unmodified gallery-dl extractors using Requests' public transport API.

The subclass only mounts a transport and replaces blocking sleep with JSPI.
Site parsing, configuration, predicates and queue dispatch remain upstream.
"""
import json
import logging
from pyodide.ffi import run_sync
from archivebox_requests import RecorderAdapter
from archivebox_transport import request, log, sleep
from gallery_dl import config, extractor, job, output, util, version




adapter = RecorderAdapter(request)


class RecorderExtractor:
    def request(self, url, method='GET', session=None, **kwargs):
        current = self.session if session is None else session
        current.mount('https://', adapter)
        current.mount('http://', adapter)
        return super().request(url, method=method, session=current, **kwargs)

    def sleep(self, seconds, reason):
        self.log.debug('Sleeping %.2f seconds (%s)', seconds, reason)
        run_sync(sleep(seconds))


classes = {}
errors = []
acquire_originals = False
file_count = 0


class RecorderDataJob(job.DataJob):
    def __init__(self, url, parent=None, file=None, ensure_ascii=True, resolve=True):
        original = extractor.find(url) if isinstance(url, str) else url
        if original is not None and not isinstance(original, RecorderExtractor):
            base = original.__class__
            cls = classes.get(base)
            if cls is None:
                cls = classes[base] = type(base.__name__, (RecorderExtractor, base), {})
            original = cls(original.match)
        super().__init__(original, parent, file, ensure_ascii, resolve)

    def run(self):
        super().run()
        if self.exception is not None:
            errors.append(f'{self.extractor.category}: {type(self.exception).__name__}: {self.exception}')
        return 1 if self.exception is not None else 0

    def handle_url(self, url, metadata):
        global file_count
        super().handle_url(url, metadata)
        if not acquire_originals:
            return
        if not url.startswith(('http://', 'https://')):
            raise RuntimeError(f'Original requires a native downloader or assembly: {url}')
        # Preserve the extractor's session/auth and per-file request overrides.
        # The payload is recorded by the host; no filesystem mirror is created.
        headers = {'Accept': '*/*', **metadata.get('_http_headers', {})}
        response = self.extractor.request(url, method=metadata.get('_http_method', 'GET'),
                                          headers=headers, data=metadata.get('_http_data'))
        response.raise_for_status()
        file_count += 1


def extract(url, configuration, download):
    global acquire_originals, file_count, errors
    config.clear()
    for key, value in json.loads(configuration).items():
        config.set((), key, value)
    # Persistent native state is neither an input nor output of this runtime.
    config.set((), 'cache', {'file': ':memory:'})
    acquire_originals, file_count, errors = download, 0, []
    output.initialize_logging(logging.INFO)
    available = extractor.extractors()
    chosen = extractor.find(url)
    if chosen is None:
        return json.dumps({'version': version.__version__, 'extractorCount': len(available),
                           'supported': False, 'messages': [], 'errors': [], 'files': 0})
    task = RecorderDataJob(chosen)
    task.run()
    messages = []
    for message in task.data:
        if message[0] == 2:
            messages.append({'type': 'directory', 'metadata': message[1]})
        elif message[0] in (3, 6):
            if message[0] == 6:
                errors.append(f'Unresolved queued URL (unsupported extractor or upstream recursion limit): {message[1]}')
            messages.append({'type': 'url' if message[0] == 3 else 'queue',
                             'url': message[1], 'metadata': message[2]})
    return json.dumps({'version': version.__version__, 'extractorCount': len(available),
                       'supported': True, 'extractor': chosen.__class__.__name__,
                       'messages': messages, 'errors': errors, 'files': file_count},
                      default=util.json_default)
