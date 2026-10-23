<?php
/**
 * Высокопроизводительный аналитический отчет: Клиентская база
 * Двойная детализация по ТЗ от 28.08.2026
 * Путь: /local/tools/report_farmer.php
 */

define("NO_KEEP_STATISTIC", true);
define("NOT_CHECK_PERMISSIONS", false);

// Подключаем prolog_before для чистой обработки AJAX
require_once($_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_before.php');

use Bitrix\Main\Loader;
use Bitrix\Crm\PhaseSemantics;

global $USER, $APPLICATION;
if (!$USER->IsAuthorized()) {
    die("Доступ заблокирован. Пожалуйста, авторизуйтесь на портале.");
}

if (!Loader::includeModule('crm')) {
    die("Модуль CRM не установлен.");
}

// Настройки сущностей и полей
define('SP_ENTITY_TYPE_ID', 1048);             // СП Корп продажи
define('SP_REALIZATION_ENTITY_TYPE_ID', 1062); // СП Реализация
define('DEAL_CATEGORY_ID', 5);                  // Сделки Оптовые продажи
define('DEAL_RETAIL_CATEGORY_ID', 30);          // Сделки Розничные продажи

// Источник СП «Реализация»: к какой воронке относится сумма
define('UF_REALIZATION_SOURCE', 'UF_CRM_9_1779951395746');
define('REALIZATION_SOURCE_CORPORATE', 1967);   // СП Корп. продажа
define('REALIZATION_SOURCE_WHOLESALE', 1968);   // Сделка Оптовые продажи

// Исключенные провальные стадии Смарт-Процессов (не выводить и не учитывать в провалах)
define('EXCLUDED_SP_FAIL_STAGES', ['DT1048_9:8']);

define('UF_COMPANY_FARMER', 'UF_CRM_1782369491');
define('UF_CONTACT_FARMER', 'UF_CRM_1782369591');
define('UF_CLIENT_COMMENT', 'UF_CRM_677F98BF433A2'); // Последний комментарий клиента
define('UF_DEAL_COMMENT', 'UF_CRM_CN_TL2CRM');       // Комментарий из ленты сделки
define('UF_SP_COMMENT', 'UF_CRM_67C55EA42D953');     // Комментарий из ленты СП

// Поля комментариев по причинам провалов
define('UF_DEAL_FAIL_REASON', 'UF_CRM_1740469561421'); // Текст провала в сделках
define('UF_SP_FAIL_REASON', 'UF_CRM_6_1775015895418');  // Текст провала в смарт-процессе

// Поля Ядро/Хвост
define('UF_COMPANY_CORE_TAIL', 'UF_CRM_1782358926');
define('UF_CONTACT_CORE_TAIL', 'UF_CRM_1782358765');

// Поля Путь в справочнике из 1С
define('UF_COMPANY_DIRECTORY_PATH', 'UF_CRM_1785825564');
define('UF_CONTACT_DIRECTORY_PATH', 'UF_CRM_1785825531');
define('UF_COMPANY_SEGMENT', 'UF_CRM_1785825401');
define('UF_CONTACT_SEGMENT', 'UF_CRM_1785825452');

// Departments and ordinary timeline comments. No CRM writes.
function wmDepartments() {
    static $rows = null;
    if ($rows !== null) return $rows;
    $rows = [];
    if (!\Bitrix\Main\Loader::includeModule('intranet') || !\Bitrix\Main\Loader::includeModule('iblock')) throw new \RuntimeException('Справочник отделов недоступен');
    $iblock = (int)\Bitrix\Main\Config\Option::get('intranet', 'iblock_structure', 0);
    if (!$iblock) throw new \RuntimeException('Не задана структура подразделений');
    $q = \CIBlockSection::GetList(['LEFT_MARGIN'=>'ASC'], ['IBLOCK_ID'=>$iblock], false, ['ID','NAME','IBLOCK_SECTION_ID','DEPTH_LEVEL']);
    while ($r=$q->Fetch()) $rows[]=['id'=>(int)$r['ID'],'name'=>$r['NAME'],'parentId'=>(int)$r['IBLOCK_SECTION_ID'],'depth'=>(int)$r['DEPTH_LEVEL']];
    return $rows;
}
function wmDepartmentFarmers($farmers) {
    $id=(int)($_REQUEST['department_id']??0);if(!$id)return $farmers;
    $rows=wmDepartments();$ids=[$id=>true];$found=false;
    foreach($rows as $r)if($r['id']===$id)$found=true;
    if(!$found)throw new \RuntimeException('Неизвестный отдел');
    do{$changed=false;foreach($rows as $r)if(isset($ids[$r['parentId']])&&!isset($ids[$r['id']])){$ids[$r['id']]=true;$changed=true;}}while($changed);
    $by='id';$order='asc';$q=\CUser::GetList($by,$order,['ID'=>implode('|',array_keys($farmers))],['FIELDS'=>['ID'],'SELECT'=>['UF_DEPARTMENT']]);$allowed=[];
    while($u=$q->Fetch())foreach((array)$u['UF_DEPARTMENT'] as $d)if(isset($ids[(int)$d])){$allowed[(int)$u['ID']]=true;break;}
    return array_intersect_key($farmers,$allowed);
}
function wmServiceComment($text){return (bool)preg_match('~(?:wazzup24|whatsapp24)~iu',(string)$text);}
function wmOrdinaryComment($text,$type,$id){
    if(!wmServiceComment($text))return $text?:'—';
    static $cache=[];$key=$type.':'.$id;if(isset($cache[$key]))return $cache[$key];
    $q=\Bitrix\Crm\Timeline\Entity\TimelineTable::query()->addSelect('COMMENT')->addSelect('ID')
      ->registerRuntimeField('binding',['data_type'=>'\\Bitrix\\Crm\\Timeline\\Entity\\TimelineBindingTable','reference'=>['=this.ID'=>'ref.OWNER_ID'],'join_type'=>'inner'])
      ->where('binding.ENTITY_ID',(int)$id)->where('binding.ENTITY_TYPE_ID',(int)$type)
      ->where('TYPE_ID',\Bitrix\Crm\Timeline\TimelineType::COMMENT)->setOrder(['CREATED'=>'DESC','ID'=>'DESC'])->exec();
    while($r=$q->fetch()){if(trim((string)$r['COMMENT'])!==''&&!wmServiceComment($r['COMMENT']))return $cache[$key]=$r['COMMENT'];}
    return $cache[$key]='—';
}

// Глобальное определение дат для исключения пустых полей при рендере страницы
$dateFromStr = $_REQUEST['date_from'] ?? date('Y-m-01');
$dateToStr = $_REQUEST['date_to'] ?? date('Y-m-d');

// WM affiliation report v1, 2026-09-15. No CRM writes. Embedded into report_farmer.php.
class WmAffiliationReport
{
    const HEAD_FIELD = 'UF_CRM_WM_PASSPORT_HEAD';
    public static function mode() {
        $mode = (string)($_REQUEST['affiliation'] ?? 'all');
        return in_array($mode, ['all', 'head', 'member'], true) ? $mode : 'all';
    }
    public static function salesDirection() {
        $direction = (string)($_REQUEST['sales_direction'] ?? 'all');
        return in_array($direction, ['all', 'wholesale', 'corporate', 'retail'], true) ? $direction : 'all';
    }
    private static function scalarInt($value) {
        if (is_array($value)) $value = reset($value);
        return (int)$value;
    }
    private static function moneyAllowed($document, $direction) {
        $type = (int)$document['DOC_TYPE'];
        $category = (int)($document['CATEGORY_ID'] ?? 0);
        if ($direction === 'all') {
            // Режим «Все» сохраняет прежнюю математику отчёта, включая исторические
            // реализации без заполненного источника. Розница рассчитывается отдельно.
            return $type === SP_ENTITY_TYPE_ID || $type === SP_REALIZATION_ENTITY_TYPE_ID
                || ($type === 2 && $category === DEAL_CATEGORY_ID);
        }
        if ($direction === 'wholesale') {
            return ($type === 2 && $category === DEAL_CATEGORY_ID)
                || ($type === SP_REALIZATION_ENTITY_TYPE_ID
                    && self::scalarInt($document[UF_REALIZATION_SOURCE] ?? 0) === REALIZATION_SOURCE_WHOLESALE);
        }
        if ($direction === 'corporate') {
            return $type === SP_ENTITY_TYPE_ID
                || ($type === SP_REALIZATION_ENTITY_TYPE_ID
                    && self::scalarInt($document[UF_REALIZATION_SOURCE] ?? 0) === REALIZATION_SOURCE_CORPORATE);
        }
        return $direction === 'retail' && $type === 2 && $category === DEAL_RETAIL_CATEGORY_ID;
    }
    private static function ref($value) {
        if (is_array($value)) $value = reset($value);
        $value = trim((string)$value);
        return preg_match('/^(CO|C)_[1-9][0-9]*$/', $value) ? $value : '';
    }
    private static function ts($value) {
        if (is_object($value) && method_exists($value, 'getTimestamp')) return $value->getTimestamp();
        return $value ? (strtotime((string)$value) ?: 0) : 0;
    }
    private static function range($time, $from, $to) { return $time > 0 && $time >= $from && $time <= $to; }
    private static function role($c) { return !$c['HEAD_REF'] ? 'none' : ($c['HEAD_REF'] === $c['KEY'] ? 'head' : 'member'); }
    private static function clients($filterCompany, $filterContact) {
        $out = [];
        foreach (['COMPANY', 'CONTACT'] as $type) {
            $isCompany = $type === 'COMPANY';
            $farmer = $isCompany ? UF_COMPANY_FARMER : UF_CONTACT_FARMER;
            $core = $isCompany ? UF_COMPANY_CORE_TAIL : UF_CONTACT_CORE_TAIL;
            $path = $isCompany ? UF_COMPANY_DIRECTORY_PATH : UF_CONTACT_DIRECTORY_PATH;
            $segment = $isCompany ? UF_COMPANY_SEGMENT : UF_CONTACT_SEGMENT;
            $fields = array_merge(['ID', $farmer, $core, $path, $segment, UF_CLIENT_COMMENT, self::HEAD_FIELD], $isCompany ? ['TITLE'] : ['NAME','SECOND_NAME','LAST_NAME']);
            $args = ['select' => $fields, 'filter' => $isCompany ? $filterCompany : $filterContact];
            $query = $isCompany ? \Bitrix\Crm\CompanyTable::getList($args) : \Bitrix\Crm\ContactTable::getList($args);
            while ($c = $query->fetch()) {
                $key = ($isCompany ? 'CO_' : 'C_') . $c['ID'];
                $out[$key] = ['KEY'=>$key, 'ID'=>(int)$c['ID'], 'TYPE'=>$type,
                    'TITLE'=>$isCompany ? $c['TITLE'] : trim($c['LAST_NAME'].' '.$c['NAME'].' '.($c['SECOND_NAME'] ?? '')),
                    'FARMER_ID'=>(int)$c[$farmer], 'HEAD_REF'=>self::ref($c[self::HEAD_FIELD]),
                    'COMMENT'=>wmOrdinaryComment($c[UF_CLIENT_COMMENT],$isCompany?\CCrmOwnerType::Company:\CCrmOwnerType::Contact,$c['ID']), 'CORE_TAIL'=>$c[$core], 'DIRECTORY_PATH'=>$c[$path], 'SEGMENT'=>$c[$segment],
                    'LINK'=>'/crm/'.strtolower($type).'/details/'.$c['ID'].'/'];
            }
        }
        return $out;
    }
    public static function load($from, $to, $prevFrom, $prevTo, $farmers) {
        $mode = self::mode();
        $direction = self::salesDirection();
        // Build one ownership map across all farmers. Drilldowns filter AFTER assignment.
        $clients = self::clients(['>'.UF_COMPANY_FARMER=>0], ['>'.UF_CONTACT_FARMER=>0]);
        $roots = [];
        foreach ($clients as $key=>$c) {
            $role = self::role($c);
            if (!isset($farmers[$c['FARMER_ID']])) continue;
            if ($mode === 'member' && $role !== 'member') continue;
            if ($mode === 'head' && $role === 'member') continue;
            $roots[$key] = $c + ['ROLE'=>$role];
        }
        if ($mode === 'head' && $roots) {
            $headRefs = array_keys($roots);
            foreach (array_chunk($headRefs, 400) as $chunk) {
                $clients += self::clients(['@'.self::HEAD_FIELD=>$chunk], ['@'.self::HEAD_FIELD=>$chunk]);
            }
        }
        $owner = []; $scope = []; $rows = [];
        foreach ($roots as $key=>$c) {
            $owner[$key]=$key; $scope[$key]=[$key=>$c];
        }
        if ($mode === 'head') foreach ($clients as $key=>$c) {
            $head=$c['HEAD_REF'];
            if ($head !== $key && isset($roots[$head])) { $owner[$key]=$head; $scope[$head][$key]=$c; }
        }
        $enums=[];
        $dbEnum=\CUserFieldEnum::GetList([], ['USER_FIELD_NAME'=>[UF_COMPANY_CORE_TAIL,UF_CONTACT_CORE_TAIL,UF_COMPANY_DIRECTORY_PATH,UF_CONTACT_DIRECTORY_PATH,UF_COMPANY_SEGMENT,UF_CONTACT_SEGMENT]]);
        while ($enum=$dbEnum->Fetch()) $enums[$enum['ID']]=$enum['VALUE'];
        $format=function($v) use ($enums) {
            if (is_array($v)) return implode(', ',array_map(function($x) use ($enums){return $enums[$x] ?? $x;},$v)) ?: '—';
            return $enums[$v] ?? ($v ?: '—');
        };
        foreach ($roots as $key=>$c) {
            $rows[$key]=$c;
            $rows[$key]['WM_HEAD_TITLE']=$clients[$c['HEAD_REF']]['TITLE'] ?? '';
            $rows[$key]['CORE_TAIL']=$format($c['CORE_TAIL']);
            $rows[$key]['DIRECTORY_PATH']=$format($c['DIRECTORY_PATH']);
            $rows[$key]['SEGMENT']=$format($c['SEGMENT']);
            $rows[$key]['ACTIVE']=false;
            foreach (['SUM_IN_WORK','SUM_REALIZATION','SUM_FAILED','REALIZATION_CUR','REALIZATION_PREV'] as $field) $rows[$key][$field]=0.0;
            $rows[$key]['LAST_SUCCESS_DATE']='—'; $rows[$key]['LAST_SUCCESS_REAL_DATE']='—';
            $rows[$key]['MEMBERS']=[];
            foreach ($scope[$key] as $memberKey=>$m) {
                $rows[$key]['MEMBERS'][$memberKey]=['KEY'=>$memberKey,'FARMER_ID'=>$m['FARMER_ID'],'TITLE'=>$m['TITLE'],'LINK'=>$m['LINK'],'IS_HEAD'=>$memberKey===$key,
                    'SEGMENT'=>$format($m['SEGMENT']),'DIRECTORY_PATH'=>$format($m['DIRECTORY_PATH']),'CORE_TAIL'=>$format($m['CORE_TAIL']),'COMMENT'=>$m['COMMENT'],
                    'LAST_SUCCESS_DATE'=>'—','LAST_SUCCESS_REAL_DATE'=>'—',
                    'SUM_IN_WORK'=>0.0,'SUM_REALIZATION'=>0.0,'SUM_FAILED'=>0.0,'REALIZATION_CUR'=>0.0,'REALIZATION_PREV'=>0.0];
            }
        }
        $companies=[]; $contacts=[];
        foreach ($owner as $key=>$root) { $c=$clients[$key]; if ($c['TYPE']==='COMPANY') $companies[$c['ID']]=true; else $contacts[$c['ID']]=true; }
        $selector=FarmerReportHelper::buildClientFilter($companies,$contacts);
        $docs=[]; $semantics=[]; $stageNames=[];
        foreach ([1048,1062] as $type) {
            $factory=\Bitrix\Crm\Service\Container::getInstance()->getFactory($type);
            if (!$factory) continue;
            foreach ($factory->getStages() as $stage) { $semantics[$type][$stage->getStatusId()]=$stage->getSemantics(); $stageNames[$type][$stage->getStatusId()]=$stage->getName(); }
            if (!$owner) continue;
            $fields=['ID','TITLE','OPPORTUNITY','COMPANY_ID','CONTACT_ID','STAGE_ID','MOVED_TIME','CREATED_TIME'];
            if ($type===1048) $fields=array_merge($fields,[UF_SP_COMMENT,UF_SP_FAIL_REASON]);
            if ($type===1062) $fields[] = UF_REALIZATION_SOURCE;
            foreach ($factory->getDataClass()::query()->setSelect($fields)->setFilter([$selector])->exec()->fetchAll() as $d) {
                $docs[$type.':'.$d['ID']]=$d+['DOC_TYPE'=>$type,'SEMANTIC'=>$semantics[$type][$d['STAGE_ID']] ?? 'P'];
            }
        }
        $dealCategories=[DEAL_CATEGORY_ID];
        if ($direction==='retail') $dealCategories[]=DEAL_RETAIL_CATEGORY_ID;
        if ($owner) {
            $query=\Bitrix\Crm\DealTable::getList(['select'=>['ID','TITLE','OPPORTUNITY','STAGE_SEMANTIC_ID','STAGE_ID','CATEGORY_ID','COMPANY_ID','CONTACT_ID','DATE_CREATE','MOVED_TIME',UF_DEAL_COMMENT,UF_DEAL_FAIL_REASON], 'filter'=>['@CATEGORY_ID'=>$dealCategories,$selector]]);
            while ($d=$query->fetch()) $docs['2:'.$d['ID']]=$d+['DOC_TYPE'=>2,'SEMANTIC'=>$d['STAGE_SEMANTIC_ID']];
        }
        $dealStageEntities=['DEAL_STAGE','DEAL_STAGE_'.DEAL_CATEGORY_ID];
        if ($direction==='retail') $dealStageEntities[]='DEAL_STAGE_'.DEAL_RETAIL_CATEGORY_ID;
        $statusQuery=\Bitrix\Crm\StatusTable::getList(['select'=>['STATUS_ID','NAME','ENTITY_ID'], 'filter'=>['@ENTITY_ID'=>$dealStageEntities]]);
        while ($s=$statusQuery->fetch()) $stageNames[2][$s['STATUS_ID']]=$s['NAME'];
        // Type-qualified activity IDs prevent collisions between the two smart processes.
        $activity=[];
        if ($owner) {
            $q=\Bitrix\Crm\ActivityTable::getList(['select'=>['OWNER_ID','OWNER_TYPE_ID'], 'filter'=>['@OWNER_TYPE_ID'=>[2,1048,1062],'>=CREATED'=>$from,'<=CREATED'=>$to]]);
            while ($a=$q->fetch()) $activity[$a['OWNER_TYPE_ID'].':'.$a['OWNER_ID']]=true;
        }
        $a=$from->getTimestamp();$b=$to->getTimestamp();$pa=$prevFrom->getTimestamp();$pb=$prevTo->getTimestamp();
        foreach ($docs as $dk=>&$d) {
            $type=$d['DOC_TYPE'];$mv=self::ts($d['MOVED_TIME']);$created=self::ts($d['DATE_CREATE'] ?? $d['CREATED_TIME']);
            $co='CO_'.(int)$d['COMPANY_ID'];$ct='C_'.(int)$d['CONTACT_ID'];
            // Фильтр направления меняет только рублёвые показатели. Состав и активность
            // базы остаются прежними; дополнительно загруженные сделки розницы их не меняют.
            $baseActivityDocument=!($type===2&&(int)($d['CATEGORY_ID']??0)===DEAL_RETAIL_CATEGORY_ID);
            $isActive=$baseActivityDocument&&(self::range($mv,$a,$b)||self::range($created,$a,$b)||isset($activity[$dk]));
            if ($isActive) foreach ([$co,$ct] as $bound) if (isset($owner[$bound])) $rows[$owner[$bound]]['ACTIVE']=true;
            $assigned=isset($owner[$co]) ? $co : (isset($owner[$ct]) ? $ct : null);
            if (!$assigned) continue;
            $key=$owner[$assigned];$amount=(float)$d['OPPORTUNITY'];$sem=$d['SEMANTIC'];
            $cur=self::range($mv,$a,$b);$prev=self::range($mv,$pa,$pb);
            $moneyAllowed=self::moneyAllowed($d,$direction);
            $retailVirtualRealization=$direction==='retail'&&$type===2&&(int)($d['CATEGORY_ID']??0)===DEAL_RETAIL_CATEGORY_ID;
            $isRealization=$type===SP_REALIZATION_ENTITY_TYPE_ID||$retailVirtualRealization;
            $metrics=['SUM_IN_WORK'=>($moneyAllowed&&$type!==SP_REALIZATION_ENTITY_TYPE_ID&&$sem==='P')?$amount:0,
                'SUM_REALIZATION'=>($moneyAllowed&&$isRealization&&$sem==='P')?$amount:0,
                'SUM_FAILED'=>($moneyAllowed&&$sem==='F'&&$cur&&!in_array($d['STAGE_ID'],EXCLUDED_SP_FAIL_STAGES,true))?$amount:0,
                'REALIZATION_CUR'=>($moneyAllowed&&$isRealization&&$sem==='S'&&$cur)?$amount:0,
                'REALIZATION_PREV'=>($moneyAllowed&&$isRealization&&$sem==='S'&&$prev)?$amount:0];
            foreach ($metrics as $field=>$value) { $rows[$key][$field]+=$value; $rows[$key]['MEMBERS'][$assigned][$field]+=$value; }
            if ($sem==='S'&&$moneyAllowed) {
                $lastFields=$retailVirtualRealization?['LAST_SUCCESS_DATE','LAST_SUCCESS_REAL_DATE']
                    : [$type===SP_REALIZATION_ENTITY_TYPE_ID?'LAST_SUCCESS_REAL_DATE':'LAST_SUCCESS_DATE'];
                $date=date('Y-m-d',$mv?:$created);
                foreach ($lastFields as $lastField) {
                    if ($date>$rows[$key][$lastField]||$rows[$key][$lastField]==='—') $rows[$key][$lastField]=$date;
                    if ($date>$rows[$key]['MEMBERS'][$assigned][$lastField]||$rows[$key]['MEMBERS'][$assigned][$lastField]==='—') $rows[$key]['MEMBERS'][$assigned][$lastField]=$date;
                }
            }
            $d['ROOT']=$key;$d['OWNER']=$assigned;$d['METRICS']=$metrics;
            $dealPrefix=(int)($d['CATEGORY_ID']??0)===DEAL_RETAIL_CATEGORY_ID?'[Розничные продажи] ':'[Оптовые продажи] ';
            $d['DISPLAY']=['ID'=>(int)$d['ID'],'TITLE'=>($type===2?$dealPrefix:($type===1048?'[Корп продажи] ':'[Реализация] ')).$d['TITLE'],
                'LINK'=>$type===2?'/crm/deal/details/'.$d['ID'].'/':'/crm/type/'.$type.'/details/'.$d['ID'].'/',
                'DATE'=>($mv?:$created)?date('Y-m-d',$mv?:$created):'—','SUM'=>$amount,
                'COMMENT'=>$type===2?($d[UF_DEAL_COMMENT]?:'—'):($d[UF_SP_COMMENT]??'—'),
                'STAGE'=>$stageNames[$type][$d['STAGE_ID']]??$d['STAGE_ID'],
                'FAIL_REASON_TEXT'=>$type===2?($d[UF_DEAL_FAIL_REASON]?:'—'):($d[UF_SP_FAIL_REASON]??'—'),
                'CLIENT_TITLE'=>$clients[$assigned]['TITLE'],'CLIENT_LINK'=>$clients[$assigned]['LINK'],'DOC_KEY'=>$dk];
        }
        unset($d);
        return ['rows'=>$rows,'docs'=>$docs,'mode'=>$mode,'sales_direction'=>$direction];
    }
    public static function dispatch($action,$snapshot,$farmers) {
        $farmer=(int)($_REQUEST['farmer_id']??0);
        $selected=(int)($_REQUEST['scope_farmer_id']??0);
        if (!$farmer && $selected) $farmer=$selected;
        $rows=array_filter($snapshot['rows'],function($c)use($farmer){return !$farmer||$c['FARMER_ID']===$farmer;});
        $column=(string)($_REQUEST['column']??'base');
        if ($action==='generate_report') {
            $totals=[];
            foreach ($farmers as $id=>$name) if (!$farmer||$id===$farmer) $totals[$id]=['FARMER_ID'=>$id,'FARMER_NAME'=>$name,'BASE_COUNT'=>0,'ACTIVE_COUNT'=>0,'ACTIVE_SUM'=>0.0,'SLEEPING_COUNT'=>0,'REALIZATION_SUM'=>0.0,'FAILURES_SUM'=>0.0,'DYNAMICS_SUM'=>0.0];
            foreach ($rows as $c) {
                $r=&$totals[$c['FARMER_ID']];$r['BASE_COUNT']++;$r[$c['ACTIVE']?'ACTIVE_COUNT':'SLEEPING_COUNT']++;
                if ($c['ACTIVE']) $r['ACTIVE_SUM']+=$c['SUM_IN_WORK'];
                $r['REALIZATION_SUM']+=$c['REALIZATION_CUR'];$r['FAILURES_SUM']+=$c['SUM_FAILED'];$r['DYNAMICS_SUM']+=$c['REALIZATION_CUR']-$c['REALIZATION_PREV'];unset($r);
            }
            return array_values($totals);
        }
        if ($action==='get_details') {
            $rows=array_filter($rows,function($c)use($column){
                if ($column==='active') return $c['ACTIVE'];
                if ($column==='sleeping') return !$c['ACTIVE'];
                if ($column==='turnover') return $c['REALIZATION_CUR']!=0||$c['SUM_IN_WORK']!=0;
                if ($column==='failed') return $c['SUM_FAILED']!=0;
                if ($column==='dynamics') return $c['REALIZATION_CUR']!=0||$c['REALIZATION_PREV']!=0;
                return true;
            });
            foreach ($rows as &$c) $c['MEMBERS']=array_values($c['MEMBERS']);unset($c);
            return array_values($rows);
        }
        $id=(int)($_REQUEST['client_id']??0);$type=($_REQUEST['client_type']??'COMPANY')==='CONTACT'?'C_':'CO_';
        if ($id) $rows=array_intersect_key($rows,[$type.$id=>true]);
        $metric=['work'=>'SUM_IN_WORK','base'=>'SUM_IN_WORK','active'=>'SUM_IN_WORK','sleeping'=>'SUM_IN_WORK','realization_work'=>'SUM_REALIZATION','turnover'=>'REALIZATION_CUR','realization'=>'REALIZATION_CUR','failed'=>'SUM_FAILED'][$column]??null;
        $memberKey=self::ref($_REQUEST['member_key']??'');
        $out=[];
        foreach ($snapshot['docs'] as $d) {
            if (!isset($d['ROOT'])||!isset($rows[$d['ROOT']])) continue;
            if ($memberKey && $d['OWNER']!==$memberKey) continue;
            if ($column==='dynamics') {
                if (!$d['METRICS']['REALIZATION_CUR']) continue;
                $out[]=$d['DISPLAY'];
            } elseif ($metric&&!empty($d['METRICS'][$metric])) $out[]=$d['DISPLAY'];
        }
        return $out;
    }
}


class FarmerReportHelper
{
    public static function getFarmers()
    {
        $farmerIds = [];
        $dbRes = \Bitrix\Crm\CompanyTable::getList([
            'select' => [UF_COMPANY_FARMER],
            'filter' => ['>' . UF_COMPANY_FARMER => 0],
            'group' => [UF_COMPANY_FARMER]
        ]);
        while ($row = $dbRes->fetch()) {
            $farmerIds[] = $row[UF_COMPANY_FARMER];
        }
        $dbRes = \Bitrix\Crm\ContactTable::getList([
            'select' => [UF_CONTACT_FARMER],
            'filter' => ['>' . UF_CONTACT_FARMER => 0],
            'group' => [UF_CONTACT_FARMER]
        ]);
        while ($row = $dbRes->fetch()) {
            $farmerIds[] = $row[UF_CONTACT_FARMER];
        }

        $farmerIds = array_unique($farmerIds);
        $farmers = [];

        if (!empty($farmerIds)) {
            $dbUsers = \Bitrix\Main\UserTable::getList([
                'select' => ['ID', 'NAME', 'LAST_NAME', 'LOGIN'],
                'filter' => ['@ID' => $farmerIds, '=ACTIVE' => 'Y']
            ]);
            while ($u = $dbUsers->fetch()) {
                $fullName = trim($u['LAST_NAME'] . ' ' . $u['NAME']);
                $farmers[$u['ID']] = !empty($fullName) ? $fullName : $u['LOGIN'];
            }
        }
        asort($farmers);
        return $farmers;
    }

    public static function getFarmerClients($farmerId)
    {
        $companies = [];
        $contacts = [];
        $compFilter = $farmerId > 0 ? ['=' . UF_COMPANY_FARMER => $farmerId] : ['>' . UF_COMPANY_FARMER => 0];
        $contFilter = $farmerId > 0 ? ['=' . UF_CONTACT_FARMER => $farmerId] : ['>' . UF_CONTACT_FARMER => 0];

        $dbComp = \Bitrix\Crm\CompanyTable::getList([
            'select' => ['ID', 'TITLE', UF_CLIENT_COMMENT, UF_COMPANY_CORE_TAIL, UF_COMPANY_FARMER, UF_COMPANY_DIRECTORY_PATH],
            'filter' => $compFilter
        ]);
        while ($c = $dbComp->fetch()) {
            $companies[$c['ID']] = [
                'ID' => $c['ID'], 
                'TITLE' => $c['TITLE'], 
                'COMMENT' => $c[UF_CLIENT_COMMENT], 
                'TYPE' => 'COMPANY', 
                'FARMER_ID' => (int)$c[UF_COMPANY_FARMER],
                'CORE_TAIL' => $c[UF_COMPANY_CORE_TAIL],
                'DIRECTORY_PATH' => $c[UF_COMPANY_DIRECTORY_PATH]
            ];
        }

        $dbCont = \Bitrix\Crm\ContactTable::getList([
            'select' => ['ID', 'NAME', 'LAST_NAME', UF_CLIENT_COMMENT, UF_CONTACT_CORE_TAIL, UF_CONTACT_FARMER, UF_CONTACT_DIRECTORY_PATH],
            'filter' => $contFilter
        ]);
        while ($c = $dbCont->fetch()) {
            $contacts[$c['ID']] = [
                'ID' => $c['ID'], 
                'TITLE' => trim($c['LAST_NAME'] . ' ' . $c['NAME']), 
                'COMMENT' => $c[UF_CLIENT_COMMENT], 
                'TYPE' => 'CONTACT', 
                'FARMER_ID' => (int)$c[UF_CONTACT_FARMER],
                'CORE_TAIL' => $c[UF_CONTACT_CORE_TAIL],
                'DIRECTORY_PATH' => $c[UF_CONTACT_DIRECTORY_PATH]
            ];
        }
        return [$companies, $contacts];
    }

    public static function buildClientFilter($companies, $contacts)
    {
        $compKeys = !empty($companies) ? array_keys($companies) : [];
        $contKeys = !empty($contacts) ? array_keys($contacts) : [];

        if (!empty($compKeys) && !empty($contKeys)) {
            return [
                'LOGIC' => 'OR',
                ['@COMPANY_ID' => $compKeys],
                ['@CONTACT_ID' => $contKeys]
            ];
        } elseif (!empty($compKeys)) {
            return ['@COMPANY_ID' => $compKeys];
        } elseif (!empty($contKeys)) {
            return ['@CONTACT_ID' => $contKeys];
        }
        return ['=ID' => 0];
    }

    public static function getActiveClientsMap($farmerId, $dateFrom, $dateTo, $companies, $contacts)
    {
        $activeCompanyIds = [];
        $activeContactIds = [];

        $activeDealIds = [];
        $activeSpIds = [];

        // 1. Дела в периоде
        $dbAct = \Bitrix\Crm\ActivityTable::getList([
            'select' => ['OWNER_ID', 'OWNER_TYPE_ID'],
            'filter' => [
                '@OWNER_TYPE_ID' => [\CCrmOwnerType::Deal, SP_ENTITY_TYPE_ID, SP_REALIZATION_ENTITY_TYPE_ID],
                '>=CREATED' => $dateFrom,
                '<=CREATED' => $dateTo
            ]
        ]);
        while ($act = $dbAct->fetch()) {
            $oType = (int)$act['OWNER_TYPE_ID'];
            $oId = (int)$act['OWNER_ID'];
            if ($oType === \CCrmOwnerType::Deal) {
                $activeDealIds[$oId] = true;
            } else {
                $activeSpIds[$oId] = true;
            }
        }

        // 2. Сделки с движением по стадиям (MOVED_TIME) или связанными делами за период
        $clientSelector = self::buildClientFilter($companies, $contacts);
        if (!empty($companies) || !empty($contacts)) {
            $deals = \Bitrix\Crm\DealTable::getList([
                'select' => ['COMPANY_ID', 'CONTACT_ID'],
                'filter' => [
                    '=CATEGORY_ID' => DEAL_CATEGORY_ID,
                    $clientSelector,
                    [
                        'LOGIC' => 'OR',
                        ['>=MOVED_TIME' => $dateFrom, '<=MOVED_TIME' => $dateTo],
                        ['>=DATE_CREATE' => $dateFrom, '<=DATE_CREATE' => $dateTo],
                        (!empty($activeDealIds) ? ['@ID' => array_keys($activeDealIds)] : ['=ID' => 0])
                    ]
                ]
            ])->fetchAll();
            foreach ($deals as $d) {
                if ($d['COMPANY_ID']) $activeCompanyIds[$d['COMPANY_ID']] = true;
                if ($d['CONTACT_ID']) $activeContactIds[$d['CONTACT_ID']] = true;
            }
        }

        // 3. Смарт-процессы (1048 Корп продажи и 1062 Реализация)
        foreach ([SP_ENTITY_TYPE_ID, SP_REALIZATION_ENTITY_TYPE_ID] as $spTypeId) {
            $factory = \Bitrix\Crm\Service\Container::getInstance()->getFactory($spTypeId);
            if ($factory && (!empty($companies) || !empty($contacts))) {
                $sps = $factory->getDataClass()::query()
                    ->setSelect(['COMPANY_ID', 'CONTACT_ID'])
                    ->setFilter([
                        $clientSelector,
                        [
                            'LOGIC' => 'OR',
                            ['>=MOVED_TIME' => $dateFrom, '<=MOVED_TIME' => $dateTo],
                            ['>=CREATED_TIME' => $dateFrom, '<=CREATED_TIME' => $dateTo],
                            (!empty($activeSpIds) ? ['@ID' => array_keys($activeSpIds)] : ['=ID' => 0])
                        ]
                    ])->exec()->fetchAll();
                foreach ($sps as $s) {
                    if ($s['COMPANY_ID']) $activeCompanyIds[$s['COMPANY_ID']] = true;
                    if ($s['CONTACT_ID']) $activeContactIds[$s['CONTACT_ID']] = true;
                }
            }
        }

        $companiesResult = array_intersect_key($companies, $activeCompanyIds);
        $contactsResult = array_intersect_key($contacts, $activeContactIds);

        return [$companiesResult, $contactsResult];
    }

    public static function getLastSuccessDates($companies, $contacts, $spCorpSuccessStages, $spRealSuccessStages)
    {
        $clientSelector = self::buildClientFilter($companies, $contacts);
        $lastSuccessCorp = [];
        $lastSuccessReal = [];

        if (empty($companies) && empty($contacts)) {
            return [$lastSuccessCorp, $lastSuccessReal];
        }

        // 1. Сделки Оптовые продажи (успех)
        $dbDeals = \Bitrix\Crm\DealTable::getList([
            'select' => ['COMPANY_ID', 'CONTACT_ID', 'MOVED_TIME', 'CLOSEDATE', 'DATE_CREATE'],
            'filter' => [
                '=CATEGORY_ID' => DEAL_CATEGORY_ID,
                '=STAGE_SEMANTIC_ID' => PhaseSemantics::SUCCESS,
                $clientSelector
            ],
            'order' => ['MOVED_TIME' => 'DESC', 'ID' => 'DESC']
        ]);
        while ($d = $dbDeals->fetch()) {
            $cKey = $d['COMPANY_ID'] > 0 ? 'COMPANY_' . $d['COMPANY_ID'] : ($d['CONTACT_ID'] > 0 ? 'CONTACT_' . $d['CONTACT_ID'] : '');
            if (!$cKey || isset($lastSuccessCorp[$cKey])) continue;
            $dt = $d['MOVED_TIME'] ?? ($d['CLOSEDATE'] ?? $d['DATE_CREATE']);
            if ($dt instanceof \Bitrix\Main\Type\Date || $dt instanceof \Bitrix\Main\Type\DateTime) {
                $lastSuccessCorp[$cKey] = $dt->format('Y-m-d');
            } elseif (!empty($dt)) {
                $lastSuccessCorp[$cKey] = date('Y-m-d', strtotime($dt));
            }
        }

        // 2. СП Корп продажи (1048 успех)
        $factoryCorp = \Bitrix\Crm\Service\Container::getInstance()->getFactory(SP_ENTITY_TYPE_ID);
        if ($factoryCorp && !empty($spCorpSuccessStages)) {
            $sps = $factoryCorp->getDataClass()::query()
                ->setSelect(['COMPANY_ID', 'CONTACT_ID', 'MOVED_TIME', 'CREATED_TIME'])
                ->setFilter([
                    '@STAGE_ID' => $spCorpSuccessStages,
                    $clientSelector
                ])
                ->setOrder(['MOVED_TIME' => 'DESC', 'ID' => 'DESC'])
                ->exec()->fetchAll();
            foreach ($sps as $s) {
                $cKey = $s['COMPANY_ID'] > 0 ? 'COMPANY_' . $s['COMPANY_ID'] : ($s['CONTACT_ID'] > 0 ? 'CONTACT_' . $s['CONTACT_ID'] : '');
                if (!$cKey) continue;
                $dt = $s['MOVED_TIME'] ?? $s['CREATED_TIME'];
                $dStr = '';
                if ($dt instanceof \Bitrix\Main\Type\Date || $dt instanceof \Bitrix\Main\Type\DateTime) {
                    $dStr = $dt->format('Y-m-d');
                } elseif (!empty($dt)) {
                    $dStr = date('Y-m-d', strtotime($dt));
                }
                if (!isset($lastSuccessCorp[$cKey]) || (strtotime($dStr) > strtotime($lastSuccessCorp[$cKey]))) {
                    $lastSuccessCorp[$cKey] = $dStr;
                }
            }
        }

        // 3. СП Реализация (1062 успех)
        $factoryReal = \Bitrix\Crm\Service\Container::getInstance()->getFactory(SP_REALIZATION_ENTITY_TYPE_ID);
        if ($factoryReal && !empty($spRealSuccessStages)) {
            $sps = $factoryReal->getDataClass()::query()
                ->setSelect(['COMPANY_ID', 'CONTACT_ID', 'MOVED_TIME', 'CREATED_TIME'])
                ->setFilter([
                    '@STAGE_ID' => $spRealSuccessStages,
                    $clientSelector
                ])
                ->setOrder(['MOVED_TIME' => 'DESC', 'ID' => 'DESC'])
                ->exec()->fetchAll();
            foreach ($sps as $s) {
                $cKey = $s['COMPANY_ID'] > 0 ? 'COMPANY_' . $s['COMPANY_ID'] : ($s['CONTACT_ID'] > 0 ? 'CONTACT_' . $s['CONTACT_ID'] : '');
                if (!$cKey || isset($lastSuccessReal[$cKey])) continue;
                $dt = $s['MOVED_TIME'] ?? $s['CREATED_TIME'];
                if ($dt instanceof \Bitrix\Main\Type\Date || $dt instanceof \Bitrix\Main\Type\DateTime) {
                    $lastSuccessReal[$cKey] = $dt->format('Y-m-d');
                } elseif (!empty($dt)) {
                    $lastSuccessReal[$cKey] = date('Y-m-d', strtotime($dt));
                }
            }
        }

        return [$lastSuccessCorp, $lastSuccessReal];
    }
}

// -------------------------------------------------------------
// AJAX ОБРАБОТКА ДЛЯ МОДАЛЬНЫХ ОКОН
// -------------------------------------------------------------
// One immutable calculation per Generate click. Never mix newer CRM data into drilldowns.
function wmSnapshotWrite($key,$dir,$value) {
    $cache=\Bitrix\Main\Data\Cache::createInstance();
    if (!$cache->startDataCache(3600,$key,$dir)) throw new \RuntimeException('Cannot retain report calculation');
    // Plain JSON: no binary gzip string inside the PHP cache container.
    $payload=json_encode($value,JSON_INVALID_UTF8_SUBSTITUTE|JSON_THROW_ON_ERROR);
    $cache->endDataCache(['json'=>$payload]);
}
function wmSnapshotRead($key,$dir) {
    $cache=\Bitrix\Main\Data\Cache::createInstance();
    if (!$cache->initCache(3600,$key,$dir)) throw new \RuntimeException('WM_REPORT_EXPIRED');
    $saved=$cache->getVars();
    if (!isset($saved['json'])) throw new \RuntimeException('WM_REPORT_EXPIRED');
    return json_decode($saved['json'],true,512,JSON_THROW_ON_ERROR);
}
function wmReportSnapshot($action,$from,$to,$prevFrom,$prevTo) {
    global $USER;
    $signature=hash('sha256',json_encode([(int)$USER->GetID(),$from->getTimestamp(),$to->getTimestamp(),WmAffiliationReport::mode(),WmAffiliationReport::salesDirection(),(int)($_REQUEST['department_id']??0),(int)($_REQUEST['scope_farmer_id']??$_REQUEST['farmer_id']??0)]));
    $dir='/wm_client_report_v7_export_segment/'.(int)$USER->GetID();
    $token=(string)($_REQUEST['report_snapshot']??'');
    if ($action!=='generate_report') {
        if (!preg_match('/^[a-f0-9]{32}$/D',$token)) throw new \RuntimeException('WM_REPORT_EXPIRED');
        $data=wmSnapshotRead($signature.$token,$dir);
        $snapshot=$data['snapshot'];$snapshot['docs']=[];
        if ($action==='get_sub_details') {
            $farmer=(int)($_REQUEST['farmer_id']??0) ?: (int)($_REQUEST['scope_farmer_id']??0);
            $id=(int)($_REQUEST['client_id']??0);
            $root=(($_REQUEST['client_type']??'COMPANY')==='CONTACT'?'C_':'CO_').$id;
            $needed=[];
            foreach($snapshot['rows'] as $key=>$row) {
                if ($farmer && $row['FARMER_ID']!==$farmer) continue;
                if ($id && $key!==$root) continue;
                $needed[(int)$row['FARMER_ID']]=true;
            }
            foreach(array_keys($needed) as $fid) {
                $part=wmSnapshotRead($signature.$token.'_docs_'.$fid,$dir);
                $snapshot['docs']+=$part;
            }
        }
        return [$snapshot,$data['farmers'],$token];
    }
    $allFarmers=FarmerReportHelper::getFarmers();
    $farmers=wmDepartmentFarmers($allFarmers);
    $snapshot=WmAffiliationReport::load($from,$to,$prevFrom,$prevTo,$allFarmers);
    $snapshot['rows']=array_filter($snapshot['rows'],function($r)use($farmers){return isset($farmers[$r['FARMER_ID']]);});
    wmValidateReportMath($snapshot);
    $parts=[];
    foreach($snapshot['rows'] as $r)$parts[(int)$r['FARMER_ID']]=[];
    foreach($snapshot['docs'] as $key=>$d) {
        if(!isset($d['ROOT'])||!isset($snapshot['rows'][$d['ROOT']]))continue;
        $fid=(int)$snapshot['rows'][$d['ROOT']]['FARMER_ID'];
        $parts[$fid][$key]=array_intersect_key($d,array_flip(['ROOT','OWNER','METRICS','DISPLAY']));
    }
    $token=bin2hex(random_bytes(16));
    foreach($parts as $fid=>$docs)wmSnapshotWrite($signature.$token.'_docs_'.$fid,$dir,$docs);
    $meta=$snapshot;unset($meta['docs']);
    // Publish metadata last: a token never points to a partially written calculation.
    wmSnapshotWrite($signature.$token,$dir,['snapshot'=>$meta,'farmers'=>$farmers]);
    return [$snapshot,$farmers,$token];
}

function wmValidateReportMath($snapshot) {
    $fields=['SUM_IN_WORK','SUM_REALIZATION','SUM_FAILED','REALIZATION_CUR','REALIZATION_PREV'];$sums=[];
    foreach ($snapshot['docs'] as $d) {
        if (!isset($d['ROOT'])) continue;
        foreach($fields as $f) $sums[$d['ROOT']][$f]=($sums[$d['ROOT']][$f]??0)+$d['METRICS'][$f];
    }
    foreach($snapshot['rows'] as $key=>$r) foreach($fields as $f) {
        $members=array_sum(array_column($r['MEMBERS'],$f));
        if(abs($r[$f]-($sums[$key][$f]??0))>0.011||abs($r[$f]-$members)>0.011) throw new \RuntimeException('Report reconciliation failed: '.$key.' '.$f);
    }
    $request=$_REQUEST;
    try {
        $farmers=[];foreach($snapshot['rows'] as $r)$farmers[$r['FARMER_ID']]='';
        $_REQUEST['scope_farmer_id']=0;
        foreach(array_merge([0],array_keys($farmers)) as $farmer) {
            $_REQUEST['farmer_id']=$farmer;
            $totals=WmAffiliationReport::dispatch('generate_report',$snapshot,$farmers);
            foreach(['base','active','sleeping','turnover','failed','dynamics'] as $metric) {
                $_REQUEST['column']=$metric;$detail=WmAffiliationReport::dispatch('get_details',$snapshot,$farmers);
                $field=['base'=>'BASE_COUNT','active'=>'ACTIVE_COUNT','sleeping'=>'SLEEPING_COUNT','turnover'=>'REALIZATION_SUM','failed'=>'FAILURES_SUM','dynamics'=>'DYNAMICS_SUM'][$metric];
                $actual=count($detail);
                if($metric==='turnover')$actual=array_sum(array_column($detail,'REALIZATION_CUR'));
                if($metric==='failed')$actual=array_sum(array_column($detail,'SUM_FAILED'));
                if($metric==='dynamics')$actual=array_sum(array_column($detail,'REALIZATION_CUR'))-array_sum(array_column($detail,'REALIZATION_PREV'));
                if(abs($actual-array_sum(array_column($totals,$field)))>0.011)throw new \RuntimeException('Report detail reconciliation failed: '.$farmer.' '.$metric);
                if($metric==='active'&&abs(array_sum(array_column($detail,'SUM_IN_WORK'))-array_sum(array_column($totals,'ACTIVE_SUM')))>0.011)throw new \RuntimeException('Report active reconciliation failed');
            }
        }
    } finally {$_REQUEST=$request;}
}

$action = $_REQUEST['action'] ?? '';

if (!empty($action)) {
    header('Content-Type: application/json');
    header('Cache-Control: no-store, private');

    try {
        $dateFrom = \Bitrix\Main\Type\DateTime::createFromPhp(new \DateTime($dateFromStr . ' 00:00:00'));
        $dateTo = \Bitrix\Main\Type\DateTime::createFromPhp(new \DateTime($dateToStr . ' 23:59:59'));
    } catch (\Exception $e) {
        $dateFrom = \Bitrix\Main\Type\DateTime::createFromPhp(new \DateTime(date('Y-m-01') . ' 00:00:00'));
        $dateTo = \Bitrix\Main\Type\DateTime::createFromPhp(new \DateTime(date('Y-m-d') . ' 23:59:59'));
    }

    // Same calendar dates in the previous month; clamp missing days to month end.
    $previousMonthDate = static function($value) {
        $date = new \DateTimeImmutable($value->format('Y-m-d H:i:s'));
        $month = $date->modify('first day of this month')->modify('-1 month');
        $day = min((int)$date->format('d'), (int)$month->format('t'));
        return \Bitrix\Main\Type\DateTime::createFromPhp(
            \DateTime::createFromImmutable($month->setDate((int)$month->format('Y'), (int)$month->format('m'), $day))
        );
    };
    $prevDateFrom = $previousMonthDate($dateFrom);
    $prevDateTo = $previousMonthDate($dateTo);

    if (in_array($action, ['generate_report','get_details','get_sub_details'], true)) {
        try {
            [$wmSnapshot,$wmFarmers,$wmToken] = wmReportSnapshot($action,$dateFrom,$dateTo,$prevDateFrom,$prevDateTo);
            $wmData = WmAffiliationReport::dispatch($action,$wmSnapshot,$wmFarmers);
            echo json_encode(['success'=>true,'data'=>$wmData,'report_snapshot'=>$wmToken,'affiliation'=>WmAffiliationReport::mode(),'sales_direction'=>WmAffiliationReport::salesDirection()], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        } catch (\Throwable $e) {
            error_log('WM affiliation report: '.$e->getMessage());
            http_response_code(500);
            echo json_encode(['success'=>false,'error'=>$e->getMessage()==='WM_REPORT_EXPIRED'?'Расчёт устарел. Нажмите «Сформировать», чтобы обновить весь отчёт.':'Не удалось построить отчёт. Обратитесь к администратору.'], JSON_UNESCAPED_UNICODE);
        }
        die();
    }
}

// -------------------------------------------------------------
// ВЫВОД В ИНТЕРФЕЙС БИТРИКСА (ПОДКЛЮЧАЕМ ШАПКУ)
// -------------------------------------------------------------
require($_SERVER["DOCUMENT_ROOT"]."/bitrix/header.php");
$APPLICATION->SetTitle("Отчет: Клиентская база");

$farmers = FarmerReportHelper::getFarmers();
?>

<!-- Tailwind CSS с отключением preflight для сохранения стандартной разметки CRM -->
<script src="https://cdn.tailwindcss.com"></script>
<script>
    tailwind.config = {
        corePlugins: {
            preflight: false,
        }
    }
</script>

<style>
    .f-report, .f-table, .m-table {
        text-align: left !important;
    }
    .f-table th, .f-table td, .m-table th, .m-table td {
        text-align: left !important;
    }
    
    .f-report {
        font-family: var(--ui-font-family-primary, var(--ui-font-family-system, "Helvetica Neue", Arial, sans-serif));
        margin: 15px 0;
    }
    .f-filter-box {
        background: #f8fafc;
        border: 1px solid #eef2f4;
        padding: 15px 20px;
        border-radius: 8px;
        margin-bottom: 20px;
        display: flex;
        flex-wrap: wrap;
        gap: 15px;
        align-items: flex-end;
    }
    .f-filter-item {
        display: flex;
        flex-direction: column;
    }
    .f-filter-item label {
        font-size: 11px;
        color: #535c69;
        font-weight: bold;
        text-transform: uppercase;
        margin-bottom: 6px;
        letter-spacing: 0.5px;
    }
    .f-filter-item select, .f-filter-item input {
        border: 1px solid #c6cddec1;
        border-radius: 4px;
        padding: 6px 12px;
        font-size: 13px;
        color: #333;
        background: #fff;
        outline: none;
        min-width: 180px;
        box-sizing: border-box;
    }
    .f-btn {
        background: #0052cc;
        color: #fff;
        border: 0;
        border-radius: 4px;
        padding: 8px 24px;
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        transition: background 0.15s;
    }
    .f-btn:hover {
        background: #0040a3;
    }
    .f-table {
        width: 100%;
        border-collapse: collapse;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        border: 1px solid #edeef0;
    }
    .f-table th {
        background: #f8fafc;
        color: #535c69;
        padding: 12px 16px;
        font-size: 12px;
        font-weight: bold;
        border-bottom: 1px solid #dde5eb;
    }
    .f-table td {
        padding: 14px 16px;
        font-size: 13px;
        border-bottom: 1px solid #edeef0;
        color: #333;
    }
    .f-table tr:hover {
        background: #fcfdfe;
    }
    .f-table tr.total-row {
        background: #f4f7f6;
        font-weight: bold;
    }
    .f-table tr.total-row td {
        border-top: 2px solid #dde5eb;
        border-bottom: 2px solid #dde5eb;
        color: #333;
    }
    .cell-link {
        color: #002fa7;
        font-weight: 600;
        text-decoration: underline;
        background: transparent;
        border: 0;
        padding: 0;
        cursor: pointer;
        font-size: 13px;
    }
    .cell-link:hover {
        color: #0052cc;
    }
    .cell-dir-path {
        font-size: 11px !important;
        color: #666 !important;
        max-width: 220px;
        word-break: break-word;
    }
    .dyn-pos {
        color: #2e7d32 !important;
        font-weight: bold !important;
    }
    .dyn-neg {
        color: #c62828 !important;
        font-weight: bold !important;
    }
    .dyn-zero {
        color: #666666 !important;
    }
    
    .f-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 200;
        padding: 20px;
    }
    #f-backdrop-l2 {
        z-index: 300;
    }
    .f-modal {
        background: #fff;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.15);
        width: 95%;
        max-width: 1350px;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .f-modal-header {
        background: #f8fafc;
        padding: 15px 24px;
        border-bottom: 1px solid #eef2f4;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .f-modal-title {
        font-size: 18px;
        font-weight: bold;
        color: #333;
        margin: 0;
    }
    .f-modal-close {
        background: #535c69;
        color: #fff;
        border: 0;
        border-radius: 4px;
        padding: 6px 16px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        transition: background 0.15s;
    }
    .f-modal-close:hover {
        background: #414953;
    }
    .f-modal-body {
        padding: 20px 24px;
        overflow-y: auto;
        flex: 1;
        position: relative;
        min-height: 150px;
    }
    .m-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
    }
    .m-table th {
        background: #f5f7f8;
        color: #535c69;
        padding: 10px 12px;
        font-weight: bold;
        border-bottom: 2px solid #eef2f4;
    }
    .m-table td {
        padding: 10px 12px;
        border-bottom: 1px solid #edeef0;
        color: #555;
    }
    .m-table tr:hover {
        background: #fafbfc;
    }
    .m-table tr.total-row {
        background: #f4f7f6;
        font-weight: bold;
    }
    .m-table tr.total-row td {
        border-top: 2px solid #eef2f4;
        color: #333;
    }
    .text-blue-link {
        color: #0052cc;
        text-decoration: underline;
    }
    .text-blue-link:hover {
        color: #0040a3;
    }
    .loader-spinner {
        border-top-color: #0052cc;
        -webkit-animation: spinner-spin 1s linear infinite;
        animation: spinner-spin 1s linear infinite;
    }
    @-webkit-keyframes spinner-spin { 0% { -webkit-transform: rotate(0deg); } 100% { -webkit-transform: rotate(360deg); } }
    @keyframes spinner-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    
    .f-btn-task {
        background: #00ace6;
        color: #fff;
        border: 0;
        border-radius: 4px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        transition: background 0.15s;
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .f-btn-task:hover {
        background: #008ebf;
    }
</style>

<div class="f-report">
    
    <!-- Фильтры -->
    <div class="f-filter-box">
        <form id="f-filter-form" class="m-0 flex flex-wrap gap-4 items-end" style="display: flex; gap: 15px; align-items: flex-end;">
            <div class="f-filter-item">
                <label for="wm-department">Отдел</label><select id="wm-department" name="department_id"><option value="0">Все отделы</option><?php foreach(wmDepartments() as $dep): ?><option value="<?= $dep['id'] ?>"><?= htmlspecialcharsbx(str_repeat('  ',max(0,$dep['depth']-1)).($dep['depth']>1?'↳ ':'').$dep['name']) ?></option><?php endforeach; ?></select></div><div class="f-filter-item"><label>Фермер</label>
                <select name="farmer_id">
                    <option value="0">Все сотрудники</option>
                    <?php foreach ($farmers as $id => $name): ?>
                        <option value="<?= $id ?>" <?= $selectedFarmerId === $id ? 'selected' : '' ?>><?= htmlspecialcharsbx($name) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="f-filter-item">
                <label>ПЕРИОД С</label>
                <input type="date" name="date_from" value="<?= htmlspecialcharsbx($dateFromStr) ?>">
            </div>
            <div class="f-filter-item">
                <label>ПО</label>
                <input type="date" name="date_to" value="<?= htmlspecialcharsbx($dateToStr) ?>">
            </div>
            <div class="f-filter-item">
                <label for="wm-affiliation">Аффилированность</label>
                <select name="affiliation" id="wm-affiliation">
                    <option value="all" <?= WmAffiliationReport::mode()==='all'?'selected':'' ?>>Все</option>
                    <option value="head" <?= WmAffiliationReport::mode()==='head'?'selected':'' ?>>Головной контрагент</option>
                    <option value="member" <?= WmAffiliationReport::mode()==='member'?'selected':'' ?>>Участник группы</option>
                </select>
            </div>
            <div class="f-filter-item">
                <label for="wm-sales-direction">Направление продаж</label>
                <select name="sales_direction" id="wm-sales-direction">
                    <option value="all" <?= WmAffiliationReport::salesDirection()==='all'?'selected':'' ?>>Все направления</option>
                    <option value="wholesale" <?= WmAffiliationReport::salesDirection()==='wholesale'?'selected':'' ?>>Оптовые продажи</option>
                    <option value="corporate" <?= WmAffiliationReport::salesDirection()==='corporate'?'selected':'' ?>>Корпоративные продажи</option>
                    <option value="retail" <?= WmAffiliationReport::salesDirection()==='retail'?'selected':'' ?>>Розничные продажи</option>
                </select>
            </div>
            <button type="submit" class="f-btn">Сформировать</button>
        </form>
    </div>

    <!-- Основная таблица результатов -->
    <table id="main-table" class="f-table">
        <thead>
            <tr>
                <th onclick="sortTable('main-table', 0, false)" class="cursor-pointer select-none hover:bg-gray-100" style="width: 240px;">Фермер ⇅</th>
                <th onclick="sortTable('main-table', 1, true)" class="cursor-pointer select-none hover:bg-gray-100">База шт ⇅</th>
                <th onclick="sortTable('main-table', 2, true)" class="cursor-pointer select-none hover:bg-gray-100">Активная база ⇅</th>
                <th onclick="sortTable('main-table', 3, true)" class="cursor-pointer select-none hover:bg-gray-100">Спящая база шт ⇅</th>
                <th onclick="sortTable('main-table', 4, true)" class="cursor-pointer select-none hover:bg-gray-100">Завершённая реализация, ₽ ⇅</th>
                <th onclick="sortTable('main-table', 5, true)" class="cursor-pointer select-none hover:bg-gray-100">Провалы базы руб ⇅</th>
                <th onclick="sortTable('main-table', 6, true)" class="cursor-pointer select-none hover:bg-gray-100">Динамика базы руб ⇅</th>
            </tr>
        </thead>
        <tbody id="report-tbody">
            <tr>
                <td colspan="7" class="p-8 text-center text-gray-400">Нажмите кнопку «Сформировать» для загрузки отчета.</td>
            </tr>
        </tbody>
    </table>
</div>

<!-- Модальное окно УРОВНЯ 1 (Список клиентов) -->
<div id="f-backdrop-l1" class="f-backdrop" onclick="backdropClick(1, event)">
    <div class="f-modal">
        <div class="f-modal-header">
            <div class="flex items-center gap-3" style="display: flex; align-items: center; gap: 12px;">
                <h3 id="modal-title-l1" class="f-modal-title">Детализация</h3>
                <button id="btn-bulk-tasks" onclick="runBulkTaskCreate()" class="f-btn-task hidden" style="display: none; background: #0052cc; color: #fff; padding: 6px 14px; border-radius: 4px; font-size: 12px; border: 0; cursor: pointer; font-weight: bold;">
                    Поставить задачи (<span id="bulk-task-count">0</span>)
                </button>
            </div>
            <button type="button" id="wm-export-tg" class="f-modal-close" onclick="wmExportTg()" hidden>Export аналитики по товарным группам</button><button onclick="closeModal(1)" class="f-modal-close">Закрыть</button>
        </div>
        <div class="f-modal-body">
            <div id="m-loader-l1" class="absolute inset-0 bg-white/70 flex items-center justify-center z-20 hidden">
                <div class="loader-spinner ease-linear rounded-full border-4 border-t-4 border-gray-200 h-10 w-10"></div>
            </div>
            <table id="m-table-l1" class="m-table">
                <thead id="m-thead-l1">
                    <!-- Формируется динамически JS в зависимости от типа детализации -->
                </thead>
                <tbody id="m-tbody-l1"></tbody>
            </table>
        </div>
    </div>
</div>

<!-- Модальное окно УРОВНЯ 2 (Детализация конкретных сделок/СП клиента) -->
<div id="f-backdrop-l2" class="f-backdrop" style="z-index: 300;" onclick="backdropClick(2, event)">
    <div class="f-modal" style="max-width: 1150px;">
        <div class="f-modal-header">
            <h3 id="modal-title-l2" class="f-modal-title">Детализация</h3>
            <button onclick="closeModal(2)" class="f-modal-close">Закрыть</button>
        </div>
        <div class="f-modal-body">
            <div id="m-loader-l2" class="absolute inset-0 bg-white/70 flex items-center justify-center z-20 hidden">
                <div class="loader-spinner ease-linear rounded-full border-4 border-t-4 border-gray-200 h-10 w-10"></div>
            </div>
            <table id="m-table-l2" class="m-table">
                <thead>
                    <tr>
                        <th onclick="sortTable('m-table-l2', 0, true)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 80px;">ID ⇅</th>
                        <th onclick="sortTable('m-table-l2', 1, false)" class="cursor-pointer select-none hover:bg-gray-200">Название ⇅</th>
                        <th onclick="sortTable('m-table-l2', 2, false)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 100px;">Дата изм. ⇅</th>
                        <th onclick="sortTable('m-table-l2', 3, true)" class="cursor-pointer select-none hover:bg-gray-200 text-left" style="width: 130px;">Сумма ⇅</th>
                        <th onclick="sortTable('m-table-l2', 4, false)" class="cursor-pointer select-none hover:bg-gray-200">Стадия / Причина провала ⇅</th>
                        <th id="th-fail-reason" onclick="sortTable('m-table-l2', 5, false)" class="cursor-pointer select-none hover:bg-gray-200 hidden">Комментарий по причине провала ⇅</th>
                        <th onclick="sortTable('m-table-l2', 6, false)" class="cursor-pointer select-none hover:bg-gray-200">Коммент. из ленты ⇅</th>
                    </tr>
                </thead>
                <tbody id="m-tbody-l2"></tbody>
            </table>
        </div>
    </div>
</div>

<script>
    const b24NumberFormat = (val) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    const b24Escape = (txt) => txt ? String(txt).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])) : '—';
    
