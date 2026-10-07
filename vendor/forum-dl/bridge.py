"""requests' supported adapter boundary, shared recorder instead of sockets."""
import json
from archivebox_transport import request
from archivebox_requests import RecorderAdapter
from forum_dl.session import Session, SessionOptions
from forum_dl.version import __version__
from archivebox_forum_pipeline import extract




def archivebox_extract(url, timeout, files):
    session = Session(SessionOptions(timeout=timeout, retries=1, retry_sleep=0,
        retry_sleep_multiplier=1, warc_output='', user_agent=f'forum-dl/{__version__}', get_urls=False))
    session._session.adapters.clear()
    session._session.mount('http://', RecorderAdapter(request))
    session._session.mount('https://', RecorderAdapter(request))
    return json.dumps(extract(session, url, files))
