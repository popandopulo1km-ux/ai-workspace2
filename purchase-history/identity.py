"""Full CRM identity overlay. Never writes source facts or CRM cards."""
from pathlib import Path

IDENTITY_DB=Path(__file__).with_name('identities.sqlite')

def install(db, history_path):
    # Do not attach a real customer index to isolated fixture databases.
    schema={r[1] for r in db.execute('PRAGMA main.table_info(cards)')}
    if not IDENTITY_DB.exists() or not {'ref','type','farmer','segment'}.issubset(schema):
        db.execute('CREATE TEMP VIEW partner_mapping AS SELECT * FROM partner_data.mapping')
        return False
    db.execute('ATTACH DATABASE ? AS identity_data',(IDENTITY_DB.as_uri()+'?mode=ro',))
    db.executescript('''CREATE TEMP VIEW mapping AS SELECT source_name,ref FROM identity_data.mapping;
    CREATE TEMP VIEW partner_mapping AS SELECT partner_id,ref FROM identity_data.partner_mapping;
    CREATE TEMP VIEW cards AS SELECT i.ref,CASE WHEN i.ref LIKE 'CO_%' THEN 'company' ELSE 'contact' END type,
    CAST(substr(i.ref,instr(i.ref,'_')+1) AS INTEGER) id,i.name,COALESCE(c.farmer,'') farmer,COALESCE(c.segment,'') segment,i.status
    FROM identity_data.cards i LEFT JOIN main.cards c ON c.ref=i.ref;''')
    return True

def issues(db,refs):
    result=[]
    for ref in refs:
        c=db.execute('SELECT name,status FROM cards WHERE ref=?',(ref,)).fetchone()
        if c and c['status'] in ('matched','no_history'):continue
        status=c['status'] if c else 'missing'
        result.append(dict(ref=ref,name=c['name'] if c else ref,status=status,
            reason='Несколько карточек с одинаковым именем и разными идентификаторами' if status in ('ambiguous','partial') else 'Нет подтверждённой связи названия CRM с выгрузкой'))
    return result
