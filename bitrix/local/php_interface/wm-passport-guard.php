<?php
// Passport writes require a short-lived signature from the authenticated Passport application.
// This file contains a PUBLIC verification key only. Private signing material stays on the app server.
final class WmPassportGuard20261015 {
    const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq6mwqg/30NxC8VdQbwC1\nBpUIIHWAws55+REy8sMLdGGNQi3CH3mX5ljIB9IHuFmwG8zhohX9pJl7fSEieUGl\nsCprtaY1TQexzYDhpcyEW1OJnrRzCPKoNad9PgykOJkDxsufDg6+Zr4g18Tk5sUj\nk5wU4PPyto9MNBbrUYswfSl661i2Zr3kzcb3iu+6/3lHzXObIONYY777oOO9Dd4x\nyDt81Dm9zVTGFZaZfGFu5bCeFfLetpUF19Ai3wETM3vcFOtkxm8dYuaEBkOXOMjp\nCqcO+vleeHcz/5RYwtg++DgBTDkZmd/3Yc0CURgDsK78ssmzNiIN4EcSMXjN3FFC\n+wIDAQAB\n-----END PUBLIC KEY-----\n";
    const RESET_USERS = [3098,17,99,40,25,32,20];
    const DETAIL = 'UF_CRM_WM_PASSPORT_ELEMENT_TYPES';
    public static function fields() {
        return ['ufCrmWmPassportObjects'=>'UF_CRM_WM_PASSPORT_OBJECTS','ufCrmWmPassportWorks'=>'UF_CRM_WM_PASSPORT_WORKS',
          'ufCrmWmPassportContours'=>'UF_CRM_WM_PASSPORT_CONTOURS','ufCrmWmPassportSystems'=>'UF_CRM_WM_PASSPORT_SYSTEMS',
          'ufCrmWmPassportElements'=>'UF_CRM_WM_PASSPORT_ELEMENTS','ufCrmWmPassportElementTypes'=>self::DETAIL,
          'ufCrmWmPassportCompanyFeature'=>'UF_CRM_WM_PASSPORT_COMPANY_FEATURE','ufCrmWmPassportContactRole'=>'UF_CRM_WM_PASSPORT_CONTACT_ROLE',
          'ufCrmWmPassportHead'=>'UF_CRM_WM_PASSPORT_HEAD','ufCrmWmPassportSegments'=>'UF_CRM_WM_PASSPORT_SEGMENTS'];
    }
    public static function json($x) {return json_encode($x,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_LINE_TERMINATORS|JSON_THROW_ON_ERROR);}
    public static function valueHash($x) {return hash('sha256',self::json($x));}
    public static function cellHash($x) {return hash('sha256',is_null($x)?'null':'string:'.$x);}
    public static function verify($envelope,$kind,$id,$actor,$before,$incoming,$publicKey=null) {
        $permit=$envelope['_wmPassportPermit']??null;
        if(!is_array($permit)||!is_string($permit['payload']??null)||!is_string($permit['signature']??null))throw new \RuntimeException('missing-permit');
        if(strlen($permit['payload'])>400000||openssl_verify($permit['payload'],base64_decode($permit['signature'],true),$publicKey?:self::PUBLIC_KEY,OPENSSL_ALGO_SHA256)!==1)throw new \RuntimeException('invalid-signature');
        $p=json_decode(base64_decode($permit['payload'],true),true,512,JSON_THROW_ON_ERROR);
        $at=strtotime($p['at']??'');
        if(($p['version']??0)!==1||$p['kind']!==$kind||(int)$p['id']!==$id||(int)$p['actor']!==$actor||!$actor||!$at||abs(time()-$at)>120||!preg_match('/^[a-f0-9-]{36}$/',$p['nonce']??''))throw new \RuntimeException('invalid-context');
        if(!in_array($p['operation']??'',['manual-edit','manual-copy','reset'],true))throw new \RuntimeException('invalid-operation');
        if($p['operation']==='reset'&&!in_array($actor,self::RESET_USERS,true))throw new \RuntimeException('reset-denied');
        $map=self::fields();$changes=$p['changes']??[];
        if(!$changes)throw new \RuntimeException('missing-changes');
        $incoming[self::DETAIL]=$envelope['value']??null;
        foreach($changes as $camel=>$v){
            if(!isset($map[$camel]))throw new \RuntimeException('unknown-field');$field=$map[$camel];
            if(!array_key_exists($field,$incoming)||$incoming[$field]!==$v)throw new \RuntimeException('value-mismatch');
            if(($p['before'][$camel]??null)!==self::valueHash($before[$field]??null))throw new \RuntimeException('stale-version');
        }
        foreach($map as $camel=>$field)if(array_key_exists($field,$incoming)&&!array_key_exists($camel,$changes)&&$incoming[$field]!==($before[$field]??null))throw new \RuntimeException('unsigned-field');
        return [$p,$incoming];
    }
    public static function audit($event) {
        $dir=__DIR__.'/wm-passport-audit';
        if(!is_dir($dir)&&!mkdir($dir,0700,true))throw new \RuntimeException('archive-unavailable');
        // PHP prefix prevents reading private data if the web server ignores .htaccess.
        $name=$dir.'/'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(10)).'.php';
        $f=fopen($name,'x');if(!$f)throw new \RuntimeException('archive-unavailable');
        $text="<?php exit; ?>\n".self::json($event);$n=fwrite($f,$text);fflush($f);if(function_exists('fsync'))fsync($f);fclose($f);chmod($name,0600);
        if($n!==strlen($text))throw new \RuntimeException('archive-incomplete');
    }
    public static function before(&$fields,$kind) {
        $protected=array_intersect_key($fields,array_flip(array_values(self::fields())));
        if(!$protected)return true;
        $rawEnvelope=$fields[self::DETAIL]??null;
        $envelope=is_string($rawEnvelope)?json_decode($rawEnvelope,true):null;
        if(!is_array($envelope))$envelope=[];
        // Two-phase activation: understand signed writes before the app begins sending them.
        if(!is_file(__DIR__.'/wm-passport-guard.enabled')&&empty($envelope['_wmPassportPermit']))return true;
        global $USER,$USER_FIELD_MANAGER;
        $id=(int)($fields['ID']??0);$actor=is_object($USER)?(int)$USER->GetID():0;
        $before=[];$reason='missing-permit';
        try {
            if(!$id)throw new \RuntimeException('missing-id');
            $db=\Bitrix\Main\Application::getConnection();
            $table=$kind==='companies'?'b_uts_crm_company':'b_uts_crm_contact';
            $row=$db->query('SELECT * FROM '.$table.' WHERE VALUE_ID='.$id)->fetch();
            if(!$row)throw new \RuntimeException('missing-stored-passport');
            foreach(self::fields() as $field)if(array_key_exists($field,$row))$before[$field]=$row[$field];
            list($p,$incoming)=self::verify($envelope,$kind,$id,$actor,$before,$fields);
            self::audit(['at'=>gmdate('c'),'type'=>'before-manual-write','kind'=>$kind,'id'=>$id,'actor'=>$actor,'actorName'=>$p['actorName']??'','operation'=>$p['operation'],'nonce'=>$p['nonce'],'before'=>$before,'changes'=>$p['changes']]);
            $nonceDir=__DIR__.'/wm-passport-audit';$nonceFile=$nonceDir.'/nonce-'.$p['nonce'].'.php';
            $f=@fopen($nonceFile,'x');if(!$f)throw new \RuntimeException('replayed-permit');fwrite($f,'<?php exit;');fclose($f);chmod($nonceFile,0600);
            $fields=$incoming;
            $allow=[];foreach($p['changes'] as $camel=>$v)$allow[self::fields()[$camel]]=self::cellHash($v);
            $db=\Bitrix\Main\Application::getConnection();$h=$db->getSqlHelper();
            $db->queryExecute("SET @wm_passport_kind='".$h->forSql($kind)."', @wm_passport_id=".$id.", @wm_passport_actor=".$actor.", @wm_passport_operation='".$h->forSql($p['operation'])."', @wm_passport_expires=UNIX_TIMESTAMP()+120, @wm_passport_allow='".$h->forSql(self::json($allow))."'");
            return true;
        } catch(\Throwable $e) {$reason=$e->getMessage();}
        // Preserve unrelated CRM updates; only the unauthorized passport fields are removed.
        foreach(array_values(self::fields()) as $field)unset($fields[$field]);
        try{self::audit(['at'=>gmdate('c'),'type'=>'blocked-passport-write','kind'=>$kind,'id'=>$id,'actor'=>$actor,'reason'=>$reason,'before'=>$before,'attempt'=>$protected,'path'=>parse_url($_SERVER['REQUEST_URI']??'',PHP_URL_PATH)]);}catch(\Throwable $e){error_log('Passport protected; audit unavailable.');}
        return true;
    }
    public static function company(&$fields){return self::before($fields,'companies');}
    public static function contact(&$fields){return self::before($fields,'contacts');}
}
if(function_exists('AddEventHandler')) {
    AddEventHandler('crm','OnBeforeCrmCompanyUpdate',['WmPassportGuard20261015','company'],10000);
    AddEventHandler('crm','OnBeforeCrmContactUpdate',['WmPassportGuard20261015','contact'],10000);
}
