"""Bounded pypdf text / Poppler page-image worker. Runs inside the existing Linux bwrap carrier."""
import json
import sys
import warnings
import subprocess
import tempfile
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from pypdf import PdfReader
from pypdf.errors import LimitReachedError

warnings.filterwarnings('ignore')
MAX_PAGES = 500
MAX_PAGE_CHARS = 4000


def extract(page, number, limit):
    try:
        text = page.extract_text() or ''
        return {'page': number, 'text': text[:limit], 'truncated': len(text) > limit,
                'needsImage': not text.strip(), 'status': 1}
    except (MemoryError, LimitReachedError):
        raise
    except Exception:
        return {'page': number, 'text': '', 'status': 3, 'error': 'page-unreadable'}


def main():
    request = json.loads(sys.argv[3])
    try:
        reader = PdfReader(sys.argv[2], strict=False)
        if reader.is_encrypted:
            return {'status': 3, 'error': 'encrypted'}
        count = len(reader.pages)
        if count > MAX_PAGES:
            return {'status': 3, 'error': 'page-limit', 'pageCount': count}
        if request['mode'] == 'info':
            selected = [1] if count else []
            limit = 1000
        else:
            selected = request['pages']
            if any(page > count for page in selected):
                return {'status': 3, 'error': 'invalid-pages', 'pageCount': count}
            limit = MAX_PAGE_CHARS
        if request['mode'] == 'render':
            pages = []
            for number in selected:
                target = Path(sys.argv[2]).parent / f'page-{number}.png'
                with target.open('wb') as output, tempfile.TemporaryFile() as diagnostics:
                    rendered = subprocess.run(['/usr/bin/pdftoppm', '-f', str(number), '-l', str(number),
                        '-singlefile', '-scale-to', '1600', '-png', sys.argv[2]],
                        stdout=output, stderr=diagnostics)
                    warned = diagnostics.tell() > 0
                size = target.stat().st_size
                if rendered.returncode < 0:
                    pages.append({'page': number, 'status': 3, 'error': 'resource-limit'})
                elif rendered.returncode != 0 or not size:
                    pages.append({'page': number, 'status': 3, 'error': 'page-unreadable'})
                elif warned:
                    pages.append({'page': number, 'status': 2, 'warning': 'renderer-warning'})
                else:
                    pages.append({'page': number, 'status': 1})
        else:
            pages = [extract(reader.pages[number - 1], number, limit) for number in selected]
        failed = sum(page['status'] == 3 for page in pages)
        return {'status': 3 if failed and failed == len(pages) else (2 if any(page['status'] != 1 for page in pages) else 1),
                'pageCount': count, 'pages': pages,
                'scope': 'Only returned pages were read. Empty pages may require image reading.'}
    except FileNotFoundError:
        return {'status': 3, 'error': 'renderer-unavailable'}
    except (MemoryError, LimitReachedError):
        return {'status': 3, 'error': 'resource-limit'}
    except Exception:
        return {'status': 3, 'error': 'damaged'}


print(json.dumps(main(), ensure_ascii=True))
