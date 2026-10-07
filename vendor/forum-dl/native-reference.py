"""Run the pinned corpus natively for live browser/native acceptance comparison."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'public/forum-dl/forum_dl-0.3.0-py3-none-any.whl'))
from pipeline import extract
from forum_dl.session import Session, SessionOptions

session = Session(SessionOptions(timeout=20, retries=1, retry_sleep=0,
    retry_sleep_multiplier=1, warc_output='', user_agent='forum-dl/0.3.0', get_urls=False))
result = extract(session, sys.argv[1], files=True)
Path(sys.argv[2]).write_text(json.dumps(result))
print(json.dumps({key: len(value) if key in ('boards', 'threads', 'posts', 'files') else value
                  for key, value in result.items() if key != 'warnings'}))
