"""Build the pinned engine plus audited source corrections outside the checkout."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='forum-dl-build-') as directory:
    source = Path(directory) / 'source'
    shutil.copytree(root / 'upstream', source, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'build', '*.egg-info'))
    for patch in sorted((root / 'patches').glob('*.patch')):
        subprocess.run(['patch', '-p1', '--batch', '-i', str(patch)], cwd=source, check=True)
    subprocess.run(['uv', 'build', '--wheel', '--out-dir', str(root.parents[1] / 'public/forum-dl'), str(source)], check=True)
