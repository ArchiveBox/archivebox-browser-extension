"""Transient presentation writer; extraction and pagination belong to upstream."""
import json
import logging
import re
from forum_dl.exceptions import SearchError
from forum_dl import extractors
from forum_dl.extractors.common import ExtractorOptions
from forum_dl.writers.common import FileWriter, WriterOptions
from forum_dl.version import __version__


class PresentationWriter(FileWriter):
    def __init__(self, extractor, result, files=True):
        super().__init__(extractor, WriterOptions(
            output_path='-', files_output_path='', write_board_objects=True,
            write_thread_objects=True, write_post_objects=True,
            write_file_objects=files, write_outside_file_objects=files,
            textify=False, content_as_title=False, author_as_addr_spec=False))
        self.result = result

    def _serialize_entry(self, entry):
        # Original HTTP bodies and embedded bytes already exist in the WACZ.
        item = json.loads(entry.item.json(exclude={'content'} if entry.type == 'file' else set()))
        self.result[{'board': 'boards', 'thread': 'threads', 'post': 'posts', 'file': 'files'}[entry.type]].append(item)
        return ''


class Diagnostics(logging.Handler):
    def __init__(self, warnings):
        super().__init__(logging.WARNING)
        self.warnings = warnings

    def emit(self, record):
        message = record.getMessage()
        if re.match(r'^(TagSearchError|AttributeSearchError|PropertyError)\(', message):
            message = message.partition('(')[0] + ': required source element or attribute missing'
        elif message.startswith('Traceback (most recent call last):'):
            message = 'Upstream traceback: ' + '; '.join(re.findall(r'File [^\n]+', message))
        self.warnings.append(message)


def extract(session, url, files=True):
    result = dict(version=__version__, modules=extractors.modules, family='unsupported',
                  boards=[], threads=[], posts=[], files=[], warnings=[], complete=False)
    diagnostics = Diagnostics(result['warnings'])
    logging.getLogger().addHandler(diagnostics)
    try:
        # Identical order and detectors to extractors.find, with the supplied
        # requests transport rather than constructing a second Session.
        classes = list(extractors.list_classes())
        result['extractor_classes'] = [f'{cls.__module__}.{cls.__name__}' for cls in classes]
        extractor = next((obj for cls in classes
                          if (obj := cls.detect(session, url, ExtractorOptions(path=False)))), None)
        if extractor is None:
            result['error'] = 'Unsupported platform: no upstream detector matched'
            return result
        result['family'] = extractor.__class__.__module__.split('.')[-1]
        extractor.fetch()
        PresentationWriter(extractor, result, files).write(url)
        # Upstream catches some extraction errors. Keep those captures partial.
        failures = [warning for warning in result['warnings']
                    if not (warning.startswith('Item at post_id=') and warning.endswith(' is null'))]
        result['complete'] = not failures
        if failures:
            result['error'] = failures[0]
    except BaseException as error:
        detail = str(error.args[1:]) if isinstance(error, SearchError) else str(error)
        result['error'] = f'{type(error).__name__}: {detail}'
    finally:
        logging.getLogger().removeHandler(diagnostics)
    return result
