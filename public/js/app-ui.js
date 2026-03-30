window.AppUI = (() => {
  const ERROR_MAP = {
    unauthorized: 'Нет доступа. Выполните вход заново.',
    invalid_token: 'Сессия истекла или токен недействителен.',
    forbidden: 'Недостаточно прав для выполнения действия.',
    internal_error: 'Внутренняя ошибка сервера.',
    internal_server_error: 'Внутренняя ошибка сервера.',
    invalid_json_response: 'Сервер вернул некорректный ответ.',

    user_not_found: 'Пользователь не найден.',
    user_inactive: 'Пользователь отключён.',
    user_blocked: 'Пользователь заблокирован.',
    invalid_user_id: 'Некорректный ID пользователя.',
    username_required: 'Нужно указать логин.',
    username_already_exists: 'Такой логин уже существует.',
    full_name_required: 'Нужно указать имя пользователя.',
    invalid_role: 'Указана некорректная роль.',
    invalid_password: 'Пароль указан некорректно.',
    username_and_password_required: 'Нужно указать логин и пароль.',
    invalid_credentials: 'Неверный логин или пароль.',

    tenant_required: 'Для этого пользователя не привязан клиентский кабинет.',
    tenant_not_found: 'Клиент не найден.',
    tenant_inactive: 'Клиентский кабинет выключен.',
    tenant_blocked: 'Клиентский кабинет заблокирован.',
    invalid_tenant_id: 'Некорректный ID клиента.',
    name_required: 'Нужно указать название.',
    invalid_subscription_status: 'Некорректный статус подписки.',
    invalid_status: 'Некорректный статус.',
    invalid_max_sku: 'Некорректный лимит SKU.',
    invalid_max_locations: 'Некорректный лимит мест хранения.',

    subscription_blocked: 'Подписка клиента заблокирована.',
    subscription_expired: 'Срок подписки клиента истёк.',

    owner_must_have_null_tenant_id: 'У владельца системы tenant_id должен быть пустым.',
    tenant_id_required_for_client: 'Для клиента нужно указать tenant_id.',

    items_list_failed: 'Не удалось загрузить список товаров.',
    item_not_found: 'Товар не найден.',
    item_create_failed: 'Не удалось создать товар.',
    item_update_failed: 'Не удалось обновить товар.',
    item_delete_failed: 'Не удалось удалить товар.',
    invalid_purchase_price: 'Закупочная цена указана некорректно.',
    invalid_sale_price: 'Цена продажи указана некорректно.',

    clients_list_failed: 'Не удалось загрузить список клиентов.',
    client_not_found: 'Клиент не найден.',
    client_create_failed: 'Не удалось создать клиента.',
    client_update_failed: 'Не удалось обновить клиента.',

    locations_list_failed: 'Не удалось загрузить список мест хранения.',
    location_not_found: 'Место хранения не найдено.',
    location_create_failed: 'Не удалось создать место хранения.',
    location_update_failed: 'Не удалось обновить место хранения.',
    code_required: 'Нужно указать код.',
    location_type_required: 'Нужно указать тип места хранения.',

    stock_list_failed: 'Не удалось загрузить остатки.',
    movements_list_failed: 'Не удалось загрузить журнал движений.',
    incoming_failed: 'Не удалось провести приёмку.',
    writeoff_failed: 'Не удалось провести списание.',
    sell_failed: 'Не удалось провести продажу.',
    debts_list_failed: 'Не удалось загрузить долги.',
    cash_list_failed: 'Не удалось загрузить операции по деньгам.',
    cash_summary_failed: 'Не удалось загрузить сводку по деньгам.'
  };

  const SUBSCRIPTION_STATUS_MAP = {
    trial: 'Тест',
    active: 'Активна',
    expired: 'Истекла',
    blocked: 'Заблокирована'
  };

  const TENANT_STATUS_MAP = {
    active: 'Активен',
    blocked: 'Заблокирован',
    archived: 'Архив'
  };

  const ROLE_MAP = {
    owner: 'Владелец',
    client: 'Клиент'
  };

  function toText(value) {
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function translateError(errorCodeOrText) {
    const key = toText(errorCodeOrText).trim();
    if (!key) return 'Неизвестная ошибка.';
    return ERROR_MAP[key] || key;
  }

  function translateSubscriptionStatus(status) {
    const key = toText(status).trim();
    return SUBSCRIPTION_STATUS_MAP[key] || key || '—';
  }

  function translateTenantStatus(status) {
    const key = toText(status).trim();
    return TENANT_STATUS_MAP[key] || key || '—';
  }

  function translateRole(role) {
    const key = toText(role).trim();
    return ROLE_MAP[key] || key || '—';
  }

  function displayDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU');
  }

  function toDatetimeLocalValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function escapeHtml(value) {
    return toText(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  return {
    translateError,
    translateSubscriptionStatus,
    translateTenantStatus,
    translateRole,
    displayDateTime,
    toDatetimeLocalValue,
    escapeHtml
  };
})();