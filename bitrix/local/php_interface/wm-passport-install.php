<?php
require_once $_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php';
global $USER;
if(!is_object($USER)||!$USER->IsAdmin()){http_response_code(403);exit('Administrator access required');}
require_once __DIR__.'/wm-passport-guard.php';
$db=\Bitrix\Main\Application::getConnection();
function wm_columns($db,$table){$out=[];$r=$db->query('SHOW COLUMNS FROM `'.$table.'`');while($row=$r->fetch())if(strpos($row['Field'],'UF_CRM_WM_PASSPORT_')===0)$out[]=$row['Field'];return $out;}
function wm_json($prefix,$columns){return 'JSON_OBJECT('.implode(',',array_map(function($c)use($prefix){return "'".$c."',".$prefix.'.`'.$c.'`';},$columns)).')';}
function wm_trigger_sql($name,$table,$kind,$columns){
    $before=wm_json('OLD',$columns);$after=wm_json('NEW',$columns);
    $checks=[];
    foreach($columns as $c){
        $new='NEW.`'.$c.'`';$old='OLD.`'.$c.'`';
        $permit="COALESCE(@wm_passport_kind='".$kind."' AND @wm_passport_id=NEW.VALUE_ID AND @wm_passport_expires>=UNIX_TIMESTAMP() AND JSON_UNQUOTE(JSON_EXTRACT(@wm_passport_allow,'$.".$c."'))=SHA2(IF(".$new." IS NULL,'null',CONCAT('string:',".$new.")),256),0)";
        $checks[]="IF NOT (".$old." <=> ".$new.") AND NOT (".$permit.") THEN SET blocked=JSON_SET(blocked,'$.".$c."',".$new."); SET ".$new."=".$old."; END IF;";
    }
    return 'CREATE TRIGGER `'.$name.'` BEFORE UPDATE ON `'.$table.'` FOR EACH ROW BEGIN '
      .'DECLARE previous_data LONGTEXT; DECLARE attempted_data LONGTEXT; DECLARE blocked LONGTEXT; '
      .'SET previous_data='.$before.'; SET attempted_data='.$after.'; SET blocked=JSON_OBJECT(); '
      .implode(' ',$checks)
      ." IF BINARY previous_data <> BINARY attempted_data THEN INSERT INTO b_wm_passport_audit (CREATED_AT,ENTITY_KIND,ENTITY_ID,ACTOR_ID,OPERATION,BEFORE_DATA,ATTEMPTED_DATA,AFTER_DATA,BLOCKED_FIELDS,DB_ACCOUNT) VALUES (UTC_TIMESTAMP(),'".$kind."',NEW.VALUE_ID,COALESCE(@wm_passport_actor,0),COALESCE(@wm_passport_operation,'external'),previous_data,attempted_data,".$after.",blocked,USER()); END IF; "
      .'SET @wm_passport_allow=NULL; SET @wm_passport_expires=NULL; SET @wm_passport_actor=NULL; SET @wm_passport_operation=NULL; END';
}
$status=[];$error=null;
try{
    foreach(['companies'=>'b_uts_crm_company','contacts'=>'b_uts_crm_contact'] as $kind=>$table){$cols=wm_columns($db,$table);if(count($cols)<6)throw new \RuntimeException('Passport schema incomplete: '.$kind);$status[$kind]=$cols;}
    if($_SERVER['REQUEST_METHOD']==='POST'&&($_POST['action']??'')==='disable'){
        if(!check_bitrix_sessid())throw new \RuntimeException('Invalid session');
        foreach(['companies','contacts'] as $kind)$db->queryExecute('DROP TRIGGER IF EXISTS `wm_passport_protect_'.$kind.'_20261015`');
        if(is_file(__DIR__.'/wm-passport-guard.enabled')&&!unlink(__DIR__.'/wm-passport-guard.enabled'))throw new \RuntimeException('Cannot disable handler');
        $status['disabled']=true;$status['history']='Preserved. Signed-write decoder remains installed for compatibility.';
    } elseif($_SERVER['REQUEST_METHOD']==='POST'){
        if(!check_bitrix_sessid())throw new \RuntimeException('Invalid session');
        if(WmPassportGuard20261015::PUBLIC_KEY==='PUBLIC_KEY_PLACEHOLDER')throw new \RuntimeException('Public key not configured');
        $db->queryExecute('CREATE TABLE IF NOT EXISTS b_wm_passport_audit (ID BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,CREATED_AT DATETIME NOT NULL,ENTITY_KIND VARCHAR(16) NOT NULL,ENTITY_ID INT NOT NULL,ACTOR_ID INT NOT NULL,OPERATION VARCHAR(32) NOT NULL,BEFORE_DATA LONGTEXT NOT NULL,ATTEMPTED_DATA LONGTEXT NOT NULL,AFTER_DATA LONGTEXT NOT NULL,BLOCKED_FIELDS LONGTEXT NOT NULL,DB_ACCOUNT VARCHAR(255) NOT NULL,INDEX ENTITY_HISTORY (ENTITY_KIND,ENTITY_ID,ID)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
        // Isolated SQL probe: no CRM card is used for destructive testing.
        $probe='b_wm_passport_guard_probe_20261015';$column='UF_CRM_WM_PASSPORT_OBJECTS';
        $db->queryExecute('CREATE TABLE IF NOT EXISTS `'.$probe.'` (VALUE_ID INT PRIMARY KEY, `'.$column.'` LONGTEXT, OTHER_VALUE VARCHAR(64)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
        if(!$db->query("SHOW TRIGGERS WHERE `Trigger`='wm_passport_guard_probe_20261015'")->fetch())$db->queryExecute(wm_trigger_sql('wm_passport_guard_probe_20261015',$probe,'probe',[$column]));
        $probeId=time();
        $db->queryExecute("INSERT INTO `".$probe."` VALUES (".$probeId.",'[\"izhs\"]','before')");
        $db->queryExecute("UPDATE `".$probe."` SET `".$column."`=NULL,OTHER_VALUE='after' WHERE VALUE_ID=".$probeId);
        $r=$db->query('SELECT * FROM `'.$probe.'` WHERE VALUE_ID='.$probeId)->fetch();
        if($r[$column]!=='["izhs"]'||$r['OTHER_VALUE']!=='after')throw new \RuntimeException('Unsigned clear protection failed');
        $allow=\WmPassportGuard20261015::json([$column=>\WmPassportGuard20261015::cellHash('[]')]);$h=$db->getSqlHelper();
        $db->queryExecute("SET @wm_passport_kind='probe',@wm_passport_id=".$probeId.",@wm_passport_expires=UNIX_TIMESTAMP()+120,@wm_passport_actor=".(int)$USER->GetID().",@wm_passport_operation='manual-edit',@wm_passport_allow='".$h->forSql($allow)."'");
        $db->queryExecute("UPDATE `".$probe."` SET `".$column."`='[]' WHERE VALUE_ID=".$probeId);
        $r=$db->query('SELECT * FROM `'.$probe.'` WHERE VALUE_ID='.$probeId)->fetch();if($r[$column]!=='[]')throw new \RuntimeException('Manual clear failed');
        // Keep the tiny probe and its audit as installation evidence; no user data is deleted.
        $status['probe']='Automatic clear blocked; unrelated update retained; authorized clear allowed.';
        if(($_POST['action']??'')!=='probe')foreach(['companies'=>'b_uts_crm_company','contacts'=>'b_uts_crm_contact'] as $kind=>$table){
            $name='wm_passport_protect_'.$kind.'_20261015';
            $exists=$db->query("SHOW TRIGGERS WHERE `Trigger`='".$name."'")->fetch();
            if(!$exists)$db->queryExecute(wm_trigger_sql($name,$table,$kind,$status[$kind]));
        }
        if(($_POST['action']??'')!=='probe'){
            if(file_put_contents(__DIR__.'/wm-passport-guard.enabled',gmdate('c'),LOCK_EX)===false)throw new \RuntimeException('Cannot activate handler');
            $status['installed']=true;
        }else{$status['probeOnly']=true;}
    }
    foreach(['companies','contacts'] as $kind){$r=$db->query("SHOW TRIGGERS WHERE `Trigger`='wm_passport_protect_".$kind."_20261015'")->fetch();$status['trigger_'.$kind]=(bool)$r;}
}catch(\Throwable $e){$error=$e->getMessage();http_response_code(500);}
header('Content-Type: text/html; charset=utf-8');
?><!doctype html><html lang="ru"><meta charset="utf-8"><title>Защита паспортов</title><body style="font:16px system-ui;max-width:960px;margin:40px auto"><h1>Защита паспортов от автоматической очистки</h1><p>Только паспортные поля компаний и контактов. Остальные обновления CRM продолжают работать.</p>
<?php if($error): ?><p style="color:#a00"><?php echo htmlspecialchars($error); ?></p><?php endif; ?>
<pre><?php echo htmlspecialchars(json_encode($status,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE)); ?></pre>
<?php if(empty($status['trigger_companies'])||empty($status['trigger_contacts'])): ?><form method="post"><?php echo bitrix_sessid_post(); ?><button type="submit" name="action" value="probe">Только проверка на отдельной тестовой таблице</button> <button type="submit" name="action" value="install">Проверить и включить защиту паспортных полей</button></form><?php endif; ?>
<?php if(!empty($status['trigger_companies'])||!empty($status['trigger_contacts'])): ?><form method="post"><?php echo bitrix_sessid_post(); ?><input type="hidden" name="action" value="disable"><button type="submit">Отключить защиту, сохранив историю</button></form><?php endif; ?>
</body></html>