/* Same-origin Bitrix placement supplies the employee's existing application session. */
const wmRecOrigin='https://app-8e2a6836a058.vibecode.bitrix24.tech';
const wmRecNonce=crypto.randomUUID(),wmRecPending=new Map(),wmRecCache=new Map();
let wmRecFrame=null,wmRecSource=null,wmRecReady=null,wmRecResolve=null,wmRecReject=null,wmRecObserver=null,wmRecBusy=false,wmRecQueue=new Set();
const wmRecPost=m=>wmRecSource.postMessage({channel:'wm-passport-report-v1',nonce:wmRecNonce,...m},wmRecOrigin);
window.addEventListener('message',e=>{
 if(e.origin!==wmRecOrigin||e.data?.channel!=='wm-passport-report-v1'||!wmRecFrame)return;
 const m=e.data;
 if(m.kind==='ready'&&!wmRecSource){wmRecSource=e.source;wmRecPost({kind:'connect'});return;}
 if(e.source!==wmRecSource||m.nonce!==wmRecNonce)return;
 if(m.kind==='connected')wmRecResolve();
 if(m.kind==='error')wmRecReject(Error(m.error));
 if(m.kind==='result'){const pending=wmRecPending.get(m.id);if(!pending)return;wmRecPending.delete(m.id);clearTimeout(pending.timer);m.error?pending.reject(Error(m.error)):pending.resolve(m.data);}
});
function wmRecConnect(){
 if(wmRecReady)return wmRecReady;
 wmRecReady=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Не удалось подключить паспорт. Обновите отчёт.')),30000);wmRecResolve=()=>{clearTimeout(timeout);resolve();};wmRecReject=e=>{clearTimeout(timeout);reject(e);};});
 wmRecFrame=document.createElement('iframe');wmRecFrame.title='Загрузка рекомендаций';
 wmRecFrame.src='/devops/placement/578/?IFRAME=Y&IFRAME_TYPE=SIDE_SLIDER';
 wmRecFrame.style.cssText='position:absolute;width:1px;height:1px;left:-10000px;border:0';
 document.body.append(wmRecFrame);return wmRecReady;
}
async function wmRecRequest(refs){await wmRecConnect();const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{wmRecPending.delete(id);reject(Error('Загрузка заняла слишком много времени. Повторите.'));},70000);wmRecPending.set(id,{resolve,reject,timer});wmRecPost({kind:'recommendations',id,refs});});}
const wmRecRef=c=>c.KEY||((c.TYPE==='COMPANY'||c.TYPE==='CO'?'CO':'C')+'_'+c.ID);
function wmRecCell(c,column){if(column==='dynamics')return '';const ref=wmRecRef(c);return '<td data-wm-segment="'+b24Escape(c.SEGMENT||'Не указан')+'" data-wm-head="'+b24Escape(c.WM_HEAD_TITLE||'')+'" data-wm-farmer="'+b24Escape(c.FARMER_ID||0)+'" class="wm-recommendations" data-wm-rec="'+b24Escape(ref)+'" style="min-width:230px;max-width:290px;white-space:normal;font-size:12px">Загружаем рекомендации…</td>';}
function wmRecRender(el,data){
 const ref=el.dataset.wmRec;
 if(data.error){el.innerHTML='<span>'+b24Escape(data.error)+'</span><br><button type="button" class="cell-link" data-wm-retry="'+b24Escape(ref)+'">Повторить</button>';return;}
 const hint=names=>names?.length?names.join('\n'):'Таких товарных групп нет.';
 const item=(label,names,note)=>'<span tabindex="0" style="display:block;margin:5px 0;color:#16739b;cursor:help" title="'+b24Escape(note+'\n'+hint(names))+'">'+label+'</span>';
 const earlier=data.known?item('Покупал раньше: '+data.earlier.length+' ТГ',data.earlier,'Покупал ранее, до 01.'+data.period.split('–')[0]+':'):'<span title="История покупок не сопоставлена.">Покупал раньше: нет данных</span>';
 const missing=data.segmentDefined===false?'<span style="display:block;margin-top:5px;color:#75808a">Сегмент не определён</span>':!data.specializationSaved?'<span style="display:block;margin-top:5px;color:#75808a">Паспорт не заполнен</span>':!data.gapsKnown?'<span style="display:block">Должен покупать: нет данных истории</span>':!data.expectedCount?'<span style="display:block" title="Заполните блок брендов в паспорте.">Нет рекомендаций: заполните бренды</span>':item('Должен покупать, но не покупает: '+data.missing.length+' ТГ',data.missing,'Должен покупать, но не покупает:');
 el.innerHTML=earlier+missing;el.removeAttribute('title');
}
function wmRecPaint(ref,data){document.querySelectorAll('[data-wm-rec]').forEach(el=>{if(el.dataset.wmRec===ref)wmRecRender(el,data);});}
async function wmRecDrain(){
 if(wmRecBusy||!wmRecQueue.size)return;wmRecBusy=true;
 try{while(wmRecQueue.size){const refs=[...wmRecQueue].slice(0,8);refs.forEach(r=>wmRecQueue.delete(r));try{const data=await wmRecRequest(refs);for(const ref of refs){const row=data[ref]||{error:'Нет ответа сервиса.'};if(!row.error)wmRecCache.set(ref,{at:Date.now(),data:row});wmRecPaint(ref,row);}}catch(e){for(const ref of refs)wmRecPaint(ref,{error:e.message});for(const ref of wmRecQueue)wmRecPaint(ref,{error:e.message});wmRecQueue.clear();break;}}}finally{wmRecBusy=false;}
}
function wmRecObserve(){
 const exportButton=document.getElementById('wm-export-tg');exportButton.hidden=!document.querySelector('#f-backdrop-l1 [data-wm-rec]');exportButton.disabled=false;

 wmRecObserver?.disconnect();wmRecQueue.clear();
 wmRecObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const ref=entry.target.dataset.wmRec,c=wmRecCache.get(ref);if(c&&Date.now()-c.at<60000)wmRecRender(entry.target,c.data);else wmRecQueue.add(ref);wmRecObserver.unobserve(entry.target);}wmRecDrain();},{root:document.querySelector('#f-backdrop-l1 .f-modal-body')||null,rootMargin:'60px'});
 document.querySelectorAll('[data-wm-rec]').forEach(el=>wmRecObserver.observe(el));
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-wm-retry]');if(!b)return;wmRecQueue.add(b.dataset.wmRetry);b.closest('td').textContent='Повторная загрузка…';wmRecDrain();});

