"""Bounded pypdf text worker. Runs inside the existing Linux bwrap carrier."""
import json
import sys
import warnings

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
        pages = [extract(reader.pages[number - 1], number, limit) for number in selected]
        return {'status': 2 if any(page['status'] == 3 for page in pages) else 1,
                'pageCount': count, 'pages': pages,
                'scope': 'Only returned pages were read. Empty pages may require image reading.'}
    except (MemoryError, LimitReachedError):
        return {'status': 3, 'error': 'resource-limit'}
    except Exception:
        return {'status': 3, 'error': 'damaged'}


print(json.dumps(main(), ensure_ascii=True))
