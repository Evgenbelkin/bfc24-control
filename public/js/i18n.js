/**
 * BFC24 CONTROL — i18n
 * Единственный источник переводов для всего frontend.
 * Использование:
 *   i18n.t("key")                     — получить строку
 *   i18n.applyTranslations()          — применить data-i18n-атрибуты к DOM
 *   i18n.renderLanguageSwitcher(id)   — отрисовать переключатель языка
 */
window.i18n = (() => {
  "use strict";

  /* ── Словарь ──────────────────────────────────────────────────────────── */
  const DICT = {

    /* ── Общие действия ─────────────────────────────────────────────────── */
    back:           { ru: "Назад",              en: "Back",           zh: "返回" },
    logout:         { ru: "Выйти",              en: "Logout",         zh: "退出" },
    save:           { ru: "Сохранить",          en: "Save",           zh: "保存" },
    save_changes:   { ru: "Сохранить изменения",en: "Save changes",   zh: "保存更改" },
    cancel:         { ru: "Отменить",           en: "Cancel",         zh: "取消" },
    cancel_edit:    { ru: "Отменить редактирование", en: "Cancel edit", zh: "取消编辑" },
    refresh:        { ru: "Обновить",           en: "Refresh",        zh: "刷新" },
    refresh_list:   { ru: "Обновить список",    en: "Refresh list",   zh: "刷新列表" },
    refresh_data:   { ru: "Обновить данные",    en: "Refresh data",   zh: "刷新数据" },
    apply:          { ru: "Применить",          en: "Apply",          zh: "应用" },
    search:         { ru: "Поиск",              en: "Search",         zh: "搜索" },
    reset:          { ru: "Сбросить",           en: "Reset",          zh: "重置" },
    create:         { ru: "Создать",            en: "Create",         zh: "创建" },
    edit:           { ru: "Редактировать",      en: "Edit",           zh: "编辑" },
    delete:         { ru: "Удалить",            en: "Delete",         zh: "删除" },
    clear:          { ru: "Очистить",           en: "Clear",          zh: "清空" },
    accept_payment: { ru: "Принять оплату",     en: "Accept payment", zh: "接受付款" },
    save_expense:   { ru: "Сохранить расход",   en: "Save expense",   zh: "保存费用" },
    run_sale:       { ru: "Провести продажу",   en: "Process sale",   zh: "处理销售" },
    run_incoming:   { ru: "Провести приёмку",   en: "Process receipt",zh: "处理入库" },

    /* ── Статусы загрузки ───────────────────────────────────────────────── */
    status_loading:   { ru: "Загрузка...",          en: "Loading...",       zh: "加载中..." },
    status_saving:    { ru: "Сохраняю...",           en: "Saving...",        zh: "保存中..." },
    status_success:   { ru: "Успешно",               en: "Success",          zh: "成功" },
    status_error:     { ru: "Ошибка",                en: "Error",            zh: "错误" },
    status_done:      { ru: "Готово",                en: "Done",             zh: "完成" },
    status_not_found: { ru: "Не найдено",            en: "Not found",        zh: "未找到" },
    status_no_data:   { ru: "Нет данных",            en: "No data",          zh: "暂无数据" },
    loading_data:     { ru: "Загрузка данных...",    en: "Loading data...",  zh: "加载数据中..." },
    data_loaded:      { ru: "Данные загружены.",     en: "Data loaded.",     zh: "数据已加载。" },
    load_error:       { ru: "Ошибка загрузки данных",en: "Data load error",  zh: "加载数据出错" },
    save_error:       { ru: "Ошибка сохранения",     en: "Save error",       zh: "保存出错" },

    /* ── Деньги / типы операций ─────────────────────────────────────────── */
    cash_income:         { ru: "Доход",              en: "Income",           zh: "收入" },
    cash_expense:        { ru: "Расход",             en: "Expense",          zh: "支出" },
    payment_cash:        { ru: "Наличные",           en: "Cash",             zh: "现金" },
    payment_card:        { ru: "Карта",              en: "Card",             zh: "刷卡" },
    payment_transfer:    { ru: "Перевод",            en: "Transfer",         zh: "转账" },
    payment_consignment: { ru: "Под реализацию",     en: "Consignment",      zh: "寄售" },

    /* ── Долги / статусы ────────────────────────────────────────────────── */
    debt_open:    { ru: "Открыт",           en: "Open",          zh: "待还" },
    debt_partial: { ru: "Частично оплачен", en: "Partial",       zh: "部分还清" },
    debt_paid:    { ru: "Оплачен",          en: "Paid",          zh: "已还清" },

    /* ── Булевые ────────────────────────────────────────────────────────── */
    yes: { ru: "Да",  en: "Yes", zh: "是" },
    no:  { ru: "Нет", en: "No",  zh: "否" },

    /* ── Таблица: общие заголовки ───────────────────────────────────────── */
    col_id:       { ru: "ID",         en: "ID",       zh: "编号" },
    col_name:     { ru: "Название",   en: "Name",     zh: "名称" },
    col_active:   { ru: "Активно",    en: "Active",   zh: "状态" },
    col_date:     { ru: "Дата",       en: "Date",     zh: "日期" },
    col_actions:  { ru: "Действия",   en: "Actions",  zh: "操作" },
    col_comment:  { ru: "Комментарий",en: "Comment",  zh: "备注" },
    col_amount:   { ru: "Сумма",      en: "Amount",   zh: "金额" },
    col_type:     { ru: "Тип",        en: "Type",     zh: "类型" },
    col_payment:  { ru: "Оплата",     en: "Payment",  zh: "付款方式" },
    col_status:   { ru: "Статус",     en: "Status",   zh: "状态" },
    col_category: { ru: "Категория",  en: "Category", zh: "类别" },
    col_client:   { ru: "Клиент",     en: "Client",   zh: "客户" },
    col_balance:  { ru: "Остаток",    en: "Balance",  zh: "余额" },
    col_paid:     { ru: "Оплачено",   en: "Paid",     zh: "已付" },
    col_created_by:{ ru: "Создал",    en: "Created by",zh:"创建人" },

    /* ── Страница: Товары ───────────────────────────────────────────────── */
    page_items:           { ru: "Товары",           en: "Products",        zh: "商品" },
    form_create_item:     { ru: "Создать товар",    en: "Create product",  zh: "创建商品" },
    form_edit_item:       { ru: "Редактировать товар", en: "Edit product", zh: "编辑商品" },
    item_card_hint:       { ru: "Карточка товара для приёмки, продажи, списания и остатков.", en: "Product card for receipts, sales, writeoffs and stock.", zh: "用于入库、销售、报损和库存的商品卡。" },
    stat_items_count:     { ru: "Товаров",          en: "Products",        zh: "商品数" },
    stat_tenant_id:       { ru: "Tenant ID",        en: "Tenant ID",       zh: "租户ID" },
    label_name:           { ru: "Название",         en: "Name",            zh: "名称" },
    label_sku:            { ru: "Артикул / SKU",    en: "SKU / Article",   zh: "SKU / 编码" },
    label_barcode:        { ru: "Штрихкод",         en: "Barcode",         zh: "条形码" },
    label_purchase_price: { ru: "Закупочная цена",  en: "Purchase price",  zh: "进价" },
    label_sale_price:     { ru: "Цена продажи",     en: "Sale price",      zh: "售价" },
    label_unit:           { ru: "Единица",          en: "Unit",            zh: "单位" },
    label_search:         { ru: "Поиск",            en: "Search",          zh: "搜索" },
    ph_name_item:         { ru: "Например: Тест товар SaaS",    en: "e.g. Product name",      zh: "例：商品名称" },
    ph_sku:               { ru: "Например: SKU-001",            en: "e.g. SKU-001",           zh: "例：SKU-001" },
    ph_barcode:           { ru: "Например: 1234567890123",      en: "e.g. 1234567890123",     zh: "例：1234567890123" },
    ph_unit:              { ru: "Например: pcs",                en: "e.g. pcs",               zh: "例：个" },
    ph_search_items:      { ru: "Поиск по названию, артикулу, штрихкоду", en: "Search by name, SKU, barcode", zh: "按名称、SKU、条码搜索" },
    list_items:           { ru: "Список товаров",   en: "Product list",    zh: "商品列表" },
    col_sku:              { ru: "Артикул / SKU",    en: "SKU / Article",   zh: "SKU" },
    col_barcode:          { ru: "Штрихкод",         en: "Barcode",         zh: "条码" },
    col_unit:             { ru: "Ед.",              en: "Unit",            zh: "单位" },
    col_purchase:         { ru: "Закупка",          en: "Purchase",        zh: "进价" },
    col_sale:             { ru: "Продажа",          en: "Sale price",      zh: "售价" },
    msg_item_created:     { ru: "Товар успешно создан",   en: "Product created",       zh: "商品已创建" },
    msg_item_updated:     { ru: "Товар успешно обновлён", en: "Product updated",       zh: "商品已更新" },
    err_name_required:    { ru: "Название обязательно",   en: "Name is required",      zh: "名称必填" },
    err_price_invalid:    { ru: "Закупочная цена должна быть 0 или больше", en: "Purchase price must be 0 or more", zh: "进价不能为负" },
    err_sale_price_invalid:{ ru: "Цена продажи должна быть 0 или больше",  en: "Sale price must be 0 or more",     zh: "售价不能为负" },

    /* ── Страница: Места хранения ───────────────────────────────────────── */
    page_locations:         { ru: "Места хранения",      en: "Locations",         zh: "仓库位置" },
    form_create_location:   { ru: "Создать место хранения", en: "Create location", zh: "创建位置" },
    form_edit_location:     { ru: "Редактировать место хранения", en: "Edit location", zh: "编辑位置" },
    location_hint:          { ru: "Например: Контейнер 1, Контейнер 2, Склад магазина, Витрина.", en: "e.g. Container 1, Store shelf, Showcase.", zh: "例：货架1、仓库、展示区" },
    stat_locations_count:   { ru: "Мест хранения",        en: "Locations",         zh: "位置数" },
    label_code:             { ru: "Код",                  en: "Code",              zh: "编码" },
    label_type:             { ru: "Тип",                  en: "Type",              zh: "类型" },
    ph_location_name:       { ru: "Например: Контейнер 1",en: "e.g. Container 1",  zh: "例：货架1" },
    ph_location_code:       { ru: "Например: K1",         en: "e.g. K1",           zh: "例：K1" },
    ph_search_locations:    { ru: "Поиск по названию, коду, типу", en: "Search by name, code, type", zh: "按名称、编码、类型搜索" },
    list_locations:         { ru: "Список мест хранения", en: "Location list",     zh: "位置列表" },
    loc_type_container:     { ru: "Контейнер",            en: "Container",         zh: "容器" },
    loc_type_warehouse:     { ru: "Склад",                en: "Warehouse",         zh: "仓库" },
    loc_type_storage:       { ru: "Storage",              en: "Storage",           zh: "储存室" },
    loc_type_shop:          { ru: "Магазин",              en: "Shop",              zh: "店铺" },
    loc_type_shelf:         { ru: "Полка",                en: "Shelf",             zh: "货架" },
    loc_type_other:         { ru: "Другое",               en: "Other",             zh: "其他" },
    col_code:               { ru: "Код",                  en: "Code",              zh: "编码" },
    col_loc_type:           { ru: "Тип",                  en: "Type",              zh: "类型" },
    msg_location_created:   { ru: "Место хранения успешно создано",   en: "Location created",  zh: "位置已创建" },
    msg_location_updated:   { ru: "Место хранения успешно обновлено", en: "Location updated",  zh: "位置已更新" },
    err_code_required:      { ru: "Код обязателен",    en: "Code is required",  zh: "编码必填" },
    err_type_required:      { ru: "Тип обязателен",    en: "Type is required",  zh: "类型必填" },

    /* ── Страница: Продажа ──────────────────────────────────────────────── */
    page_sale:          { ru: "Продажа",        en: "Sale",            zh: "销售" },
    new_sale:           { ru: "Новая продажа",  en: "New sale",        zh: "新销售" },
    sale_hint:          { ru: "Экран работает с backend SaaS. Для owner tenant_id передаётся обязательно.", en: "SaaS backend screen. For owner tenant_id is required.", zh: "SaaS后端页面，owner必须填写tenant_id。" },
    stat_items_loaded:  { ru: "Товаров загружено", en: "Products loaded",  zh: "已加载商品" },
    stat_locations:     { ru: "Мест хранения",    en: "Locations",         zh: "仓库位置" },
    stat_clients:       { ru: "Клиентов",          en: "Clients",           zh: "客户数" },
    stat_stock_loaded:  { ru: "Остатков загружено",en: "Stock loaded",       zh: "已加载库存" },
    label_tenant_id:    { ru: "Tenant ID",         en: "Tenant ID",          zh: "租户ID" },
    label_payment_method:{ ru: "Способ оплаты",   en: "Payment method",     zh: "付款方式" },
    label_item:         { ru: "Товар",             en: "Product",            zh: "商品" },
    label_location:     { ru: "Место хранения",   en: "Location",           zh: "仓库位置" },
    label_client:       { ru: "Клиент",            en: "Client",             zh: "客户" },
    label_qty:          { ru: "Количество",        en: "Quantity",           zh: "数量" },
    label_price:        { ru: "Цена за единицу",   en: "Unit price",         zh: "单价" },
    label_comment:      { ru: "Комментарий",       en: "Comment",            zh: "备注" },
    hint_tenant_owner:  { ru: "Для owner обязательно.", en: "Required for owner.", zh: "owner必填。" },
    opt_no_client:      { ru: "Без клиента",       en: "No client",          zh: "无客户" },
    opt_select_location:{ ru: "Выберите МХ",       en: "Select location",    zh: "选择位置" },
    ph_item_search:     { ru: "Начни вводить название, штрихкод, SKU или артикул", en: "Start typing name, barcode, SKU or article", zh: "输入名称、条码、SKU" },
    ph_comment_sale:    { ru: "Комментарий к продаже", en: "Sale comment",   zh: "销售备注" },
    item_not_found_search: { ru: "Ничего не найдено", en: "Nothing found",   zh: "未找到" },
    item_search_hint:   { ru: "Проверь название, штрихкод, SKU или артикул.", en: "Check name, barcode, SKU or article.", zh: "请检查名称、条码或SKU。" },
    selected_item:      { ru: "Выбран товар:",     en: "Selected product:",  zh: "已选商品：" },
    no_name:            { ru: "Без названия",       en: "No name",            zh: "无名称" },
    stock_on_location:  { ru: "Остаток на выбранном МХ:", en: "Stock at selected location:", zh: "所选位置库存：" },
    choose_location_hint:{ ru: "Выбери место хранения, чтобы увидеть остаток", en: "Select location to see stock", zh: "选择位置查看库存" },
    err_select_item:    { ru: "Выбери товар из списка",    en: "Select a product from the list", zh: "请从列表中选择商品" },
    err_select_location:{ ru: "Выбери место хранения",     en: "Select a location",              zh: "请选择仓库位置" },
    err_qty_positive:   { ru: "Количество должно быть больше 0", en: "Quantity must be greater than 0", zh: "数量必须大于0" },
    err_price_negative: { ru: "Цена не может быть отрицательной", en: "Price cannot be negative", zh: "价格不能为负" },
    err_stock_undefined:{ ru: "Не удалось определить остаток по выбранному месту хранения", en: "Could not determine stock for selected location", zh: "无法确定所选位置库存" },
    err_not_enough_stock:{ ru: "Недостаточно товара. Остаток:", en: "Insufficient stock. Available:", zh: "库存不足。可用：" },
    err_specify_tenant: { ru: "Укажи tenant_id",   en: "Specify tenant_id",  zh: "请输入tenant_id" },
    sale_success:       { ru: "Продажа успешно проведена.", en: "Sale completed successfully.", zh: "销售已成功完成。" },
    sale_processing:    { ru: "Провожу продажу...", en: "Processing sale...", zh: "处理销售中..." },
    sale_error:         { ru: "Ошибка продажи:",    en: "Sale error:",        zh: "销售出错：" },

    /* ── Страница: Приёмка ──────────────────────────────────────────────── */
    page_incoming:      { ru: "Приёмка",             en: "Receiving",         zh: "入库" },
    new_incoming:       { ru: "Новая приёмка",        en: "New receipt",       zh: "新入库" },
    incoming_hint:      { ru: "Выбери товар, место хранения, количество и цену закупки для прихода на склад.", en: "Select product, location, quantity and purchase price for stock receipt.", zh: "选择商品、位置、数量和进价以完成入库。" },
    label_purchase_price_per_unit: { ru: "Цена закупки", en: "Purchase price", zh: "进价" },
    hint_price_per_unit:{ ru: "Укажи закупочную цену за 1 единицу товара.", en: "Enter purchase price per 1 unit.", zh: "请输入每个商品的进价。" },
    ph_comment_incoming:{ ru: "Например: новая поставка, докупка, возврат товара", en: "e.g. new delivery, restock, return", zh: "例：新到货、补货、退货" },
    hint_comment_optional:{ ru: "Комментарий не обязателен, но лучше указывать.", en: "Comment is optional but recommended.", zh: "备注非必填，但建议填写。" },
    incoming_processing:{ ru: "Провожу приёмку...", en: "Processing receipt...", zh: "处理入库中..." },
    incoming_success:   { ru: "Приёмка успешно проведена.", en: "Receipt processed successfully.", zh: "入库已成功处理。" },
    incoming_error:     { ru: "Ошибка приёмки:",    en: "Receipt error:",       zh: "入库出错：" },
    err_purchase_price_invalid: { ru: "Цена закупки должна быть 0 или больше", en: "Purchase price must be 0 or more", zh: "进价不能为负" },

    /* ── Страница: Расходы ──────────────────────────────────────────────── */
    page_expenses:       { ru: "Расходы",              en: "Expenses",         zh: "费用" },
    add_expense:         { ru: "Добавить расход",       en: "Add expense",      zh: "添加费用" },
    label_sum:           { ru: "Сумма",                en: "Amount",           zh: "金额" },
    label_category:      { ru: "Категория",            en: "Category",         zh: "类别" },
    label_expense_date:  { ru: "Дата расхода",         en: "Expense date",     zh: "费用日期" },
    filters_and_history: { ru: "Фильтры и история расходов", en: "Filters and expense history", zh: "筛选与历史记录" },
    label_search_exp:    { ru: "Поиск по комментарию / категории / пользователю", en: "Search by comment / category / user", zh: "按备注/类别/用户搜索" },
    label_period:        { ru: "Быстрый период",       en: "Quick period",     zh: "快速周期" },
    label_date_from:     { ru: "Дата от",              en: "Date from",        zh: "开始日期" },
    label_date_to:       { ru: "Дата до",              en: "Date to",          zh: "结束日期" },
    period_today:        { ru: "Сегодня",              en: "Today",            zh: "今天" },
    period_week:         { ru: "Неделя",               en: "Week",             zh: "本周" },
    period_month:        { ru: "Месяц",                en: "Month",            zh: "本月" },
    stat_rows:           { ru: "Записей",              en: "Records",          zh: "记录数" },
    stat_expenses_total: { ru: "Сумма расходов",       en: "Total expenses",   zh: "总费用" },
    stat_avg_expense:    { ru: "Средний расход",       en: "Average expense",  zh: "平均费用" },
    opt_all:             { ru: "Все",                  en: "All",              zh: "全部" },
    opt_select_category: { ru: "Выбери категорию",    en: "Select category",  zh: "选择类别" },
    cat_rent:            { ru: "Аренда",               en: "Rent",             zh: "租金" },
    cat_salary:          { ru: "Зарплата",             en: "Salary",           zh: "工资" },
    cat_purchase:        { ru: "Закупка",              en: "Purchase",         zh: "采购" },
    cat_delivery:        { ru: "Доставка",             en: "Delivery",         zh: "运费" },
    cat_ads:             { ru: "Реклама",              en: "Advertising",      zh: "广告" },
    cat_utilities:       { ru: "Коммунальные",         en: "Utilities",        zh: "水电费" },
    cat_other:           { ru: "Прочее",               en: "Other",            zh: "其他" },
    ph_comment_expense:  { ru: "Например: аренда контейнера за апрель", en: "e.g. container rent for April", zh: "例：四月份货架租金" },
    ph_search_expenses:  { ru: "Например: аренда, зарплата, admin", en: "e.g. rent, salary, admin", zh: "例：租金、工资" },
    ph_amount_expense:   { ru: "Например: 1500",       en: "e.g. 1500",        zh: "例：1500" },
    err_amount_invalid:  { ru: "Укажи корректную сумму расхода", en: "Enter a valid expense amount", zh: "请输入有效金额" },
    err_category_required:{ ru: "Выбери категорию расхода", en: "Select expense category", zh: "请选择费用类别" },
    err_payment_required: { ru: "Выбери способ оплаты",      en: "Select payment method",   zh: "请选择付款方式" },
    expense_saving:      { ru: "Сохраняю расход...",   en: "Saving expense...", zh: "保存费用中..." },
    expense_saved:       { ru: "Расход успешно сохранён", en: "Expense saved", zh: "费用已保存" },
    expense_error:       { ru: "Ошибка:",              en: "Error:",            zh: "出错：" },

    /* ── Страница: Долги ────────────────────────────────────────────────── */
    page_debts:          { ru: "Долги клиентов",       en: "Client debts",      zh: "客户欠款" },
    debts_filters:       { ru: "Фильтры",              en: "Filters",           zh: "筛选" },
    label_search_debts:  { ru: "Поиск по клиенту / товару / комментарию", en: "Search by client / product / comment", zh: "按客户/商品/备注搜索" },
    label_status:        { ru: "Статус",               en: "Status",            zh: "状态" },
    opt_status_all:      { ru: "Все",                  en: "All",               zh: "全部" },
    stat_total_debts:    { ru: "Всего долгов",         en: "Total debts",       zh: "总欠款" },
    stat_open_debts:     { ru: "Открытых",             en: "Open",              zh: "待还" },
    stat_partial_debts:  { ru: "Частично оплачено",    en: "Partially paid",    zh: "部分还清" },
    stat_paid_debts:     { ru: "Оплачено",             en: "Paid",              zh: "已还清" },
    stat_balance_total:  { ru: "Остаток к оплате",     en: "Balance to pay",    zh: "待还金额" },
    list_debts:          { ru: "Список долгов",        en: "Debt list",         zh: "欠款列表" },
    debts_list_hint:     { ru: "Можно принимать частичную или полную оплату по каждому долгу.", en: "You can accept partial or full payment for each debt.", zh: "可按每笔欠款进行部分或全额还款。" },
    col_item:            { ru: "Товар",                en: "Product",           zh: "商品" },
    col_location_short:  { ru: "МХ",                  en: "Location",          zh: "位置" },
    col_qty:             { ru: "Кол-во",               en: "Qty",               zh: "数量" },
    col_initial:         { ru: "Сумма",                en: "Amount",            zh: "总额" },
    col_debt_actions:    { ru: "Оплата",               en: "Payment",           zh: "付款" },
    ph_pay_amount:       { ru: "Сумма",                en: "Amount",            zh: "金额" },
    ph_pay_comment:      { ru: "Комментарий к оплате", en: "Payment comment",   zh: "付款备注" },
    balance_remaining:   { ru: "Остаток:",             en: "Balance:",          zh: "余额：" },
    ph_search_debts:     { ru: "Например: Иванов, Тест товар, реализация", en: "e.g. Ivanov, product, consignment", zh: "例：客户名、商品名" },
    err_pay_amount:      { ru: "Укажи корректную сумму оплаты", en: "Enter a valid payment amount", zh: "请输入有效还款金额" },
    err_pay_field_missing:{ ru: "Поле суммы не найдено", en: "Amount field not found", zh: "未找到金额输入框" },
    debt_paying:         { ru: "Провожу оплату по долгу",  en: "Processing debt payment", zh: "处理还款中" },
    debt_paid_msg:       { ru: "Оплата успешно проведена", en: "Payment processed",       zh: "还款已处理" },
    debt_pay_error:      { ru: "Ошибка оплаты:",           en: "Payment error:",          zh: "还款出错：" },

    /* ── Страница: Деньги (cash) ────────────────────────────────────────── */
    page_cash:           { ru: "Деньги",              en: "Cash",               zh: "资金" },
    cash_filters:        { ru: "Фильтры",             en: "Filters",            zh: "筛选" },
    label_move_type:     { ru: "Тип движения",        en: "Movement type",      zh: "类型" },
    ph_search_cash:      { ru: "Например: Иванов, Тест товар, наличные", en: "e.g. Ivanov, product, cash", zh: "例：客户名、商品名" },
    stat_income_total:   { ru: "Доход",               en: "Income",             zh: "收入" },
    stat_expense_total:  { ru: "Расход",              en: "Expenses",           zh: "支出" },
    stat_balance:        { ru: "Баланс",              en: "Balance",            zh: "余额" },
    cash_list_title:     { ru: "Движения денег",      en: "Money movements",    zh: "资金流水" },
    cash_list_hint:      { ru: "Показываются денежные операции по продажам, оплатам и другим действиям.", en: "Showing monetary operations for sales, payments and other actions.", zh: "显示销售、付款及其他操作的资金流水。" },
    col_item_product:    { ru: "Товар",               en: "Product",            zh: "商品" },

    /* ── Страница: Клиенты ──────────────────────────────────────────────── */
    page_clients:         { ru: "Клиенты",              en: "Clients",          zh: "客户" },
    form_create_client:   { ru: "Создать клиента",      en: "Create client",    zh: "创建客户" },
    form_edit_client:     { ru: "Редактировать клиента",en: "Edit client",      zh: "编辑客户" },
    client_card_hint:     { ru: "Карточка клиента для продаж, долгов и денежных операций.", en: "Client card for sales, debts and cash operations.", zh: "用于销售、欠款和资金操作的客户卡。" },
    stat_clients_count:   { ru: "Клиентов",             en: "Clients",          zh: "客户数" },
    label_client_name:    { ru: "Имя",                  en: "Name",             zh: "姓名" },
    label_phone:          { ru: "Телефон",              en: "Phone",            zh: "电话" },
    ph_client_name:       { ru: "Например: ИП Иванов",  en: "e.g. John Doe",   zh: "例：张三" },
    ph_client_phone:      { ru: "Например: 79991234567",en: "e.g. +1234567890", zh: "例：13800138000" },
    ph_client_comment:    { ru: "Примечание по клиенту",en: "Client note",      zh: "客户备注" },
    ph_search_clients:    { ru: "Поиск по имени, телефону, комментарию", en: "Search by name, phone, comment", zh: "按姓名、电话、备注搜索" },
    list_clients:         { ru: "Список клиентов",      en: "Client list",      zh: "客户列表" },
    col_phone:            { ru: "Телефон",              en: "Phone",            zh: "电话" },
    err_client_name_required: { ru: "Имя обязательно", en: "Name is required", zh: "姓名必填" },
    msg_client_created:   { ru: "Клиент успешно создан",   en: "Client created",   zh: "客户已创建" },
    msg_client_updated:   { ru: "Клиент успешно обновлён", en: "Client updated",   zh: "客户已更新" },

    /* ── Страница: Аналитика ────────────────────────────────────────────── */
    analytics_title:          { ru: "Аналитика",              en: "Analytics",           zh: "分析" },
    analytics_home:           { ru: "Главная",                en: "Home",                zh: "首页" },
    analytics_subtitle_report:{ ru: "Финансовый отчёт",      en: "Financial report",    zh: "财务报告" },
    analytics_from:           { ru: "с",                      en: "from",                zh: "从" },
    analytics_to:             { ru: "по",                     en: "to",                  zh: "至" },
    analytics_7d:             { ru: "7 дн",                   en: "7 d",                 zh: "7天" },
    analytics_30d:            { ru: "30 дн",                  en: "30 d",                zh: "30天" },
    analytics_90d:            { ru: "90 дн",                  en: "90 d",                zh: "90天" },
    analytics_year:           { ru: "Год",                    en: "Year",                zh: "年" },
    analytics_tenant_ph:      { ru: "напр. 3",                en: "e.g. 3",              zh: "例：3" },
    analytics_session_expired:{ ru: "Сессия истекла.",        en: "Session expired.",    zh: "会话已过期。" },
    analytics_login_again:    { ru: "Войти снова",            en: "Login again",         zh: "重新登录" },
    analytics_no_tenant_title:{ ru: "Не выбран клиент (tenant_id).", en: "No tenant selected.", zh: "未选择租户。" },
    analytics_no_tenant_text: { ru: "Укажите Tenant ID в поле фильтра выше и нажмите «Применить» — или откройте страницу с параметром", en: "Enter Tenant ID in the filter above and click Apply — or open the page with parameter", zh: "在上方筛选框中输入 Tenant ID 并点击应用，或在URL中添加参数" },
    analytics_no_tenant_tail: { ru: "в URL.",                 en: "in URL.",             zh: "在URL中。" },
    analytics_example:        { ru: "Например:",              en: "Example:",            zh: "例如：" },
    analytics_pnl:            { ru: "P&L — Прибыли и убытки",en: "P&L — Profit & Loss", zh: "P&L — 利润与亏损" },
    analytics_daily:          { ru: "Динамика по дням",       en: "Daily dynamics",      zh: "每日动态" },
    analytics_top_items:      { ru: "Топ товаров",            en: "Top products",        zh: "畅销商品" },
    analytics_by_revenue:     { ru: "по выручке",             en: "by revenue",          zh: "按收入" },
    analytics_debts_title:    { ru: "Долги и реализация",     en: "Debts & sales",       zh: "欠款与销售" },
    analytics_up_to_date:     { ru: "Актуально на сейчас",    en: "Current",             zh: "实时数据" },
    analytics_warehouse:      { ru: "Состояние склада",       en: "Warehouse state",     zh: "库存状态" },
    analytics_stock_diff:     { ru: "Расхождения остатков",   en: "Stock discrepancies", zh: "库存差异" },
    analytics_revenue:        { ru: "Выручка",                en: "Revenue",             zh: "收入" },
    analytics_discounts:      { ru: "Скидки",                 en: "Discounts",           zh: "折扣" },
    analytics_sales_count:    { ru: "Продаж",                 en: "Sales",               zh: "销售笔数" },
    analytics_cogs:           { ru: "Себестоимость продаж",   en: "COGS",                zh: "销售成本" },
    analytics_cogs_short:     { ru: "Себест.",                en: "COGS",                zh: "成本" },
    analytics_positions:      { ru: "поз.",                   en: "pos.",                zh: "项" },
    analytics_gross_profit:   { ru: "Валовая прибыль",        en: "Gross profit",        zh: "毛利润" },
    analytics_opex:           { ru: "Операционные расходы",   en: "Operating expenses",  zh: "运营费用" },
    analytics_opex_hint:      { ru: "Аренда, ЗП, реклама…",  en: "Rent, payroll, ads…", zh: "租金、工资、广告…" },
    analytics_net_profit:     { ru: "Чистая прибыль",         en: "Net profit",          zh: "净利润" },
    analytics_gross_margin:   { ru: "Маржа валовая",          en: "Gross margin",        zh: "毛利率" },
    analytics_net_margin:     { ru: "Чистая маржа",           en: "Net margin",          zh: "净利率" },
    analytics_margin_short:   { ru: "Маржа",                  en: "Margin",              zh: "利润率" },
    analytics_margin_col:     { ru: "Маржа",                  en: "Margin",              zh: "利润率" },
    analytics_sales_noun:     { ru: "продаж",                 en: "sales",               zh: "笔" },
    analytics_from_revenue:   { ru: "от выручки",             en: "from revenue",        zh: "占收入" },
    analytics_expenses_by_cat:{ ru: "Расходы по категориям",  en: "Expenses by category",zh: "分类费用" },
    analytics_expenses_short: { ru: "Расходы",                en: "Expenses",            zh: "费用" },
    analytics_uncategorized:  { ru: "Без категории",          en: "Uncategorized",       zh: "未分类" },
    analytics_no_data_period: { ru: "Нет данных за период",   en: "No data for period",  zh: "该时间段无数据" },
    analytics_widen_range:    { ru: "Попробуйте расширить диапазон дат.", en: "Try widening the date range.", zh: "请扩大日期范围。" },
    analytics_no_sales:       { ru: "Нет продаж за период",   en: "No sales for period", zh: "该时间段无销售" },
    analytics_unit_default:   { ru: "шт",                     en: "pcs",                 zh: "件" },
    analytics_total_top:      { ru: "Итого топ-",             en: "Total top",           zh: "合计前" },
    analytics_top:            { ru: "топ",                    en: "top",                 zh: "前" },
    analytics_initial_sum:    { ru: "Начальная сумма",        en: "Initial amount",      zh: "初始金额" },
    analytics_overdue:        { ru: "Просрочено",             en: "Overdue",             zh: "逾期" },
    analytics_overdue_sum:    { ru: "На сумму",               en: "Amount",              zh: "金额" },
    analytics_no_overdue:     { ru: "Без просроченных",       en: "No overdue",          zh: "无逾期" },
    analytics_needs_attention:{ ru: "Требует внимания",       en: "Needs attention",     zh: "需要关注" },
    analytics_collected:      { ru: "Собрано",                en: "Collected",           zh: "已收" },
    analytics_of_total:       { ru: "от общей суммы",         en: "of total",            zh: "占总额" },
    analytics_no_open_debts:  { ru: "Нет открытых долгов",    en: "No open debts",       zh: "无未结欠款" },
    analytics_all_paid:       { ru: "Все реализации оплачены.",en:"All consignments paid.",zh: "所有寄售已付款。" },
    analytics_paid_pct:       { ru: "оплачено",               en: "paid",                zh: "已付" },
    analytics_days:           { ru: "дн",                     en: "d",                   zh: "天" },
    analytics_days_short:     { ru: "дн.",                    en: "d.",                  zh: "天" },
    analytics_debt_sum:       { ru: "Долг",                   en: "Debt",                zh: "欠款" },
    analytics_progress:       { ru: "Прогресс",               en: "Progress",            zh: "进度" },
    analytics_due_overdue:    { ru: "Срок / просрочка",       en: "Due / overdue",       zh: "到期/逾期" },
    analytics_stock_fifo:     { ru: "Стоимость остатков (FIFO)", en: "Stock value (FIFO)", zh: "库存价值(FIFO)" },
    analytics_potential_rev:  { ru: "Потенциальная выручка",  en: "Potential revenue",   zh: "潜在收入" },
    analytics_potential_prf:  { ru: "Потенциальная прибыль",  en: "Potential profit",    zh: "潜在利润" },
    analytics_in_stock:       { ru: "на складе",              en: "in stock",            zh: "在库" },
    analytics_in_stock_col:   { ru: "В stock",                en: "In stock",            zh: "库存" },
    analytics_at_sale_price:  { ru: "По цене продажи",        en: "At sale price",       zh: "按售价" },
    analytics_sell_all:       { ru: "Продать весь склад",     en: "Sell all stock",      zh: "清空库存" },
    analytics_synced:         { ru: "Всё синхронизировано",   en: "All synced",          zh: "全部同步" },
    analytics_synced_hint:    { ru: "Остатки stock совпадают с партиями item_batches.", en: "Stock balances match item_batches.", zh: "库存余额与批次一致。" },
    analytics_severe:         { ru: "⚠ Серьёзное",            en: "⚠ Severe",            zh: "⚠ 严重" },
    analytics_minor:          { ru: "△ Малое",                en: "△ Minor",             zh: "△ 轻微" },
    analytics_discrepancies_found:{ ru: "Обнаружено расхождений", en: "Discrepancies found", zh: "发现差异" },
    analytics_needs_inventory:{ ru: "Требуется инвентаризация", en: "Inventory required", zh: "需要盘点" },
    analytics_in_batches:     { ru: "В batches",              en: "In batches",          zh: "批次" },
    analytics_diff:           { ru: "Разница",                en: "Difference",          zh: "差异" },
    analytics_severity:       { ru: "Степень",                en: "Severity",            zh: "严重程度" },
    analytics_chart_error:    { ru: "Ошибка динамики",        en: "Chart error",         zh: "图表出错" },
    analytics_top_error:      { ru: "Ошибка топ товаров",     en: "Top items error",     zh: "畅销商品出错" },
    analytics_debts_error:    { ru: "Ошибка долгов",          en: "Debts error",         zh: "欠款出错" },
    analytics_stock_error:    { ru: "Ошибка склада",          en: "Stock error",         zh: "库存出错" },
    analytics_top_open_debts: { ru: "Топ открытых долгов",    en: "Top open debts",      zh: "未结欠款TOP" },

    /* ── Переключатель языка ────────────────────────────────────────────── */
    lang_ru: { ru: "RU", en: "RU", zh: "RU" },
    lang_en: { ru: "EN", en: "EN", zh: "EN" },
    lang_zh: { ru: "中文", en: "中文", zh: "中文" },
  };

  /* ── Поддерживаемые языки ─────────────────────────────────────────────── */
  const SUPPORTED = ["ru", "en", "zh"];
  const FALLBACK  = "ru";
  const STORAGE_KEY = "bfc24_lang";

  /* ── Текущий язык ─────────────────────────────────────────────────────── */
  let _lang = (() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
    const browser = (navigator.language || "").split("-")[0].toLowerCase();
    return SUPPORTED.includes(browser) ? browser : FALLBACK;
  })();

  /* ── Получить перевод ─────────────────────────────────────────────────── */
  function t(key) {
    const entry = DICT[key];
    if (!entry) {
      console.warn("[i18n] Missing key:", key);
      return key;
    }
    return entry[_lang] || entry[FALLBACK] || key;
  }

  /* ── Применить переводы к DOM ─────────────────────────────────────────── */
  function applyTranslations(root) {
    const scope = root || document;

    scope.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });

    scope.querySelectorAll("[data-i18n-html]").forEach(el => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });

    scope.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });

    scope.querySelectorAll("[data-i18n-title]").forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });

    scope.querySelectorAll("[data-i18n-label]").forEach(el => {
      el.setAttribute("aria-label", t(el.dataset.i18nLabel));
    });

    /* <html lang> */
    document.documentElement.lang = _lang;
  }

  /* ── Переключить язык ─────────────────────────────────────────────────── */
  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    _lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    applyTranslations();
    /* Перерисовать переключатель если он уже в DOM */
    document.querySelectorAll(".i18n-switcher").forEach(el => {
      renderLanguageSwitcher(el.id);
    });
  }

  /* ── Отрисовать переключатель языка ──────────────────────────────────── */
  function renderLanguageSwitcher(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    el.className = "lang-switcher i18n-switcher";
    el.innerHTML = SUPPORTED.map(lang => {
      const active = lang === _lang ? " lang-active" : "";
      const label  = DICT[`lang_${lang}`]?.[lang] || lang.toUpperCase();
      return `<button class="lang-btn${active}" data-lang="${lang}" onclick="i18n.setLang('${lang}')">${label}</button>`;
    }).join("");
  }

  /* ── Публичное API ─────────────────────────────────────────────────────── */
  return { t, applyTranslations, renderLanguageSwitcher, setLang, get lang() { return _lang; } };
})();