function wmTgXlsx(matrix){
 const enc=new TextEncoder(),xml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,''),col=n=>String.fromCharCode(65+n);
 const sheet='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+[42,28,28,35,13,46,14,48,48,50].map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')+'</cols><sheetData>'+matrix.map((row,i)=>`<row r="${i+1}" ht="${i?Math.max(65,Math.min(390,Math.max(...row.map(v=>String(v??'').split('\n').length))*15+20)):40}" customHeight="1">`+row.map((v,j)=>typeof v==='number'?`<c r="${col(j)}${i+1}" s="${i?0:1}"><v>${v}</v></c>`:`<c r="${col(j)}${i+1}" s="${i?0:1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')+'</row>').join('')+`</sheetData><autoFilter ref="A1:J${matrix.length}"/></worksheet>`;
 const files={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Аналитика по ТГ" sheetId="1" r:id="rId1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
 'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16445E"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>',
 'xl/worksheets/sheet1.xml':sheet};
 const parts=[],central=[];let offset=0;const u16=(v,n,x)=>v.setUint16(n,x,true),u32=(v,n,x)=>v.setUint32(n,x>>>0,true);
 for(const [name,content]of Object.entries(files)){const n=enc.encode(name),data=enc.encode(content);let crc=0xffffffff;for(const b of data){crc^=b;for(let k=0;k<8;k++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}crc=(crc^0xffffffff)>>>0;const h=new Uint8Array(30+n.length),v=new DataView(h.buffer);u32(v,0,0x04034b50);u16(v,4,20);u16(v,6,0x800);u32(v,14,crc);u32(v,18,data.length);u32(v,22,data.length);u16(v,26,n.length);h.set(n,30);parts.push(h,data);const c=new Uint8Array(46+n.length),cv=new DataView(c.buffer);u32(cv,0,0x02014b50);u16(cv,4,20);u16(cv,6,20);u16(cv,8,0x800);u32(cv,16,crc);u32(cv,20,data.length);u32(cv,24,data.length);u16(cv,28,n.length);u32(cv,42,offset);c.set(n,46);central.push(c);offset+=h.length+data.length;}
 const end=new Uint8Array(22),v=new DataView(end.buffer);u32(v,0,0x06054b50);u16(v,8,central.length);u16(v,10,central.length);u32(v,12,central.reduce((a,c)=>a+c.length,0));u32(v,16,offset);return new Blob([...parts,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
async function wmExportTg(){
 const button=document.getElementById('wm-export-tg'),cells=[...document.querySelectorAll('#f-backdrop-l1 [data-wm-rec]')],refs=[...new Set(cells.map(c=>c.dataset.wmRec))];if(!refs.length)return;
 button.disabled=true;const label=button.textContent;try{
 const deadline=Date.now()+180000;while(wmRecBusy){if(Date.now()>deadline)throw Error('Загрузка ещё не завершена. Повторите экспорт.');await new Promise(r=>setTimeout(r,300));}
 for(let i=0;i<refs.length;i+=4){button.textContent='Загрузка ТГ '+Math.min(i+4,refs.length)+' / '+refs.length;const pack=refs.slice(i,i+4),need=pack.filter(r=>!wmRecCache.has(r));if(need.length){const data=await wmRecRequest(need);for(const ref of need){if(!data[ref]||data[ref].error)throw Error(data[ref]?.error||'Не удалось загрузить ТГ');wmRecCache.set(ref,{at:Date.now(),data:data[ref]});wmRecPaint(ref,data[ref]);}}}
 if(cells.some(c=>!c.isConnected))throw Error('Детализация изменилась. Откройте экспорт заново.');
 const matrix=[['Контрагент','Сегмент клиента','Фермер','Головной КА / роль в группе','Покупал раньше, ТГ','Список ТГ — покупал раньше','Должен покупать, ТГ','Список ТГ — должен покупать, но не покупает','Последний обычный комментарий','Карточка CRM']];
 const seen=new Set();for(const c of cells){const ref=c.dataset.wmRec;if(seen.has(ref))continue;seen.add(ref);const tr=c.closest('tr'),a=tr.cells[1].querySelector('a'),d=wmRecCache.get(ref).data;matrix.push([a.textContent.trim(),c.dataset.wmSegment||'Не указан',document.querySelector('[name="farmer_id"] option[value="'+c.dataset.wmFarmer+'"]')?.textContent||(Number(c.dataset.wmFarmer)?'Сотрудник #'+c.dataset.wmFarmer:'Не назначен'),[c.dataset.wmHead,tr.cells[1].innerText.replace(a.textContent,'').trim()].filter(Boolean).join(' · '),d.known?d.earlier.length:'Нет данных',d.earlier?.join('\n')||'—',d.segmentDefined!==false&&d.gapsKnown&&d.specializationSaved?d.missing.length:'Нет данных',d.segmentDefined===false?'Сегмент не определён':!d.specializationSaved?'Паспорт не заполнен':!d.gapsKnown?'Нет подтверждённой истории':!d.expectedCount?'Нет рекомендаций: заполните бренды':d.missing.join('\n')||'—',tr.cells[4].innerText.trim(),new URL(a.getAttribute('href'),location.origin).href]);}
 const url=URL.createObjectURL(wmTgXlsx(matrix)),link=document.createElement('a');link.href=url;link.download='Аналитика по ТГ.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
 }catch(e){alert('Экспорт не выполнен: '+e.message);}finally{button.disabled=false;button.textContent=label;}
}

    let currentL1FarmerId = null;
    let wmAppliedFilters = null;
    let wmReportSnapshotToken = "";
    let wmGenerateVersion=0;
    const wmModalVersions=[0,0,0];
    const wmRoleNames = {head:'Головной контрагент',member:'Участник группы',none:'Без аффилированности'};
    function wmRoleDetails(client) {
        const role='<div style="font-size:12px;color:#527286;margin-top:5px">'+b24Escape(wmRoleNames[client.ROLE]||'Без роли')+'</div>';
        if(wmAppliedFilters?.get('affiliation')!=='head') return role;
        const count=(client.MEMBERS||[]).filter(m=>!m.IS_HEAD).length;
        if(!count)return client.ROLE==='none'?role:role+'<div style="font-size:12px;color:#75818c">Без участников</div>';
        return '<div style="font-size:12px;font-weight:600;margin-top:5px">Вся группа · головной КА и '+count+' участников</div><button type="button" class="cell-link" style="font-size:13px;margin-top:7px" aria-expanded="false" onclick="wmToggleMembers(this)"><span class="wm-member-arrow" aria-hidden="true">▸</span> Участники: '+count+'</button>';
    }
    function wmToggleMembers(button){
        const root=button.closest('tr');
        const open=button.getAttribute('aria-expanded')!=='true';
        button.setAttribute('aria-expanded',String(open));
        button.querySelector('.wm-member-arrow').textContent=open?'▾':'▸';
        for(let row=root.nextElementSibling;row&&row.classList.contains('wm-member-row');row=row.nextElementSibling)row.style.display=open?'':'none';
    }
    function wmMemberRows(root,column){
        if(wmAppliedFilters?.get('affiliation')!=='head'||!(root.MEMBERS||[]).some(m=>!m.IS_HEAD))return '';
        return root.MEMBERS.map(m=>{
            const amount=(value,metric)=>{
                if(!value)return '<span style="color:#667789">0,00 р.</span>';
                const args=[root.ID,root.TYPE,metric,m.TITLE,0,m.KEY];
                const call='openModalL2('+args.map(v=>JSON.stringify(v)).join(',')+')';
                return '<button type="button" class="cell-link" style="font-size:13px" onclick="'+b24Escape(call)+'">'+b24NumberFormat(value)+' р.</button>';
            };
            let cells='';
            if(column==='base'||column==='active')cells='<td>'+amount(m.SUM_IN_WORK,'work')+'</td><td>'+amount(m.SUM_REALIZATION,'realization_work')+'</td>';
            else if(column==='sleeping')cells='<td>'+b24Escape(m.LAST_SUCCESS_DATE)+'</td><td>'+(m.SUM_REALIZATION>0?amount(m.SUM_REALIZATION,'realization_work'):b24Escape(m.LAST_SUCCESS_REAL_DATE))+'</td>';
            else if(column==='turnover')cells='<td>'+amount(m.REALIZATION_CUR,'realization')+'</td><td>'+(m.SUM_IN_WORK>0?amount(m.SUM_IN_WORK,'work'):b24Escape(m.LAST_SUCCESS_DATE))+'</td>';
            else if(column==='failed')cells='<td>'+amount(m.SUM_FAILED,'failed')+'</td>';
            else if(column==='dynamics')cells='<td>'+amount(m.REALIZATION_CUR-m.REALIZATION_PREV,'dynamics')+'</td>';
            return '<tr class="wm-member-row" data-wm-key="'+b24Escape(m.KEY)+'" style="display:none;background:'+(m.IS_HEAD?'#edf4f8':'#f8fbfd')+'"><td></td><td style="padding-left:24px;border-left:3px solid #aecbdc"><a href="'+b24Escape(m.LINK)+'" target="_blank" rel="noopener" class="text-blue-link">'+b24Escape(m.TITLE)+'</a><div style="font-size:12px;color:#687f8c;margin-top:4px">'+(m.IS_HEAD?'Сам головной · собственные показатели':'Участник группы · собственные показатели')+'</div></td><td class="cell-dir-path">'+b24Escape(m.DIRECTORY_PATH)+'</td><td>'+b24Escape(m.CORE_TAIL)+'</td><td style="white-space:normal;overflow-wrap:anywhere">'+b24Escape(m.COMMENT)+'</td>'+cells+wmRecCell({...m,WM_HEAD_TITLE:root.TITLE},column)+'</tr>';
        }).join('');
    }

    // Avoid injecting CRM titles into inline JavaScript handlers.
    const wmJsLabel = value => b24Escape(JSON.stringify(String(value||'')));

    // Функция открытия слайдера/вкладки создания задачи по CRM-сущности (Клиент/Компания/Контакт)
    function openTaskCreate(entityId, entityType, farmerId = 0) {
        const crmPrefix = (entityType === 'COMPANY' || entityType === 'CO') ? 'CO_' : 'C_';
        const targetFarmerId = parseInt(farmerId || currentL1FarmerId) || 0;

        const taskUrl = `/company/personal/user/0/tasks/task/edit/0/?UF_CRM_TASK=${crmPrefix}${entityId}`;
        const sliderOptions = {
            allowChangeHistory: false
        };

        if (targetFarmerId > 0) {
            sliderOptions.events = {
                onLoad: function(event) {
                    setTimeout(function() {
                        const win = event.getSlider().getWindow();
                        if (!win) return;
                        const doc = win.document;
                        const cardEl = doc.querySelector('[data-task-id]');
                        const taskId = cardEl ? cardEl.getAttribute('data-task-id') : null;

                        if (taskId && win.BX && win.BX.Tasks && win.BX.Tasks.V2) {
                            win.BX.rest.callMethod('user.get', { ID: targetFarmerId }, function(result) {
                                if (result.data() && result.data()[0]) {
                                    const u = result.data()[0];
                                    const fullName = (u.NAME + ' ' + u.LAST_NAME).trim() || u.LOGIN;
                                    const userModel = {
                                        id: parseInt(u.ID),
                                        name: fullName,
                                        title: fullName,
                                        avatar: u.PERSONAL_PHOTO || '',
                                        icon: u.PERSONAL_PHOTO || '',
                                        link: `/company/personal/user/${u.ID}/`,
                                        workPosition: u.WORK_POSITION || ''
                                    };

                                    const store = win.BX.Tasks.V2.Core.getStore();
                                    store.dispatch('users/upsertMany', [userModel]);

                                    win.BX.Tasks.V2.Provider.Service.taskService.updateStoreTask(taskId, {
                                        responsibleIds: [targetFarmerId]
                                    });
                                }
                            });
                        }
                    }, 600);
                }
            };
        }

        if (window.BX && window.BX.SidePanel) {
            window.BX.SidePanel.Instance.open(taskUrl, sliderOptions);
        } else {
            window.open(taskUrl, '_blank');
        }
    }

    // --- Логика групповой постановки задач ---
    let isBulkTaskProcessing = false;

    function toggleSelectAllL1(masterChk) {
        const chks = document.querySelectorAll('.m-client-chk');
        chks.forEach(chk => chk.checked = masterChk.checked);
        updateBulkTaskCount();
    }

    function updateBulkTaskCount() {
        const checked = document.querySelectorAll('.m-client-chk:checked');
        const count = checked.length;
        const btn = document.getElementById('btn-bulk-tasks');
        const countEl = document.getElementById('bulk-task-count');
        
        if (countEl) countEl.textContent = count;
        if (btn) {
            if (count > 0) {
                btn.classList.remove('hidden');
                btn.style.display = 'inline-flex';
            } else {
                btn.classList.add('hidden');
                btn.style.display = 'none';
            }
        }
    }

    // --- Логика извлечения ID задачи из любого вида слайдера Б24 ---
    function extractTaskIdFromSlider(slider) {
        if (!slider) return null;

        // 1. Проверка minimizeOptions (Битрикс24 Tasks V2)
        if (slider.minimizeOptions && slider.minimizeOptions.entityId) {
            console.log('[BulkTask] Найдено ID задачи в slider.minimizeOptions.entityId:', slider.minimizeOptions.entityId);
            return parseInt(slider.minimizeOptions.entityId);
        }

        // 2. Проверка URL слайдера (регулярное выражение по роутингу /tasks/task/view/12345/)
        const url = (typeof slider.getUrl === 'function' ? slider.getUrl() : slider.url) || '';
        if (url) {
            const match = url.match(/\/tasks\/task\/view\/(\d+)/i) || url.match(/\/task\/view\/(\d+)/i) || url.match(/[\?&]TASK_ID=(\d+)/i);
            if (match && match[1]) {
                console.log('[BulkTask] Извлечен ID задачи из URL слайдера (' + url + '):', match[1]);
                return parseInt(match[1]);
            }
        }

        // 3. Проверка контейнера данных слайдера (slider.getData())
        if (slider.getData) {
            try {
                const data = slider.getData();
                if (data) {
                    if (data.taskId) return parseInt(data.taskId);
                    if (data.entityId) return parseInt(data.entityId);
                    if (typeof data.get === 'function' && data.get('taskId')) return parseInt(data.get('taskId'));
                }
            } catch (e) {}
        }

        return null;
    }

    function runBulkTaskCreate() {
        if (isBulkTaskProcessing) {
            console.warn('[BulkTask] Процесс постановки уже запущен.');
            return;
        }
        
        const checkedBoxes = Array.from(document.querySelectorAll('.m-client-chk:checked'));
        if (checkedBoxes.length === 0) {
            console.warn('[BulkTask] Нет выбранных клиентов.');
            return;
        }

        const selectedClients = checkedBoxes.map(chk => ({
            id: parseInt(chk.getAttribute('data-id')),
            type: chk.getAttribute('data-type'),
            farmerId: parseInt(chk.getAttribute('data-farmer')) || 0
        }));

        console.log('[BulkTask] Выбранные клиенты для постановки задач:', selectedClients);

        const firstClient = selectedClients[0];
        const farmerId = firstClient.farmerId || currentL1FarmerId || 0;

        if (selectedClients.length === 1) {
            console.log('[BulkTask] Выбран 1 клиент, открываем стандартное создание задачи.');
            openTaskCreate(firstClient.id, firstClient.type, farmerId);
            return;
        }

        const crmPrefix = (firstClient.type === 'COMPANY' || firstClient.type === 'CO') ? 'CO_' : 'C_';
        const taskUrl = `/company/personal/user/0/tasks/task/edit/0/?UF_CRM_TASK=${crmPrefix}${firstClient.id}`;

        let capturedTaskId = null;

        const handleCapturedTask = function(taskId, sourceName) {
            if (!taskId || capturedTaskId) return;
            capturedTaskId = taskId;
            console.log(`[BulkTask] УСПЕШНО ИЗВЛЕЧЕН ID первой созданной задачи=${taskId} (источник: ${sourceName}). Запускаем копирование на остальной список (${selectedClients.length - 1} клиент(ов))...`);
            
            if (window.BX && window.BX.removeCustomEvent) {
                window.BX.removeCustomEvent('SidePanel.Slider:onMessage', onSliderMessage);
            }
            if (window.top && window.top.BX && window.top.BX.removeCustomEvent) {
                window.top.BX.removeCustomEvent('SidePanel.Slider:onMessage', onSliderMessage);
            }

            cloneTaskToClients(capturedTaskId, selectedClients.slice(1));
        };

        const onSliderMessage = function(event) {
            console.log('[BulkTask] Перехвачено событие SidePanel.Slider:onMessage:', event);
            
            let eventId = '';
            let eventData = {};

            if (event && typeof event.getEventId === 'function') {
                eventId = event.getEventId();
            }
            if (event && typeof event.getData === 'function') {
                eventData = event.getData() || {};
            } else if (event && event.data) {
                eventData = event.data;
            }

            const slider = (event && typeof event.getSlider === 'function') ? event.getSlider() : null;
            let taskId = extractTaskIdFromSlider(slider);

            if (!taskId) {
                taskId = eventData.taskId || (eventData.task ? (eventData.task.id || eventData.task.ID) : (eventData.id || eventData.ID || null));
            }

            console.log('[BulkTask] Данные события на сопоставлении:', { eventId, eventData, taskId });

            if (taskId) {
                handleCapturedTask(taskId, 'SidePanel:onMessage (' + eventId + ')');
            }
        };

        if (window.BX && window.BX.addCustomEvent) {
            window.BX.addCustomEvent('SidePanel.Slider:onMessage', onSliderMessage);
        }
        if (window.top && window.top.BX && window.top.BX.addCustomEvent && window.top.BX !== window.BX) {
            window.top.BX.addCustomEvent('SidePanel.Slider:onMessage', onSliderMessage);
        }

        if (window.BX && window.BX.SidePanel) {
            const sliderOptions = { allowChangeHistory: false };
            
            sliderOptions.events = {
                onClose: function(event) {
                    console.log('[BulkTask] Слайдер закрылся (onClose). Event:', event);
                    const slider = event.getSlider ? event.getSlider() : null;
                    const taskId = extractTaskIdFromSlider(slider);
                    if (taskId) {
                        handleCapturedTask(taskId, 'Slider:onClose');
                    }
                },
                onDestroy: function(event) {
                    console.log('[BulkTask] Слайдер уничтожен (onDestroy). Event:', event);
                    const slider = event.getSlider ? event.getSlider() : null;
                    const taskId = extractTaskIdFromSlider(slider);
                    if (taskId) {
                        handleCapturedTask(taskId, 'Slider:onDestroy');
                    }
                }
            };

            if (farmerId > 0) {
                const originalOnLoad = sliderOptions.events.onLoad;
                sliderOptions.events.onLoad = function(e) {
                    if (originalOnLoad) originalOnLoad(e);
                    setTimeout(function() {
                        const win = e.getSlider().getWindow();
                        if (!win) return;
                        const doc = win.document;
                        const cardEl = doc.querySelector('[data-task-id]');
                        const taskId = cardEl ? cardEl.getAttribute('data-task-id') : null;

                        if (taskId && win.BX && win.BX.Tasks && win.BX.Tasks.V2) {
                            win.BX.rest.callMethod('user.get', { ID: farmerId }, function(result) {
                                if (result.data() && result.data()[0]) {
                                    const u = result.data()[0];
                                    const fullName = (u.NAME + ' ' + u.LAST_NAME).trim() || u.LOGIN;
                                    const userModel = {
                                        id: parseInt(u.ID),
                                        name: fullName,
                                        title: fullName,
                                        avatar: u.PERSONAL_PHOTO || '',
                                        icon: u.PERSONAL_PHOTO || '',
                                        link: `/company/personal/user/${u.ID}/`,
                                        workPosition: u.WORK_POSITION || ''
                                    };

                                    const store = win.BX.Tasks.V2.Core.getStore();
                                    store.dispatch('users/upsertMany', [userModel]);

                                    win.BX.Tasks.V2.Provider.Service.taskService.updateStoreTask(taskId, {
                                        responsibleIds: [farmerId]
                                    });
                                }
                            });
                        }
                    }, 600);
                };
            }
            
            console.log('[BulkTask] Открываем слайдер первой задачи:', taskUrl);
            window.BX.SidePanel.Instance.open(taskUrl, sliderOptions);
        } else {
            alert('Групповая постановка задач доступна в интерфейсе Битрикс24.');
        }
    }

    function cloneTaskToClients(sourceTaskId, targetClients) {
        if (!window.BX || !window.BX.rest) {
            console.error('[BulkTask] BX.rest недоступен.');
            return;
        }

        isBulkTaskProcessing = true;
        console.log(`[BulkTask] Запрос данных исходной задачи ID=${sourceTaskId}...`);
        
        if (window.BX.UI && window.BX.UI.Notification) {
            window.BX.UI.Notification.Center.notify({
                content: `Копирование задачи на остальных клиентов (${targetClients.length})...`
            });
        }

        window.BX.rest.callMethod('tasks.task.get', { taskId: sourceTaskId }, function(res) {
            console.log('[BulkTask] Ответ tasks.task.get:', res);
            
            if (res.error()) {
                console.error('[BulkTask] Ошибка получения исходной задачи:', res.error());
                isBulkTaskProcessing = false;
                return;
            }

            const rawData = res.data();
            const taskData = rawData ? (rawData.task || rawData) : null;
            
            console.log('[BulkTask] Данные задачи:', taskData);

            if (!taskData) {
                console.error('[BulkTask] Не удалось извлечь данные задачи из ответа REST API.');
                isBulkTaskProcessing = false;
                return;
            }

            // Извлекаем поля независимо от регистра символов
            const title = taskData.title || taskData.TITLE || '';
            const description = taskData.description || taskData.DESCRIPTION || '';
            const responsibleId = taskData.responsibleId || taskData.RESPONSIBLE_ID || (taskData.responsible ? taskData.responsible.id : 0);
            const createdBy = taskData.createdBy || taskData.CREATED_BY || (taskData.creator ? taskData.creator.id : 0);
            const priority = taskData.priority || taskData.PRIORITY || 1;
            const deadline = taskData.deadline || taskData.DEADLINE || '';
            const accomplices = taskData.accomplices || taskData.ACCOMPLICES || [];
            const auditors = taskData.auditors || taskData.AUDITORS || [];

            console.log('[BulkTask] Сформированные параметры задачи для клонирования:', {
                title, description, responsibleId, createdBy, priority, deadline, accomplices, auditors
            });

            const batchRequests = {};
            targetClients.forEach((client, idx) => {
                const crmPrefix = (client.type === 'COMPANY' || client.type === 'CO') ? 'CO_' : 'C_';
                const fields = {
                    TITLE: title,
                    DESCRIPTION: description,
                    RESPONSIBLE_ID: responsibleId,
                    PRIORITY: priority,
                    UF_CRM_TASK: [crmPrefix + client.id]
                };

                if (createdBy) fields.CREATED_BY = createdBy;
                if (deadline) fields.DEADLINE = deadline;
                if (accomplices && accomplices.length > 0) fields.ACCOMPLICES = accomplices;
                if (auditors && auditors.length > 0) fields.AUDITORS = auditors;

                batchRequests['task_' + idx] = ['tasks.task.add', { fields: fields }];
            });

            console.log('[BulkTask] Отправка пакетного запроса BX.rest.callBatch:', batchRequests);

            window.BX.rest.callBatch(batchRequests, function(batchResult) {
                console.log('[BulkTask] Результат выполнения BX.rest.callBatch:', batchResult);
                
                isBulkTaskProcessing = false;
                
                const masterChk = document.getElementById('chk-all-l1');
                if (masterChk) masterChk.checked = false;
                document.querySelectorAll('.m-client-chk').forEach(c => c.checked = false);
                updateBulkTaskCount();

                const totalCount = targetClients.length + 1;
                console.log(`[BulkTask] Успешно завершено! Создано задач: ${totalCount}`);

                if (window.BX.UI && window.BX.UI.Notification) {
                    window.BX.UI.Notification.Center.notify({
                        content: `Успешно создано задач для клиентов: ${totalCount}`,
                        autoHideDelay: 5000
                    });
                } else {
                    alert(`Успешно создано задач для клиентов: ${totalCount}`);
                }
            });
        });
    }

    const getDateParams = () => {
        const form = document.getElementById('f-filter-form');
        const fd = new FormData(form);
        const source = wmAppliedFilters || new URLSearchParams(fd);
        return new URLSearchParams({date_from:source.get('date_from'),date_to:source.get('date_to'),affiliation:source.get('affiliation')||'all',sales_direction:source.get('sales_direction')||'all',scope_farmer_id:source.get('farmer_id')||'0',department_id:source.get('department_id')||'0',report_snapshot:wmReportSnapshotToken}).toString();
    };

    function sortTable(tableId, colIndex, isNumeric = false) {
        const table = document.getElementById(tableId);
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr:not(.total-row):not(.wm-member-row)'));
        const children = new Map(rows.map(row=>{const items=[];for(let next=row.nextElementSibling;next&&next.classList.contains('wm-member-row');next=next.nextElementSibling)items.push(next);return [row,items];}));
        const totalRow = tbody.querySelector('.total-row');
        
        if (rows.length === 0) return;

        const currentDir = table.getAttribute('data-sort-dir') === 'asc' ? 'desc' : 'asc';
        table.setAttribute('data-sort-dir', currentDir);
        
        rows.sort((a, b) => {
            let valA = a.cells[colIndex].innerText.trim();
            let valB = b.cells[colIndex].innerText.trim();
            
            if (isNumeric) {
                valA = parseFloat(valA.replace(/[^0-9.-]/g, '')) || 0;
                valB = parseFloat(valB.replace(/[^0-9.-]/g, '')) || 0;
                return currentDir === 'asc' ? valA - valB : valB - valA;
            } else {
                return currentDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
        });
        
        tbody.innerHTML = '';
        rows.forEach(row => {tbody.appendChild(row);(children.get(row)||[]).forEach(child=>tbody.appendChild(child));});
        if (totalRow) tbody.appendChild(totalRow);
    }

    // Генерация отчета (Главная таблица)
    document.getElementById('f-filter-form').addEventListener('submit', function(e) {
        e.preventDefault();
        const form = document.getElementById('f-filter-form');
        const requestFilters = new URLSearchParams(new FormData(form));
        const params = requestFilters.toString();
        const generation=++wmGenerateVersion;wmReportSnapshotToken="";
        closeModal(1); closeModal(2);
        
        const tbody = document.getElementById('report-tbody');
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-400"><div class="loader-spinner ease-linear rounded-full border-4 border-t-4 border-gray-200 h-8 w-8 mx-auto mb-2"></div>Загрузка...</td></tr>';
        
        fetch(`?action=generate_report&${params}&_wm_request=${Date.now()}`, {cache:'no-store'})
            .then(res => res.json())
            .then(res => {
                if(generation!==wmGenerateVersion)return;
                if (!res.success) throw new Error(res.error||'Report error');
                wmReportSnapshotToken=res.report_snapshot;
                wmAppliedFilters = requestFilters;
                if (res.data.length > 0) {
                    let totalBaseCount = 0, totalActiveCount = 0, totalActiveSum = 0, totalSleepingCount = 0, totalRealizationSum = 0, totalFailuresSum = 0, totalDynamicsSum = 0;
                    const htmlRows = [];

                    res.data.forEach(row => {
                        totalBaseCount += row.BASE_COUNT;
                        totalActiveCount += row.ACTIVE_COUNT;
                        totalActiveSum += row.ACTIVE_SUM;
                        totalSleepingCount += row.SLEEPING_COUNT;
                        totalRealizationSum += row.REALIZATION_SUM;
                        totalFailuresSum += row.FAILURES_SUM;
                        totalDynamicsSum += row.DYNAMICS_SUM;

                        const dynSign = row.DYNAMICS_SUM > 0 ? '+' : '';
                        const dynClass = row.DYNAMICS_SUM > 0 ? 'dyn-pos' : (row.DYNAMICS_SUM < 0 ? 'dyn-neg' : 'dyn-zero');

                        htmlRows.push(`
                            <tr>
                                <td style="font-weight: 500; color: #333;">${b24Escape(row.FARMER_NAME)}</td>
                                
                                <!-- База шт -->
                                <td>
                                    <button onclick="openModalL1(${row.FARMER_ID}, 'base', 'Детализация базы')" class="cell-link">
                                        ${row.BASE_COUNT} шт.
                                    </button>
                                </td>

                                <!-- Активная база шт + руб -->
                                <td>
                                    <button onclick="openModalL1(${row.FARMER_ID}, 'active', 'Детализация активной базы')" class="cell-link">
                                        ${row.ACTIVE_COUNT} шт. (${b24NumberFormat(row.ACTIVE_SUM)} р.)
                                    </button>
                                </td>

                                <!-- Спящая база шт -->
                                <td>
                                    <button onclick="openModalL1(${row.FARMER_ID}, 'sleeping', 'Детализация спящей базы')" class="cell-link" style="color: #d97706;">
                                        ${row.SLEEPING_COUNT} шт.
                                    </button>
                                </td>

                                <!-- Реализация базы руб -->
                                <td>
                                    <button onclick="openModalL1(${row.FARMER_ID}, 'turnover', 'Детализация завершённой реализации')" class="cell-link font-semibold" style="color: #2e7d32;">
                                        ${b24NumberFormat(row.REALIZATION_SUM)} р.
                                    </button>
                                </td>

                                <!-- Провалы базы руб -->
                                <td>
                                    <button onclick="openModalL1(${row.FARMER_ID}, 'failed', 'Детализация провалов')" class="cell-link" style="color: #c62828;">
                                        ${b24NumberFormat(row.FAILURES_SUM)} р.
                                    </button>
                                </td>

                                <!-- Динамика базы руб -->
                                <td>
                                    <button onclick="openModalL1(${row.FARMER_ID}, 'dynamics', 'Детализация динамики базы')" class="cell-link ${dynClass}">
                                        ${dynSign}${b24NumberFormat(row.DYNAMICS_SUM)} р.
                                    </button>
                                </td>
                            </tr>
                        `);
                    });

                    const totDynSign = totalDynamicsSum > 0 ? '+' : '';
                    const totDynClass = totalDynamicsSum > 0 ? 'dyn-pos' : (totalDynamicsSum < 0 ? 'dyn-neg' : 'dyn-zero');

                    // Строка Итого главной таблицы
                    htmlRows.push(`
                        <tr class="total-row">
                            <td>Итого</td>
                            <td>
                                <button onclick="openModalL1(0, 'base', 'Детализация общей базы')" class="cell-link font-bold">
                                    ${totalBaseCount} шт.
                                </button>
                            </td>
                            <td>
                                <button onclick="openModalL1(0, 'active', 'Детализация общей активной базы')" class="cell-link font-bold">
                                    ${totalActiveCount} шт. (${b24NumberFormat(totalActiveSum)} р.)
                                </button>
                            </td>
                            <td>
                                <button onclick="openModalL1(0, 'sleeping', 'Детализация общей спящей базы')" class="cell-link font-bold" style="color: #d97706;">
                                    ${totalSleepingCount} шт.
                                </button>
                            </td>
                            <td>
                                <button onclick="openModalL1(0, 'turnover', 'Детализация завершённой реализации всей базы базы')" class="cell-link font-bold" style="color: #2e7d32;">
                                    ${b24NumberFormat(totalRealizationSum)} р.
                                </button>
                            </td>
                            <td>
                                <button onclick="openModalL1(0, 'failed', 'Детализация общих провалов')" class="cell-link font-bold" style="color: #c62828;">
                                    ${b24NumberFormat(totalFailuresSum)} р.
                                </button>
                            </td>
                            <td>
                                <button onclick="openModalL1(0, 'dynamics', 'Детализация общей динамики базы')" class="cell-link font-bold ${totDynClass}">
                                    ${totDynSign}${b24NumberFormat(totalDynamicsSum)} р.
                                </button>
                            </td>
                        </tr>
                    `);
                    tbody.innerHTML = htmlRows.join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-400">Данные не найдены.</td></tr>';
                }
            }).catch(() => {
                if(generation!==wmGenerateVersion)return;
                tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-red-500">Произошла ошибка построения отчета.</td></tr>';
            });
    });

    // Открытие УРОВНЯ 1 (Список клиентов)
    function openModalL1(farmerId, column, title) {
        const requestLevel=1,requestVersion=++wmModalVersions[1];
        currentL1FarmerId = farmerId;
        const backdrop = document.getElementById('f-backdrop-l1');
        document.getElementById('modal-title-l1').textContent = title;
        const thead = document.getElementById('m-thead-l1');
        const tbody = document.getElementById('m-tbody-l1');
        const loader = document.getElementById('m-loader-l1');
        
        const masterChk = document.getElementById('chk-all-l1');
        if (masterChk) masterChk.checked = false;
        updateBulkTaskCount();

        // Динамическая шапка таблицы Уровня 1
        let theadHtml = `
            <tr>
                <th style="width: 35px; text-align: center !important;"><input type="checkbox" id="chk-all-l1" onclick="toggleSelectAllL1(this)"></th>
                <th onclick="sortTable('m-table-l1', 1, false)" class="cursor-pointer select-none hover:bg-gray-200">Наименование Клиента/компании ⇅</th>
                <th onclick="sortTable('m-table-l1', 2, false)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 220px;">Путь в справочнике из 1С ⇅</th>
                <th onclick="sortTable('m-table-l1', 3, false)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 120px;">Ядро/хвост ⇅</th>
                <th onclick="sortTable('m-table-l1', 4, false)" class="cursor-pointer select-none hover:bg-gray-200">Последний комментарий клиента ⇅</th>
        `;

        if (column === 'base' || column === 'active') {
            theadHtml += `
                <th onclick="sortTable('m-table-l1', 5, true)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 140px;">Сумма в работе ⇅</th>
                <th onclick="sortTable('m-table-l1', 6, true)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 140px;">Активная реализация, ₽ ⇅</th>
            `;
        } else if (column === 'sleeping') {
            theadHtml += `
                <th onclick="sortTable('m-table-l1', 5, false)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 150px;">Дата последнего успеха ⇅</th>
                <th onclick="sortTable('m-table-l1', 6, false)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 150px;">Активная реализация, ₽ ⇅</th>
            `;
        } else if (column === 'turnover') {
            theadHtml += `
                <th onclick="sortTable('m-table-l1', 5, true)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 140px;">Завершённая реализация, ₽ ⇅</th>
                <th onclick="sortTable('m-table-l1', 6, false)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 150px;">В работе ⇅</th>
            `;
        } else if (column === 'failed') {
            theadHtml += `
                <th onclick="sortTable('m-table-l1', 5, true)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 140px;">Сумма провалов ⇅</th>
            `;
        } else if (column === 'dynamics') {
            theadHtml += `
                <th onclick="sortTable('m-table-l1', 5, true)" class="cursor-pointer select-none hover:bg-gray-200" style="width: 140px;">Динамика КА ⇅</th>
            `;
        }
        if(column!=='dynamics')theadHtml+='<th style="min-width:230px">Аналитика по ТГ</th>';
        theadHtml += `</tr>`;
        thead.innerHTML = theadHtml;

        tbody.innerHTML = '';
        backdrop.style.display = 'flex';
        loader.classList.remove('hidden');

        fetch(`?action=get_details&farmer_id=${farmerId}&column=${column}&${getDateParams()}&_wm_request=${Date.now()}`, {cache:'no-store'})
            .then(res => res.json())
            .then(res => {
                if(requestVersion!==wmModalVersions[requestLevel])return;
                loader.classList.add('hidden');
                if(!res.success)throw new Error(res.error||'Ошибка расчёта');
                if (res.data.length > 0) {
                    let totalCol1Sum = 0, totalCol2Sum = 0;
                    const htmlRows = [];

                    res.data.forEach(client => {
                        const fId = client.FARMER_ID || farmerId || currentL1FarmerId;

                        let col1Html = '', col2Html = '';

                        if (column === 'base' || column === 'active') {
                            totalCol1Sum += client.SUM_IN_WORK;
                            totalCol2Sum += client.SUM_REALIZATION;

                            col1Html = client.SUM_IN_WORK !== 0 
                                ? `<button onclick="openModalL2(${client.ID}, '${client.TYPE}', 'work', ${wmJsLabel(client.TITLE)})" class="text-blue-link font-bold bg-transparent border-0 p-0 cursor-pointer text-xs">${b24NumberFormat(client.SUM_IN_WORK)} р.</button>`
                                : `<span class="text-gray-400">0.00 р.</span>`;

                            col2Html = client.SUM_REALIZATION !== 0 
                                ? `<button onclick="openModalL2(${client.ID}, '${client.TYPE}', 'realization_work', ${wmJsLabel(client.TITLE)})" class="text-blue-link font-bold bg-transparent border-0 p-0 cursor-pointer text-xs">${b24NumberFormat(client.SUM_REALIZATION)} р.</button>`
                                : `<span class="text-gray-400">0.00 р.</span>`;

                        } else if (column === 'sleeping') {
                            col1Html = `<span class="font-semibold text-gray-700">${client.LAST_SUCCESS_DATE}</span>`;

                            if (client.SUM_REALIZATION !== 0) {
                                col2Html = `<button onclick="openModalL2(${client.ID}, '${client.TYPE}', 'realization_work', ${wmJsLabel(client.TITLE)})" class="text-blue-link font-bold bg-transparent border-0 p-0 cursor-pointer text-xs">${b24NumberFormat(client.SUM_REALIZATION)} р.</button>`;
                            } else {
                                col2Html = `<span class="text-gray-600 font-semibold">${client.LAST_SUCCESS_REAL_DATE}</span>`;
                            }

                        } else if (column === 'turnover') {
                            totalCol1Sum += client.REALIZATION_CUR;

                            col1Html = client.REALIZATION_CUR !== 0 
                                ? `<button onclick="openModalL2(${client.ID}, '${client.TYPE}', 'realization', ${wmJsLabel(client.TITLE)})" class="text-blue-link font-bold bg-transparent border-0 p-0 cursor-pointer text-xs">${b24NumberFormat(client.REALIZATION_CUR)} р.</button>`
                                : `<span class="text-gray-400">0.00 р.</span>`;

                            if (client.SUM_IN_WORK !== 0) {
                                col2Html = `<button onclick="openModalL2(${client.ID}, '${client.TYPE}', 'work', ${wmJsLabel(client.TITLE)})" class="text-blue-link font-bold bg-transparent border-0 p-0 cursor-pointer text-xs">${b24NumberFormat(client.SUM_IN_WORK)} р.</button>`;
                            } else {
                                col2Html = `<span class="text-gray-600 font-semibold">${client.LAST_SUCCESS_DATE}</span>`;
                            }

                        } else if (column === 'failed') {
                            totalCol1Sum += client.SUM_FAILED;

                            col1Html = client.SUM_FAILED !== 0 
                                ? `<button onclick="openModalL2(${client.ID}, '${client.TYPE}', 'failed', ${wmJsLabel(client.TITLE)})" class="text-blue-link font-bold bg-transparent border-0 p-0 cursor-pointer text-xs" style="color:#c62828">${b24NumberFormat(client.SUM_FAILED)} р.</button>`
                                : `<span class="text-gray-400">0.00 р.</span>`;

                        } else if (column === 'dynamics') {
                            const dynVal = client.REALIZATION_CUR - client.REALIZATION_PREV;
                            totalCol1Sum += dynVal;
                            const dSign = dynVal > 0 ? '+' : '';
                            const dClass = dynVal > 0 ? 'dyn-pos' : (dynVal < 0 ? 'dyn-neg' : 'dyn-zero');

                            col1Html = `<button onclick="openModalL2(${client.ID}, '${client.TYPE}', 'dynamics', ${wmJsLabel(client.TITLE)})" class="cell-link ${dClass}">${dSign}${b24NumberFormat(dynVal)} р.</button>`;
                        }

                        htmlRows.push(`
                            <tr>
                                <td style="text-align: center !important;">
                                    <input type="checkbox" class="m-client-chk" data-id="${client.ID}" data-type="${client.TYPE}" data-farmer="${fId}" onchange="updateBulkTaskCount()">
                                </td>
                                <td>
                                    <a href="${client.LINK}" target="_blank" rel="noopener" class="text-blue-link font-medium">${b24Escape(client.TITLE)}</a>
                                    ${wmRoleDetails(client)}
                                </td>
                                <td class="cell-dir-path">${b24Escape(client.DIRECTORY_PATH)}</td>
                                <td class="text-gray-600 font-medium">${b24Escape(client.CORE_TAIL)}</td>
                                <td class="text-gray-500 max-w-sm truncate" title="${b24Escape(client.COMMENT)}">${b24Escape(client.COMMENT)}</td>
                                <td>${col1Html}</td>
                                ${column !== 'failed' && column !== 'dynamics' ? `<td>${col2Html}</td>` : ''}
                                ${wmRecCell(client,column)}
                            </tr>
                        `);
                        htmlRows.push(wmMemberRows(client,column));
                    });

                    // Строка Итого Уровня 1
                    let totalRowHtml = `<tr class="total-row"><td colspan="5">Итого</td>`;
                    if (column === 'base' || column === 'active') {
                        totalRowHtml += `<td>${b24NumberFormat(totalCol1Sum)} р.</td><td>${b24NumberFormat(totalCol2Sum)} р.</td>`;
                    } else if (column === 'turnover') {
                        totalRowHtml += `<td>${b24NumberFormat(totalCol1Sum)} р.</td><td></td>`;
                    } else if (column === 'failed') {
                        totalRowHtml += `<td>${b24NumberFormat(totalCol1Sum)} р.</td>`;
                    } else if (column === 'dynamics') {
                        const totDSign = totalCol1Sum > 0 ? '+' : '';
                        const totDClass = totalCol1Sum > 0 ? 'dyn-pos' : (totalCol1Sum < 0 ? 'dyn-neg' : 'dyn-zero');
                        totalRowHtml += `<td class="${totDClass}">${totDSign}${b24NumberFormat(totalCol1Sum)} р.</td>`;
                    } else {
                        totalRowHtml += `<td></td><td></td>`;
                    }
                    if(column!=='dynamics')totalRowHtml+='<td></td>';
                    totalRowHtml += `</tr>`;

                    htmlRows.push(totalRowHtml);
                    tbody.innerHTML = htmlRows.join('');
                    wmRecObserve();
                } else {
                    const colSpan = column === 'dynamics' ? 6 : column === 'failed' ? 7 : 8;
                    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center text-gray-400 p-8">Данные за выбранный период не найдены.</td></tr>`;
                }
            }).catch(error => {
                if(requestVersion!==wmModalVersions[requestLevel])return;
                loader.classList.add('hidden');
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-red-500 p-8">'+b24Escape(error.message)+'</td></tr>';
            });
    }

    // Открытие УРОВНЯ 2 (Детализация конкретных сделок/СП клиента)
    function openModalL2(clientId, clientType, column, clientName, farmerId = 0, memberKey = '') {
        const requestLevel=2,requestVersion=++wmModalVersions[2];
        const backdrop = document.getElementById('f-backdrop-l2');
        
        if (clientId > 0) {
            const memberRef = /^(CO|C)_([1-9][0-9]*)$/.exec(memberKey);
            const clientCardLink = memberRef ? '/crm/'+(memberRef[1]==='CO'?'company':'contact')+'/details/'+memberRef[2]+'/' : `/crm/${clientType.toLowerCase()}/details/${clientId}/`;
            document.getElementById('modal-title-l2').innerHTML = `Состав сделок клиента: <a href="${clientCardLink}" target="_blank" class="text-blue-link font-medium hover:underline">${b24Escape(clientName)}</a>`;
        } else {
            document.getElementById('modal-title-l2').innerHTML = `Состав всех сделок клиентов (${b24Escape(clientName)})`;
        }

        if(column==='dynamics')document.getElementById('modal-title-l2').insertAdjacentText('beforeend',' · Реализации выбранного периода (не разница периодов)');
        const tbody = document.getElementById('m-tbody-l2');
        const loader = document.getElementById('m-loader-l2');
        
        tbody.innerHTML = '';
        backdrop.style.display = 'flex';
        loader.classList.remove('hidden');

        const targetFarmerId = farmerId || currentL1FarmerId || 0;
        fetch(`?action=get_sub_details&client_id=${clientId}&client_type=${clientType}&column=${column}&farmer_id=${targetFarmerId}&member_key=${encodeURIComponent(memberKey)}&${getDateParams()}&_wm_request=${Date.now()}`, {cache:'no-store'})
            .then(res => res.json())
            .then(res => {
                if(requestVersion!==wmModalVersions[requestLevel])return;
                loader.classList.add('hidden');
                if(!res.success)throw new Error(res.error||'Ошибка расчёта');
                if (res.data.length > 0) {
                    let totalSum = 0;
                    const htmlRows = [];

                    const failHeader = document.getElementById('th-fail-reason');
                    if (column === 'failed') {
                        failHeader.classList.remove('hidden');
                    } else {
                        failHeader.classList.add('hidden');
                    }

                    res.data.forEach(item => {
                        totalSum += item.SUM;
                        const failTd = column === 'failed' ? `<td>${b24Escape(item.FAIL_REASON_TEXT)}</td>` : '';
                        
                        htmlRows.push(`
                            <tr>
                                <td>${item.ID}</td>
                                <td>
                                    <a href="${item.LINK}" target="_blank" rel="noopener" class="text-blue-link font-medium">${b24Escape(item.TITLE)}</a>
                                    <div style="font-size:12px;margin-top:4px">КА: <a href="${b24Escape(item.CLIENT_LINK)}" target="_blank" rel="noopener">${b24Escape(item.CLIENT_TITLE)}</a></div>
                                </td>
                                <td>${item.DATE}</td>
                                <td style="font-weight: bold; color: #333;">${b24NumberFormat(item.SUM)} р.</td>
                                <td class="text-gray-600 font-semibold">${b24Escape(item.STAGE)}</td>
                                ${failTd}
                                <td class="text-gray-500 max-w-md truncate" title="${b24Escape(item.COMMENT)}">${b24Escape(item.COMMENT)}</td>
                            </tr>
                        `);
                    });

                    htmlRows.push(`
                        <tr class="total-row">
                            <td colspan="3">Итого</td>
                            <td>${b24NumberFormat(totalSum)} р.</td>
                            <td colspan="${column === 'failed' ? 3 : 2}"></td>
                        </tr>
                    `);
                    tbody.innerHTML = htmlRows.join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-400 p-8">Сделки не найдены.</td></tr>';
                }
            }).catch(error => {
                if(requestVersion!==wmModalVersions[requestLevel])return;
                loader.classList.add('hidden');
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-red-500 p-8">'+b24Escape(error.message)+'</td></tr>';
            });
    }

    function closeModal(level) {
        wmModalVersions[level]++;
        document.getElementById(`f-backdrop-l${level}`).style.display = 'none';
    }

    function backdropClick(level, e) {
        if (e.target === document.getElementById(`f-backdrop-l${level}`)) {
            closeModal(level);
        }
    }
</script>

<?php
require_once($_SERVER["DOCUMENT_ROOT"] . "/bitrix/footer.php");
?>
