<?php
// Waterman: first assignment timestamp. No secondary CRM writes or external calls.
// Source: Popandopulo, 20.10.2026. The field stores Tomsk wall time (USE_TIMEZONE=N).
if (!defined('B_PROLOG_INCLUDED')) return;

final class WmReanimatorDate20261020
{
    const DATE_FIELD = 'UF_CRM_WM_REANIMATOR_ASSIGNED_AT';
    const COMPANY_FIELD = 'UF_CRM_1785296985';
    const CONTACT_FIELD = 'UF_CRM_1785298213';

    public static function employeeId($value)
    {
        if (is_array($value)) {
            foreach (['ID','id','VALUE','value'] as $key) {
                if (array_key_exists($key, $value)) return self::employeeId($value[$key]);
            }
            foreach ($value as $item) { $id = self::employeeId($item); if ($id > 0) return $id; }
            return 0;
        }
        $value = trim((string)$value);
        return ctype_digit($value) && (int)$value > 0 ? (int)$value : 0;
    }

    public static function patch(array &$fields, array $previous, $employeeField, $now)
    {
        if (!array_key_exists($employeeField, $fields)) return false;
        if (!self::employeeId($fields[$employeeField])) return false;
        if (self::employeeId($previous[$employeeField] ?? null)) return false;
        if (!empty($previous[self::DATE_FIELD])) return false;
        // A verified historical date supplied by an import is preserved.
        if (!empty($fields[self::DATE_FIELD])) return false;
        $fields[self::DATE_FIELD] = $now;
        return true;
    }

    public static function before(array &$fields, $kind, $isNew)
    {
        $employeeField = $kind === 'company' ? self::COMPANY_FIELD : self::CONTACT_FIELD;
        if (!array_key_exists($employeeField, $fields) || !self::employeeId($fields[$employeeField])) return true;
        try {
            $previous = [];
            if (!$isNew) {
                $id = (int)($fields['ID'] ?? 0);
                if ($id <= 0) return true;
                $table = $kind === 'company' ? 'b_uts_crm_company' : 'b_uts_crm_contact';
                $previous = \Bitrix\Main\Application::getConnection()->query(
                    'SELECT '.$employeeField.', '.self::DATE_FIELD.' FROM '.$table.' WHERE VALUE_ID='.$id
                )->fetch() ?: [];
            }
            $now = new \DateTimeImmutable('now', new \DateTimeZone('Asia/Tomsk'));
            $format = \CDatabase::DateFormatToPHP(\CSite::GetDateFormat('FULL'));
            self::patch($fields, $previous, $employeeField, $now->format($format));
            return true;
        } catch (\Throwable $error) {
            // Do not silently accept an assignment if its timestamp could not be checked.
            $fields['RESULT_MESSAGE'] = 'Не удалось проверить дату назначения реаниматора. Повторите сохранение.';
            global $APPLICATION;
            if (is_object($APPLICATION)) $APPLICATION->ThrowException($fields['RESULT_MESSAGE']);
            error_log('WmReanimatorDate: assignment timestamp check failed.');
            return false;
        }
    }

    public static function companyUpdate(&$fields) { return self::before($fields, 'company', false); }
    public static function contactUpdate(&$fields) { return self::before($fields, 'contact', false); }
    public static function companyAdd(&$fields) { return self::before($fields, 'company', true); }
    public static function contactAdd(&$fields) { return self::before($fields, 'contact', true); }
}

if (function_exists('AddEventHandler')) {
    AddEventHandler('crm', 'OnBeforeCrmCompanyUpdate', ['WmReanimatorDate20261020','companyUpdate'], 20000);
    AddEventHandler('crm', 'OnBeforeCrmContactUpdate', ['WmReanimatorDate20261020','contactUpdate'], 20000);
    AddEventHandler('crm', 'OnBeforeCrmCompanyAdd', ['WmReanimatorDate20261020','companyAdd'], 20000);
    AddEventHandler('crm', 'OnBeforeCrmContactAdd', ['WmReanimatorDate20261020','contactAdd'], 20000);
}
