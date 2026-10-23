import re
import sqlite3
import unicodedata
from pathlib import Path

CRM_DB = Path(__file__).with_name('buyer-crm.sqlite')
IDENTITY_DB = Path(__file__).with_name('identities.sqlite')

def normalize(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(value or '')).casefold().replace('ё', 'е')).strip()

def resolve_many(names):
    if not CRM_DB.exists():
        raise RuntimeError('Полный справочник CRM не загружен. Ссылки временно недоступны.')
    db = sqlite3.connect(CRM_DB.as_uri()+'?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        overlay=IDENTITY_DB.exists() and CRM_DB.name=='buyer-crm.sqlite'
        if overlay:db.execute('ATTACH DATABASE ? AS identities',(IDENTITY_DB.as_uri()+'?mode=ro',))
        results = {}
        for name in names:
            candidates = [dict(r) for r in db.execute('SELECT ref,name,code1c FROM cards WHERE normalized_name=? ORDER BY ref', (normalize(name),))]
            if overlay:
                confirmed=[dict(r) for r in db.execute('SELECT c.ref,c.name,c.code1c FROM identities.mapping m JOIN identities.cards c ON c.ref=m.ref WHERE m.source_name=? ORDER BY c.ref',(name,))]
                if confirmed:candidates=confirmed
            target = candidates[0] if len(candidates) == 1 else None
            if len(candidates)>1 and len({x['code1c'] for x in candidates})==1 and candidates[0]['code1c']:
                target=candidates[0]
            results[name] = dict(target=target, matchStatus='matched' if target else 'multiple' if candidates else 'not_found', candidateCount=len(candidates))
        return results
    finally:
        db.close()
