"""Private read-only query adapter. JSON on stdin/stdout; never an HTTP server."""
import json, sys
from history_service import history, details, documents
from partner_buyers import buyers

try:
    request=json.loads(sys.stdin.read(16384))
    fn={'summary':history,'details':details,'documents':documents,'buyers':buyers}[request['operation']]
    data=fn(request['params'])
    print(json.dumps({'success':True,'data':data},ensure_ascii=False))
except (ValueError,KeyError,TypeError):
    print(json.dumps({'success':False,'error':{'message':'История недоступна для выбранной карточки или параметров. Если КА отсутствует в снимке закреплённой базы, требуется сопоставление данных.'}},ensure_ascii=False))
except Exception:
    print(json.dumps({'success':False,'error':{'message':'Не удалось прочитать историю покупок. Повторите попытку позже.'}},ensure_ascii=False))
