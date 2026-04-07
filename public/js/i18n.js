(function () {
  const STORAGE_KEY = 'lang';

  const dictionaries = {
    ru: {
      lang_ru: 'RU',
      lang_en: 'EN',
      lang_zh: '中文',

      back: 'Назад',
      save: 'Сохранить',
      cancel: 'Отмена',
      clear: 'Очистить',
      refresh: 'Обновить',
      search: 'Поиск',
      reset: 'Сбросить',
      apply: 'Применить',
      create: 'Создать',
      add: 'Добавить',
      edit: 'Редактировать',
      delete: 'Удалить',
      open: 'Открыть',
      close: 'Закрыть',
      load: 'Загрузить',
      download: 'Скачать',
      export: 'Экспорт',
      confirm: 'Подтвердить',
      pay: 'Оплатить',
      sell: 'Продать',
      receive: 'Принять',
      writeoff_action: 'Списать',
      open_module: 'Открыть модуль',

      status_loading: 'Загрузка...',
      status_saving: 'Сохранение...',
      status_success: 'Успешно',
      status_error: 'Ошибка',
      status_done: 'Готово',
      status_not_found: 'Не найдено',
      status_no_data: 'Нет данных',

      page_items_title: 'BFC24 CONTROL — Товары',
      page_clients_title: 'BFC24 CONTROL — Клиенты',
      page_locations_title: 'BFC24 CONTROL — Места хранения',
      page_sales_title: 'BFC24 CONTROL — Продажа',
      page_stock_title: 'BFC24 CONTROL — Остатки',
      page_incoming_title: 'BFC24 CONTROL — Приёмка',
      page_movements_title: 'BFC24 CONTROL — Движения товара',
      page_writeoff_title: 'BFC24 CONTROL — Списание',
      page_expenses_title: 'BFC24 CONTROL — Расходы',
      page_debts_title: 'BFC24 CONTROL — Долги клиентов',
      page_cash_title: 'BFC24 CONTROL — Деньги',
      page_analytics_title: 'BFC24 CONTROL — Аналитика',

      items: 'Товары',
      items_title: 'Товары',
      items_add: 'Добавить товар',
      items_list: 'Список товаров',
      item_name: 'Название',
      item_sku: 'SKU',
      item_barcode: 'Штрихкод',
      item_unit: 'Ед. изм.',
      item_purchase_price: 'Цена закупки',
      item_sale_price: 'Цена продажи',
      item_comment: 'Комментарий',
      item_search: 'Поиск товара',

      clients: 'Клиенты',
      clients_title: 'Клиенты',
      clients_add: 'Добавить клиента',
      clients_list: 'Список клиентов',
      client_name: 'Имя клиента',
      client_phone: 'Телефон',
      client_comment: 'Комментарий',
      client_search: 'Поиск клиента',

      locations: 'Места хранения',
      locations_title: 'Места хранения',
      locations_add: 'Добавить место хранения',
      locations_list: 'Список мест хранения',
      location_name: 'Название',
      location_code: 'Код',
      location_type: 'Тип',
      location_comment: 'Комментарий',
      location_search: 'Поиск места хранения',

      sales: 'Продажа',
      sales_title: 'Продажа',
      sales_form: 'Оформление продажи',
      select_item: 'Выбрать товар',
      select_client: 'Выбрать клиента',
      select_location: 'Выбрать место хранения',
      quantity: 'Количество',
      price: 'Цена',
      amount: 'Сумма',
      comment: 'Комментарий',
      payment_type: 'Тип оплаты',
      sale_comment: 'Комментарий к продаже',

      stock: 'Остатки',
      stock_title: 'Остатки',
      stock_filters: 'Фильтры',
      stock_table: 'Таблица остатков',
      stock_search: 'Поиск по товару',
      stock_location: 'Место хранения',
      stock_item: 'Товар',
      stock_qty: 'Остаток',
      stock_total: 'Итого',

      incoming: 'Приёмка',
      incoming_title: 'Приёмка',
      incoming_form: 'Приёмка товара',
      incoming_item: 'Товар',
      incoming_location: 'Место хранения',
      incoming_qty: 'Количество',
      incoming_price: 'Цена закупки',
      incoming_comment: 'Комментарий',

      movements: 'Движения',
      movements_title: 'Движения товара',
      movements_filters: 'Фильтры движений',
      movements_table: 'Журнал движений',
      movement_type: 'Тип движения',
      movement_date: 'Дата',
      movement_item: 'Товар',
      movement_location: 'Место хранения',
      movement_qty: 'Количество',
      movement_comment: 'Комментарий',

      writeoff: 'Списание',
      writeoff_title: 'Списание',
      writeoff_form: 'Списание товара',
      writeoff_item: 'Товар',
      writeoff_location: 'Место хранения',
      writeoff_qty: 'Количество',
      writeoff_reason: 'Причина',
      writeoff_comment: 'Комментарий',

      expenses: 'Расходы',
      expenses_title: 'Расходы',
      expenses_add: 'Добавить расход',
      expenses_list: 'Список расходов',
      expense_date: 'Дата',
      expense_category: 'Категория',
      expense_name: 'Название расхода',
      expense_amount: 'Сумма расхода',
      expense_comment: 'Комментарий',

      debts: 'Долги клиентов',
      debts_title: 'Долги клиентов',
      debts_filters: 'Фильтры долгов',
      debts_table: 'Список долгов',
      debt_client: 'Клиент',
      debt_amount: 'Сумма долга',
      debt_paid: 'Оплачено',
      debt_balance: 'Остаток долга',
      debt_status: 'Статус',

      cash: 'Деньги',
      cash_title: 'Деньги',
      cash_filters: 'Фильтры',
      cash_table: 'Журнал денег',
      cash_income: 'Доход',
      cash_expense: 'Расход',
      cash_amount: 'Сумма',
      cash_source: 'Источник',
      cash_date: 'Дата',

      analytics: 'Аналитика',
      analytics_title: 'Аналитика',
      analytics_filters: 'Период аналитики',
      analytics_summary: 'Сводка',
      analytics_revenue: 'Выручка',
      analytics_profit: 'Прибыль',
      analytics_expenses: 'Расходы',
      analytics_stock_value: 'Капитализация склада',

      date_from: 'Дата с',
      date_to: 'Дата по',
      period: 'Период',
      today: 'Сегодня',
      week: 'Неделя',
      month: 'Месяц',
      all_time: 'За всё время',

      placeholder_search: 'Введите для поиска...',
      placeholder_comment: 'Введите комментарий...',
      placeholder_amount: 'Введите сумму',
      placeholder_qty: 'Введите количество'
    },

    en: {
      lang_ru: 'RU',
      lang_en: 'EN',
      lang_zh: '中文',

      back: 'Back',
      save: 'Save',
      cancel: 'Cancel',
      clear: 'Clear',
      refresh: 'Refresh',
      search: 'Search',
      reset: 'Reset',
      apply: 'Apply',
      create: 'Create',
      add: 'Add',
      edit: 'Edit',
      delete: 'Delete',
      open: 'Open',
      close: 'Close',
      load: 'Load',
      download: 'Download',
      export: 'Export',
      confirm: 'Confirm',
      pay: 'Pay',
      sell: 'Sell',
      receive: 'Receive',
      writeoff_action: 'Write off',
      open_module: 'Open module',

      status_loading: 'Loading...',
      status_saving: 'Saving...',
      status_success: 'Success',
      status_error: 'Error',
      status_done: 'Done',
      status_not_found: 'Not found',
      status_no_data: 'No data',

      page_items_title: 'BFC24 CONTROL — Items',
      page_clients_title: 'BFC24 CONTROL — Clients',
      page_locations_title: 'BFC24 CONTROL — Storage Locations',
      page_sales_title: 'BFC24 CONTROL — Sales',
      page_stock_title: 'BFC24 CONTROL — Stock',
      page_incoming_title: 'BFC24 CONTROL — Receiving',
      page_movements_title: 'BFC24 CONTROL — Inventory Movements',
      page_writeoff_title: 'BFC24 CONTROL — Write-off',
      page_expenses_title: 'BFC24 CONTROL — Expenses',
      page_debts_title: 'BFC24 CONTROL — Client Debts',
      page_cash_title: 'BFC24 CONTROL — Cash',
      page_analytics_title: 'BFC24 CONTROL — Analytics',

      items: 'Items',
      items_title: 'Items',
      items_add: 'Add item',
      items_list: 'Items list',
      item_name: 'Name',
      item_sku: 'SKU',
      item_barcode: 'Barcode',
      item_unit: 'Unit',
      item_purchase_price: 'Purchase price',
      item_sale_price: 'Sale price',
      item_comment: 'Comment',
      item_search: 'Search item',

      clients: 'Clients',
      clients_title: 'Clients',
      clients_add: 'Add client',
      clients_list: 'Clients list',
      client_name: 'Client name',
      client_phone: 'Phone',
      client_comment: 'Comment',
      client_search: 'Search client',

      locations: 'Storage Locations',
      locations_title: 'Storage Locations',
      locations_add: 'Add location',
      locations_list: 'Locations list',
      location_name: 'Name',
      location_code: 'Code',
      location_type: 'Type',
      location_comment: 'Comment',
      location_search: 'Search location',

      sales: 'Sales',
      sales_title: 'Sales',
      sales_form: 'Create sale',
      select_item: 'Select item',
      select_client: 'Select client',
      select_location: 'Select location',
      quantity: 'Quantity',
      price: 'Price',
      amount: 'Amount',
      comment: 'Comment',
      payment_type: 'Payment type',
      sale_comment: 'Sale comment',

      stock: 'Stock',
      stock_title: 'Stock',
      stock_filters: 'Filters',
      stock_table: 'Stock table',
      stock_search: 'Search by item',
      stock_location: 'Storage location',
      stock_item: 'Item',
      stock_qty: 'Balance',
      stock_total: 'Total',

      incoming: 'Receiving',
      incoming_title: 'Receiving',
      incoming_form: 'Receive items',
      incoming_item: 'Item',
      incoming_location: 'Storage location',
      incoming_qty: 'Quantity',
      incoming_price: 'Purchase price',
      incoming_comment: 'Comment',

      movements: 'Movements',
      movements_title: 'Inventory Movements',
      movements_filters: 'Movement filters',
      movements_table: 'Movements journal',
      movement_type: 'Movement type',
      movement_date: 'Date',
      movement_item: 'Item',
      movement_location: 'Storage location',
      movement_qty: 'Quantity',
      movement_comment: 'Comment',

      writeoff: 'Write-off',
      writeoff_title: 'Write-off',
      writeoff_form: 'Write off item',
      writeoff_item: 'Item',
      writeoff_location: 'Storage location',
      writeoff_qty: 'Quantity',
      writeoff_reason: 'Reason',
      writeoff_comment: 'Comment',

      expenses: 'Expenses',
      expenses_title: 'Expenses',
      expenses_add: 'Add expense',
      expenses_list: 'Expenses list',
      expense_date: 'Date',
      expense_category: 'Category',
      expense_name: 'Expense name',
      expense_amount: 'Expense amount',
      expense_comment: 'Comment',

      debts: 'Client Debts',
      debts_title: 'Client Debts',
      debts_filters: 'Debt filters',
      debts_table: 'Debt list',
      debt_client: 'Client',
      debt_amount: 'Debt amount',
      debt_paid: 'Paid',
      debt_balance: 'Balance',
      debt_status: 'Status',

      cash: 'Cash',
      cash_title: 'Cash',
      cash_filters: 'Filters',
      cash_table: 'Cash journal',
      cash_income: 'Income',
      cash_expense: 'Expense',
      cash_amount: 'Amount',
      cash_source: 'Source',
      cash_date: 'Date',

      analytics: 'Analytics',
      analytics_title: 'Analytics',
      analytics_filters: 'Analytics period',
      analytics_summary: 'Summary',
      analytics_revenue: 'Revenue',
      analytics_profit: 'Profit',
      analytics_expenses: 'Expenses',
      analytics_stock_value: 'Stock capitalization',

      date_from: 'Date from',
      date_to: 'Date to',
      period: 'Period',
      today: 'Today',
      week: 'Week',
      month: 'Month',
      all_time: 'All time',

      placeholder_search: 'Type to search...',
      placeholder_comment: 'Enter comment...',
      placeholder_amount: 'Enter amount',
      placeholder_qty: 'Enter quantity'
    },

    zh: {
      lang_ru: 'RU',
      lang_en: 'EN',
      lang_zh: '中文',

      back: '返回',
      save: '保存',
      cancel: '取消',
      clear: '清空',
      refresh: '刷新',
      search: '搜索',
      reset: '重置',
      apply: '应用',
      create: '创建',
      add: '新增',
      edit: '编辑',
      delete: '删除',
      open: '打开',
      close: '关闭',
      load: '加载',
      download: '下载',
      export: '导出',
      confirm: '确认',
      pay: '支付',
      sell: '销售',
      receive: '入库',
      writeoff_action: '报损',
      open_module: '打开模块',

      status_loading: '加载中...',
      status_saving: '保存中...',
      status_success: '成功',
      status_error: '错误',
      status_done: '完成',
      status_not_found: '未找到',
      status_no_data: '没有数据',

      page_items_title: 'BFC24 CONTROL — 商品',
      page_clients_title: 'BFC24 CONTROL — 客户',
      page_locations_title: 'BFC24 CONTROL — 库位',
      page_sales_title: 'BFC24 CONTROL — 销售',
      page_stock_title: 'BFC24 CONTROL — 库存',
      page_incoming_title: 'BFC24 CONTROL — 入库',
      page_movements_title: 'BFC24 CONTROL — 库存流水',
      page_writeoff_title: 'BFC24 CONTROL — 报损',
      page_expenses_title: 'BFC24 CONTROL — 支出',
      page_debts_title: 'BFC24 CONTROL — 客户欠款',
      page_cash_title: 'BFC24 CONTROL — 资金',
      page_analytics_title: 'BFC24 CONTROL — 分析',

      items: '商品',
      items_title: '商品',
      items_add: '新增商品',
      items_list: '商品列表',
      item_name: '名称',
      item_sku: 'SKU',
      item_barcode: '条码',
      item_unit: '单位',
      item_purchase_price: '采购价',
      item_sale_price: '售价',
      item_comment: '备注',
      item_search: '搜索商品',

      clients: '客户',
      clients_title: '客户',
      clients_add: '新增客户',
      clients_list: '客户列表',
      client_name: '客户名称',
      client_phone: '电话',
      client_comment: '备注',
      client_search: '搜索客户',

      locations: '库位',
      locations_title: '库位',
      locations_add: '新增库位',
      locations_list: '库位列表',
      location_name: '名称',
      location_code: '编码',
      location_type: '类型',
      location_comment: '备注',
      location_search: '搜索库位',

      sales: '销售',
      sales_title: '销售',
      sales_form: '创建销售',
      select_item: '选择商品',
      select_client: '选择客户',
      select_location: '选择库位',
      quantity: '数量',
      price: '价格',
      amount: '金额',
      comment: '备注',
      payment_type: '付款方式',
      sale_comment: '销售备注',

      stock: '库存',
      stock_title: '库存',
      stock_filters: '筛选',
      stock_table: '库存表',
      stock_search: '按商品搜索',
      stock_location: '库位',
      stock_item: '商品',
      stock_qty: '余额',
      stock_total: '合计',

      incoming: '入库',
      incoming_title: '入库',
      incoming_form: '商品入库',
      incoming_item: '商品',
      incoming_location: '库位',
      incoming_qty: '数量',
      incoming_price: '采购价',
      incoming_comment: '备注',

      movements: '流水',
      movements_title: '库存流水',
      movements_filters: '流水筛选',
      movements_table: '流水记录',
      movement_type: '类型',
      movement_date: '日期',
      movement_item: '商品',
      movement_location: '库位',
      movement_qty: '数量',
      movement_comment: '备注',

      writeoff: '报损',
      writeoff_title: '报损',
      writeoff_form: '商品报损',
      writeoff_item: '商品',
      writeoff_location: '库位',
      writeoff_qty: '数量',
      writeoff_reason: '原因',
      writeoff_comment: '备注',

      expenses: '支出',
      expenses_title: '支出',
      expenses_add: '新增支出',
      expenses_list: '支出列表',
      expense_date: '日期',
      expense_category: '类别',
      expense_name: '支出名称',
      expense_amount: '支出金额',
      expense_comment: '备注',

      debts: '客户欠款',
      debts_title: '客户欠款',
      debts_filters: '欠款筛选',
      debts_table: '欠款列表',
      debt_client: '客户',
      debt_amount: '欠款金额',
      debt_paid: '已支付',
      debt_balance: '剩余',
      debt_status: '状态',

      cash: '资金',
      cash_title: '资金',
      cash_filters: '筛选',
      cash_table: '资金流水',
      cash_income: '收入',
      cash_expense: '支出',
      cash_amount: '金额',
      cash_source: '来源',
      cash_date: '日期',

      analytics: '分析',
      analytics_title: '分析',
      analytics_filters: '分析周期',
      analytics_summary: '汇总',
      analytics_revenue: '营业额',
      analytics_profit: '利润',
      analytics_expenses: '支出',
      analytics_stock_value: '库存占用资金',

      date_from: '开始日期',
      date_to: '结束日期',
      period: '周期',
      today: '今天',
      week: '一周',
      month: '一个月',
      all_time: '全部时间',

      placeholder_search: '输入以搜索...',
      placeholder_comment: '输入备注...',
      placeholder_amount: '输入金额',
      placeholder_qty: '输入数量'
    }
  };


  const rawTextMap = {
  "Назад": {
    "en": "Back",
    "zh": "返回"
  },
  "Выйти": {
    "en": "Logout",
    "zh": "退出"
  },
  "Обновить": {
    "en": "Refresh",
    "zh": "刷新"
  },
  "Все": {
    "en": "All",
    "zh": "全部"
  },
  "Сегодня": {
    "en": "Today",
    "zh": "今天"
  },
  "Неделя": {
    "en": "Week",
    "zh": "本周"
  },
  "Месяц": {
    "en": "Month",
    "zh": "本月"
  },
  "Дата от": {
    "en": "Date from",
    "zh": "开始日期"
  },
  "Дата до": {
    "en": "Date to",
    "zh": "结束日期"
  },
  "Ошибка": {
    "en": "Error",
    "zh": "错误"
  },
  "Нет данных": {
    "en": "No data",
    "zh": "无数据"
  },
  "Загрузка данных...": {
    "en": "Loading data...",
    "zh": "正在加载数据..."
  },
  "Карта": {
    "en": "Card",
    "zh": "银行卡"
  },
  "Наличные": {
    "en": "Cash",
    "zh": "现金"
  },
  "Перевод": {
    "en": "Transfer",
    "zh": "转账"
  },
  "Сумма": {
    "en": "Amount",
    "zh": "金额"
  },
  "Комментарий": {
    "en": "Comment",
    "zh": "备注"
  },
  "Дата": {
    "en": "Date",
    "zh": "日期"
  },
  "Записей": {
    "en": "Records",
    "zh": "记录数"
  },
  "Создал": {
    "en": "Created by",
    "zh": "创建人"
  },
  "BFC24 CONTROL — Долги клиентов": {
    "en": "BFC24 CONTROL — Client Debts",
    "zh": "BFC24 CONTROL — 客户欠款"
  },
  "Долги клиентов": {
    "en": "Client debts",
    "zh": "客户欠款"
  },
  "Фильтры долгов": {
    "en": "Debt filters",
    "zh": "欠款筛选"
  },
  "Поиск по клиенту / товару / комментарию": {
    "en": "Search by client / item / comment",
    "zh": "按客户 / 商品 / 备注搜索"
  },
  "Статус долга": {
    "en": "Debt status",
    "zh": "欠款状态"
  },
  "Все статусы": {
    "en": "All statuses",
    "zh": "全部状态"
  },
  "Открыт": {
    "en": "Open",
    "zh": "未结清"
  },
  "Частично оплачен": {
    "en": "Partially paid",
    "zh": "部分已付"
  },
  "Оплачен": {
    "en": "Paid",
    "zh": "已支付"
  },
  "Всего долгов": {
    "en": "Total debts",
    "zh": "欠款总数"
  },
  "Открытых": {
    "en": "Open",
    "zh": "未结清"
  },
  "Частичных": {
    "en": "Partial",
    "zh": "部分支付"
  },
  "Закрытых": {
    "en": "Closed",
    "zh": "已结清"
  },
  "Общий остаток": {
    "en": "Total balance",
    "zh": "剩余总额"
  },
  "Список долгов": {
    "en": "Debt list",
    "zh": "欠款列表"
  },
  "Можно принимать частичную или полную оплату по каждому долгу.": {
    "en": "You can accept partial or full payment for each debt.",
    "zh": "可对每笔欠款进行部分或全额收款。"
  },
  "Клиент": {
    "en": "Client",
    "zh": "客户"
  },
  "Товар": {
    "en": "Item",
    "zh": "商品"
  },
  "МХ": {
    "en": "Location",
    "zh": "库位"
  },
  "Кол-во": {
    "en": "Qty",
    "zh": "数量"
  },
  "Остаток": {
    "en": "Balance",
    "zh": "余额"
  },
  "Комментарий к оплате": {
    "en": "Payment comment",
    "zh": "付款备注"
  },
  "Принять оплату": {
    "en": "Accept payment",
    "zh": "确认收款"
  },
  "Поле суммы не найдено": {
    "en": "Amount field not found",
    "zh": "未找到金额字段"
  },
  "Укажи корректную сумму оплаты": {
    "en": "Enter a valid payment amount",
    "zh": "请输入正确的付款金额"
  },
  "Ошибка загрузки данных": {
    "en": "Failed to load data",
    "zh": "数据加载失败"
  },
  "Загрузка долгов...": {
    "en": "Loading debts...",
    "zh": "正在加载欠款..."
  },
  "Ошибка оплаты: ": {
    "en": "Payment error: ",
    "zh": "付款错误："
  },
  "BFC24 CONTROL — Расходы": {
    "en": "BFC24 CONTROL — Expenses",
    "zh": "BFC24 CONTROL — 支出"
  },
  "Расходы": {
    "en": "Expenses",
    "zh": "支出"
  },
  "Добавить расход": {
    "en": "Add expense",
    "zh": "添加支出"
  },
  "Категория": {
    "en": "Category",
    "zh": "类别"
  },
  "Выбери категорию": {
    "en": "Select category",
    "zh": "选择类别"
  },
  "Аренда": {
    "en": "Rent",
    "zh": "租金"
  },
  "Зарплата": {
    "en": "Salary",
    "zh": "工资"
  },
  "Закупка": {
    "en": "Purchase",
    "zh": "采购"
  },
  "Доставка": {
    "en": "Delivery",
    "zh": "配送"
  },
  "Реклама": {
    "en": "Advertising",
    "zh": "广告"
  },
  "Коммунальные": {
    "en": "Utilities",
    "zh": "水电费"
  },
  "Прочее": {
    "en": "Other",
    "zh": "其他"
  },
  "Способ оплаты": {
    "en": "Payment method",
    "zh": "支付方式"
  },
  "Дата расхода": {
    "en": "Expense date",
    "zh": "支出日期"
  },
  "Сохранить расход": {
    "en": "Save expense",
    "zh": "保存支出"
  },
  "Очистить": {
    "en": "Clear",
    "zh": "清空"
  },
  "Фильтры и история расходов": {
    "en": "Filters and expense history",
    "zh": "筛选和支出历史"
  },
  "Поиск по комментарию / категории / пользователю": {
    "en": "Search by comment / category / user",
    "zh": "按备注 / 类别 / 用户搜索"
  },
  "Быстрый период": {
    "en": "Quick period",
    "zh": "快捷周期"
  },
  "Сумма расходов": {
    "en": "Expense total",
    "zh": "支出总额"
  },
  "Средний расход": {
    "en": "Average expense",
    "zh": "平均支出"
  },
  "Тип": {
    "en": "Type",
    "zh": "类型"
  },
  "Оплата": {
    "en": "Payment",
    "zh": "支付"
  },
  "Расход": {
    "en": "Expense",
    "zh": "支出"
  },
  "Например: 1500": {
    "en": "For example: 1500",
    "zh": "例如：1500"
  },
  "Например: аренда контейнера за апрель": {
    "en": "For example: container rent for April",
    "zh": "例如：4月集装箱租金"
  },
  "Например: аренда, зарплата, admin": {
    "en": "For example: rent, salary, admin",
    "zh": "例如：租金、工资、admin"
  },
  "Расход успешно сохранён": {
    "en": "Expense saved successfully",
    "zh": "支出保存成功"
  },
  "Сохраняю расход...": {
    "en": "Saving expense...",
    "zh": "正在保存支出..."
  },
  "Укажи корректную сумму расхода": {
    "en": "Enter a valid expense amount",
    "zh": "请输入正确的支出金额"
  },
  "Загрузка расходов...": {
    "en": "Loading expenses...",
    "zh": "正在加载支出..."
  },
  "Товары": {
    "en": "Items",
    "zh": "商品"
  },
  "Добавить товар": {
    "en": "Add item",
    "zh": "添加商品"
  },
  "Список товаров": {
    "en": "Items list",
    "zh": "商品列表"
  },
  "Места хранения": {
    "en": "Storage locations",
    "zh": "库位"
  },
  "Добавить место хранения": {
    "en": "Add storage location",
    "zh": "添加库位"
  },
  "Список мест хранения": {
    "en": "Storage locations list",
    "zh": "库位列表"
  },
  "Создание мест хранения": {
    "en": "Creating storage locations",
    "zh": "创建库位"
  },
  "Справочник товаров": {
    "en": "Item directory",
    "zh": "商品目录"
  },
  "Поиск по названию, артикулу, штрихкоду": {
    "en": "Search by name, article, barcode",
    "zh": "按名称、货号、条码搜索"
  },
  "Поиск по названию, коду, типу": {
    "en": "Search by name, code, type",
    "zh": "按名称、编码、类型搜索"
  },
  "Артикул / SKU": {
    "en": "Article / SKU",
    "zh": "货号 / SKU"
  },
  "Закупочная цена": {
    "en": "Purchase price",
    "zh": "采购价"
  },
  "Цена продажи": {
    "en": "Sale price",
    "zh": "销售价"
  },
  "Единица": {
    "en": "Unit",
    "zh": "单位"
  },
  "Активно": {
    "en": "Active",
    "zh": "启用"
  },
  "Действия": {
    "en": "Actions",
    "zh": "操作"
  },
  "Например: pcs": {
    "en": "For example: pcs",
    "zh": "例如：pcs"
  },
  "Например: Контейнер 1": {
    "en": "For example: Container 1",
    "zh": "例如：集装箱 1"
  },
  "Например: K1": {
    "en": "For example: K1",
    "zh": "例如：K1"
  },
  "Контейнер": {
    "en": "Container",
    "zh": "集装箱"
  },
  "Склад": {
    "en": "Warehouse",
    "zh": "仓库"
  },
  "Магазин": {
    "en": "Shop",
    "zh": "门店"
  },
  "Полка": {
    "en": "Shelf",
    "zh": "货架"
  },
  "Другое": {
    "en": "Other",
    "zh": "其他"
  }
};

  Object.assign(dictionaries.ru, {
  "sales_page_title": "BFC24 CONTROL — Продажа",
  "sales_title": "Продажа",
  "back": "← Главная",
  "logout": "Выйти",
  "sales_new_sale": "Новая продажа",
  "sales_subtitle": "Экран работает с backend SaaS. Для owner tenant_id передаётся обязательно.",
  "sales_items_loaded": "Товаров загружено",
  "sales_locations_loaded": "Мест хранения",
  "sales_clients_loaded": "Клиентов",
  "sales_stock_loaded": "Остатков загружено",
  "tenant_id": "Tenant ID",
  "owner_required_hint": "Для owner обязательно.",
  "payment_method": "Способ оплаты",
  "payment_cash": "Наличные",
  "payment_card": "Карта",
  "payment_transfer": "Перевод",
  "payment_consignment": "Под реализацию",
  "item": "Товар",
  "search_item_placeholder": "Начни вводить название, штрихкод, SKU или артикул",
  "storage_location": "Место хранения",
  "select_location": "Выберите МХ",
  "client": "Клиент",
  "without_client": "Без клиента",
  "quantity": "Количество",
  "unit_price": "Цена за единицу",
  "comment": "Комментарий",
  "sales_comment_placeholder": "Комментарий к продаже",
  "submit_sale": "Провести продажу",
  "refresh_data": "Обновить данные",
  "selected_stock_prefix": "Остаток на выбранном МХ",
  "select_location_to_see_stock": "${i18n.t(",
  "selected_item_title": "Выбран товар:",
  "sku_short": "SKU",
  "barcode_short": "ШК",
  "article_short": "Артикул",
  "nothing_found": "Ничего не найдено",
  "check_search_query": "Проверь название, штрихкод, SKU или артикул.",
  "unnamed": "Без названия",
  "provide_tenant_id": "Укажи tenant_id",
  "choose_item_from_list": "Выбери товар из списка",
  "choose_location": "Выбери место хранения",
  "qty_must_be_positive": "Количество должно быть больше 0",
  "price_non_negative": "Цена не может быть отрицательной",
  "stock_not_determined": "Не удалось определить остаток по выбранному месту хранения",
  "insufficient_stock": "Недостаточно товара. Остаток",
  "loading_data": "Загрузка данных...",
  "data_loaded": "Данные загружены.",
  "load_error": "Ошибка загрузки данных: ",
  "processing_sale": "Провожу продажу...",
  "sale_success": "Продажа успешно проведена.",
  "sale_error": "Ошибка продажи",
  "error_generic": "Ошибка",
  "lang_ru": "RU",
  "lang_en": "EN",
  "lang_zh": "中文",
  "stock_page_title": "BFC24 CONTROL — Остатки",
  "stock_title": "Остатки",
  "filters": "Фильтры",
  "stock_search_label": "Поиск по товару / артикулу / штрихкоду",
  "stock_search_placeholder": "Например: Тест, SaaS, SKU, barcode",
  "all_locations": "Все МХ",
  "refresh": "Обновить",
  "stock_rows": "Строк остатков",
  "items": "Товаров",
  "locations": "Мест хранения",
  "filtered_total": "Сумма по фильтру",
  "grand_total": "Общая сумма",
  "current_stock": "Текущие остатки",
  "current_stock_desc": "Показываются фактические остатки по товарам и местам хранения.",
  "article_sku": "Артикул / SKU",
  "barcode": "Штрихкод",
  "item_batches": "Партии товаров",
  "item_batches_desc": "Показываются партии закупки для FIFO, капитализации и контроля себестоимости.",
  "batch_date": "Дата партии",
  "batch_qty": "Кол-во в партии",
  "batch_balance": "Остаток партии",
  "purchase_price": "Цена закупки",
  "balance_amount": "Сумма остатка",
  "loading_batches": "Загрузка партий...",
  "no_stock_for_filter": "Нет остатков по выбранному фильтру",
  "no_batches_for_filter": "Нет партий по выбранному фильтру",
  "stock_loading": "Загрузка остатков...",
  "rows_count": "Строк остатков",
  "batches_count": "Партий",
  "title": "Деньги",
  "search_label": "Поиск",
  "search_placeholder": "Введите для поиска...",
  "type": "Тип",
  "all": "Все",
  "income": "Доход",
  "expense": "Расход",
  "cash": "Наличные",
  "card": "Карта",
  "transfer": "Перевод",
  "consignment": "Под реализацию",
  "quick_period": "Быстрый период",
  "today": "Сегодня",
  "week": "Неделя",
  "month": "Месяц",
  "date_from": "С даты",
  "date_to": "По дату",
  "records": "Записей",
  "balance": "Остаток",
  "money_movements": "Движения денег",
  "money_movements_desc": "Показываются денежные операции по продажам, оплатам и другим действиям.",
  "amount": "Сумма",
  "payment": "Оплата",
  "category": "Категория",
  "date": "Дата",
  "no_data": "Нет данных",
  "subtitle": "Финансовый отчёт · BFC24 CONTROL",
  "days_7": "7 дн",
  "days_30": "30 дн",
  "days_90": "90 дн",
  "year": "Год",
  "reset": "Сбросить",
  "apply": "Применить",
  "loading": "Загрузка...",
  "error": "Ошибка",
  "session_expired": "Сессия истекла.",
  "login_again": "Войти снова",
  "tenant_missing_title": "Не выбран клиент (tenant_id).",
  "tenant_missing_text": "Укажите Tenant ID в поле фильтра выше и нажмите «Применить» — или откройте страницу с параметром",
  "tenant_missing_tail": "в URL.",
  "example": "Например:",
  "pnl": "P&L — Прибыли и убытки",
  "daily": "Динамика по дням",
  "top_items": "Топ товаров",
  "by_revenue": "по выручке",
  "debts_sales": "Долги и реализация",
  "up_to_date": "Актуально на сейчас",
  "warehouse_state": "Состояние склада",
  "stock_diff": "Расхождения остатков",
  "expenses_categories": "Расходы по категориям",
  "no_data_period": "Нет данных за период",
  "expand_range": "Попробуйте расширить диапазон дат.",
  "revenue": "Выручка",
  "net_profit": "Чистая прибыль",
  "gross_profit": "Вал. прибыль",
  "expenses": "Расходы",
  "no_sales_period": "Нет продаж за период",
  "product": "Товар",
  "qty": "Кол-во",
  "cost": "Себест.",
  "gross_profit_short": "Вал. прибыль",
  "margin": "Маржа",
  "top_total": "Итого топ-",
  "no_open_debts": "Нет открытых долгов",
  "all_consignments_paid": "Все реализации оплачены.",
  "counterparty": "Контрагент",
  "debt": "Долг",
  "paid": "Оплачено",
  "progress": "Прогресс",
  "term_overdue": "Срок / просрочка",
  "all_synced": "Всё синхронизировано",
  "stock_matches_batches": "Остатки stock совпадают с партиями item_batches.",
  "in_stock": "В stock",
  "in_batches": "В batches",
  "difference": "Разница",
  "severity": "Степень",
  "dynamics_error": "Ошибка динамики",
  "top_items_error": "Ошибка топ товаров",
  "top_open_debts": "Топ открытых долгов",
  "stock_value_fifo": "Стоимость остатков (FIFO)",
  "sku_in_stock": "SKU на складе",
  "potential_revenue": "Потенциальная выручка",
  "sale_price": "По цене продажи",
  "potential_profit": "Потенциальная прибыль",
  "sell_all_stock": "Продать весь склад",
  "stock_error": "Ошибка склада",
  "debts_error": "Ошибка долгов",
  "load_failed": "Не удалось загрузить данные:",
  "server_error": "Ошибка сервера",
  "top_by_revenue": "топ {n} по выручке",
  "severe": "⚠ Серьёзное",
  "minor": "△ Малое",
  "incoming_page_title": "BFC24 CONTROL — Приёмка",
  "incoming_title": "Приёмка",
  "new_receiving": "Новая приёмка",
  "incoming_subtitle": "Выбери товар, место хранения, количество и цену закупки для прихода на склад.",
  "items_loaded": "Товаров загружено",
  "locations_loaded": "Мест хранения",
  "purchase_price_hint": "Укажи закупочную цену за 1 единицу товара.",
  "incoming_comment_placeholder": "Например: новая поставка, докупка, возврат товара",
  "comment_optional_hint": "Комментарий не обязателен, но лучше указывать.",
  "submit_receiving": "Провести приёмку",
  "receiving_success": "Приёмка успешно проведена.",
  "receiving_error": "Ошибка приёмки: ",
  "common.languageRu": "RU",
  "common.languageEn": "EN",
  "common.languageZh": "中文",
  "common.appName": "BFC24 CONTROL",
  "common.loadingUser": "Проверка пользователя...",
  "common.ownerMode": "Режим owner",
  "common.companyLabel": "Компания",
  "common.userLabel": "Пользователь",
  "common.roleLabel": "Роль",
  "common.tenantLabel": "Tenant ID",
  "common.loginConnectionError": "Ошибка подключения",
  "login.heading": "BFC24 CONTROL",
  "login.usernamePlaceholder": "Логин",
  "login.passwordPlaceholder": "Пароль",
  "login.submit": "Войти",
  "index.subtitle": "Главное меню тестирования системы",
  "index.itemsTitle": "Товары",
  "index.itemsDesc": "Справочник товаров и цены",
  "index.locationsTitle": "Места хранения",
  "index.locationsDesc": "Справочник контейнеров, складов и точек",
  "index.clientsTitle": "Клиенты",
  "index.clientsDesc": "База покупателей и контрагентов",
  "index.incomingTitle": "Приёмка",
  "index.incomingDesc": "Приход товаров на склад",
  "index.salesTitle": "Продажа",
  "index.salesDesc": "Продажа товаров и списание остатков",
  "index.stockTitle": "Остатки",
  "index.stockDesc": "Текущие остатки по товарам и местам хранения",
  "index.movementsTitle": "Движения товара",
  "index.movementsDesc": "История приходов, продаж и списаний",
  "index.writeoffTitle": "Списание",
  "index.writeoffDesc": "Списание брака, потерь и пересорта",
  "index.cashTitle": "Деньги",
  "index.cashDesc": "Доходы, расходы и баланс",
  "index.debtsTitle": "Долги клиентов",
  "index.debtsDesc": "Контроль реализаций и погашений",
  "index.expensesTitle": "Расходы",
  "index.expensesDesc": "Учёт аренды, зарплат и других трат",
  "index.analyticsTitle": "Аналитика",
  "index.analyticsDesc": "Сводные показатели бизнеса",
  "index.openModule": "Открыть модуль",
  "index.logoutTitle": "Выход",
  "index.logoutDesc": "Очистить токен и выйти из системы",
  "index.logoutButton": "Выйти",
  "index.ownerRedirectTitle": "Кабинет владельца",
  "index.ownerRedirectText": "Для owner доступен отдельный экран управления SaaS.",
  "index.ownerRedirectButton": "Открыть кабинет владельца",
  "clients_page_title": "BFC24 CONTROL — Клиенты",
  "clients_name": "Имя",
  "clients_phone": "Телефон",
  "clients_comment": "Комментарий",
  "items_desc": "Справочник товаров",
  "locations_desc": "Создание мест хранения",
  "actions": "Действия",
  "status_active": "Активно",
  "required_suffix": "обязательно",
  "yes": "Да",
  "no": "Нет",
  "location_type_container": "Контейнер",
  "location_type_warehouse": "Склад",
  "location_type_storage": "Storage",
  "location_type_shop": "Магазин",
  "location_type_shelf": "Полка",
  "location_type_other": "Другое",
  "user": "Пользователь",
  "last_7_days": "Последние 7 дней",
  "last_30_days": "Последние 30 дней",
  "this_month": "Этот месяц",
  "location": "Место хранения",
  "movements_page_title": "BFC24 CONTROL — Движения товара",
  "writeoff_page_title": "BFC24 CONTROL — Списание",
  "submit_writeoff": "Провести списание",
  "new_writeoff": "Новое списание",
  "location_short": "МХ",
  "type_receipt": "Приёмка",
  "type_sale": "Продажа",
  "type_writeoff": "Списание",
  "type_transfer_in": "Перемещение +",
  "type_transfer_out": "Перемещение -",
  "type_adjustment": "Корректировка",
  "history_title": "История движений",
  "history_subtitle": "Показываются движения товаров по складу и операциям.",
  "receipts": "Приёмок",
  "sales_label": "Продаж",
  "writeoffs": "Списаний",
  "comment_required_hint": "Комментарий обязателен.",
  "comment_placeholder": "Например: брак, повреждение, пересорт, утеря"
});
  Object.assign(dictionaries.en, {
  "sales_page_title": "BFC24 CONTROL — Sales",
  "sales_title": "Sale",
  "back": "← Main menu",
  "logout": "Logout",
  "sales_new_sale": "New sale",
  "sales_subtitle": "This screen works with the SaaS backend. tenant_id is required for owner.",
  "sales_items_loaded": "Items loaded",
  "sales_locations_loaded": "Locations loaded",
  "sales_clients_loaded": "Clients loaded",
  "sales_stock_loaded": "Stock rows loaded",
  "tenant_id": "Tenant ID",
  "owner_required_hint": "Required for owner.",
  "payment_method": "Payment method",
  "payment_cash": "Cash",
  "payment_card": "Card",
  "payment_transfer": "Transfer",
  "payment_consignment": "Consignment",
  "item": "Item",
  "search_item_placeholder": "Start typing name, barcode, SKU or article",
  "storage_location": "Storage location",
  "select_location": "Select location",
  "client": "Client",
  "without_client": "Without client",
  "quantity": "Quantity",
  "unit_price": "Unit price",
  "comment": "Comment",
  "sales_comment_placeholder": "Sale comment",
  "submit_sale": "Submit sale",
  "refresh_data": "Refresh data",
  "selected_stock_prefix": "Stock at selected location",
  "select_location_to_see_stock": "Select a location to see stock",
  "selected_item_title": "Selected item:",
  "sku_short": "SKU",
  "barcode_short": "Barcode",
  "article_short": "Article",
  "nothing_found": "Nothing found",
  "check_search_query": "Check name, barcode, SKU or article.",
  "unnamed": "Unnamed",
  "provide_tenant_id": "Specify tenant_id",
  "choose_item_from_list": "Choose an item from the list",
  "choose_location": "Choose a storage location",
  "qty_must_be_positive": "Quantity must be greater than 0",
  "price_non_negative": "Price cannot be negative",
  "stock_not_determined": "Could not determine stock at the selected location",
  "insufficient_stock": "Not enough stock. Available",
  "loading_data": "Loading data...",
  "data_loaded": "Data loaded.",
  "load_error": "Data loading error: ",
  "processing_sale": "Processing sale...",
  "sale_success": "Sale completed successfully.",
  "sale_error": "Sale error",
  "error_generic": "Error",
  "lang_ru": "RU",
  "lang_en": "EN",
  "lang_zh": "中文",
  "stock_page_title": "BFC24 CONTROL — Stock",
  "stock_title": "Stock",
  "filters": "Filters",
  "stock_search_label": "Search by item / article / barcode",
  "stock_search_placeholder": "For example: Test, SaaS, SKU, barcode",
  "all_locations": "All locations",
  "refresh": "Refresh",
  "stock_rows": "Stock rows",
  "items": "Items",
  "locations": "Locations",
  "filtered_total": "Filtered total",
  "grand_total": "Grand total",
  "current_stock": "Current stock",
  "current_stock_desc": "Shows actual balances by items and storage locations.",
  "article_sku": "Article / SKU",
  "barcode": "Barcode",
  "item_batches": "Item batches",
  "item_batches_desc": "Purchase batches for FIFO, capitalization and cost control.",
  "batch_date": "Batch date",
  "batch_qty": "Batch quantity",
  "batch_balance": "Batch balance",
  "purchase_price": "Purchase price",
  "balance_amount": "Balance amount",
  "loading_batches": "Loading batches...",
  "no_stock_for_filter": "No stock for the selected filter",
  "no_batches_for_filter": "No batches for the selected filter",
  "stock_loading": "Loading stock...",
  "rows_count": "Stock rows",
  "batches_count": "Batches",
  "title": "Cash",
  "search_label": "Search",
  "search_placeholder": "Type to search...",
  "type": "Type",
  "all": "All",
  "income": "Income",
  "expense": "Expense",
  "cash": "Cash",
  "card": "Card",
  "transfer": "Transfer",
  "consignment": "Consignment",
  "quick_period": "Quick period",
  "today": "Today",
  "week": "Week",
  "month": "Month",
  "date_from": "From date",
  "date_to": "To date",
  "records": "Records",
  "balance": "Balance",
  "money_movements": "Cash movements",
  "money_movements_desc": "Shows cash operations for sales, payments and other actions.",
  "amount": "Amount",
  "payment": "Payment",
  "category": "Category",
  "date": "Date",
  "no_data": "No data",
  "subtitle": "Financial report · BFC24 CONTROL",
  "days_7": "7 d",
  "days_30": "30 d",
  "days_90": "90 d",
  "year": "Year",
  "reset": "Reset",
  "apply": "Apply",
  "loading": "Loading...",
  "error": "Error",
  "session_expired": "Session expired.",
  "login_again": "Sign in again",
  "tenant_missing_title": "No client selected (tenant_id).",
  "tenant_missing_text": "Enter Tenant ID in the filter above and click Apply — or open the page with parameter",
  "tenant_missing_tail": "in the URL.",
  "example": "For example:",
  "pnl": "P&L — Profit and Loss",
  "daily": "Daily trend",
  "top_items": "Top items",
  "by_revenue": "by revenue",
  "debts_sales": "Debts and consignments",
  "up_to_date": "Up to date",
  "warehouse_state": "Warehouse state",
  "stock_diff": "Stock discrepancies",
  "expenses_categories": "Expenses by category",
  "no_data_period": "No data for selected period",
  "expand_range": "Try a wider date range.",
  "revenue": "Revenue",
  "net_profit": "Net profit",
  "gross_profit": "Gross profit",
  "expenses": "Expenses",
  "no_sales_period": "No sales for selected period",
  "product": "Product",
  "qty": "Qty",
  "cost": "Cost",
  "gross_profit_short": "Gross profit",
  "margin": "Margin",
  "top_total": "Top total-",
  "no_open_debts": "No open debts",
  "all_consignments_paid": "All consignments are paid.",
  "counterparty": "Counterparty",
  "debt": "Debt",
  "paid": "Paid",
  "progress": "Progress",
  "term_overdue": "Due / overdue",
  "all_synced": "Everything is synchronized",
  "stock_matches_batches": "Stock balances match item_batches.",
  "in_stock": "In stock",
  "in_batches": "In batches",
  "difference": "Difference",
  "severity": "Severity",
  "dynamics_error": "Daily chart error",
  "top_items_error": "Top items error",
  "top_open_debts": "Top open debts",
  "stock_value_fifo": "Stock value (FIFO)",
  "sku_in_stock": "SKUs in stock",
  "potential_revenue": "Potential revenue",
  "sale_price": "At sale price",
  "potential_profit": "Potential profit",
  "sell_all_stock": "Sell entire stock",
  "stock_error": "Stock error",
  "debts_error": "Debts error",
  "load_failed": "Failed to load data:",
  "server_error": "Server error",
  "top_by_revenue": "top {n} by revenue",
  "severe": "⚠ Severe",
  "minor": "△ Minor",
  "incoming_page_title": "BFC24 CONTROL — Receiving",
  "incoming_title": "Receiving",
  "new_receiving": "New receiving",
  "incoming_subtitle": "Select item, storage location, quantity and purchase price for warehouse receipt.",
  "items_loaded": "Items loaded",
  "locations_loaded": "Locations",
  "purchase_price_hint": "Enter purchase price per 1 item.",
  "incoming_comment_placeholder": "For example: new shipment, replenishment, return",
  "comment_optional_hint": "Comment is optional but recommended.",
  "submit_receiving": "Submit receiving",
  "qty_positive": "Quantity must be greater than 0",
  "purchase_price_nonnegative": "Purchase price must be 0 or more",
  "processing_receiving": "Processing receiving...",
  "receiving_success": "Receiving completed successfully.",
  "receiving_error": "Receiving error: ",
  "common.languageRu": "RU",
  "common.languageEn": "EN",
  "common.languageZh": "中文",
  "common.appName": "BFC24 CONTROL",
  "common.loadingUser": "Checking user...",
  "common.ownerMode": "Owner mode",
  "common.companyLabel": "Company",
  "common.userLabel": "User",
  "common.roleLabel": "Role",
  "common.tenantLabel": "Tenant ID",
  "common.loginConnectionError": "Connection error",
  "login.heading": "BFC24 CONTROL",
  "login.usernamePlaceholder": "Username",
  "login.passwordPlaceholder": "Password",
  "login.submit": "Sign in",
  "index.subtitle": "Main test menu of the system",
  "index.itemsTitle": "Items",
  "index.itemsDesc": "Item directory and prices",
  "index.locationsTitle": "Locations",
  "index.locationsDesc": "Directory of containers, warehouses and shops",
  "index.clientsTitle": "Clients",
  "index.clientsDesc": "Buyers and counterparties",
  "index.incomingTitle": "Receiving",
  "index.incomingDesc": "Receive goods into stock",
  "index.salesTitle": "Sales",
  "index.salesDesc": "Sales and stock write-off",
  "index.stockTitle": "Stock",
  "index.stockDesc": "Current balances by items and locations",
  "index.movementsTitle": "Movements",
  "index.movementsDesc": "History of receipts, sales and write-offs",
  "index.writeoffTitle": "Write-off",
  "index.writeoffDesc": "Write off defects, losses and mismatches",
  "index.cashTitle": "Cash",
  "index.cashDesc": "Income, expenses and balance",
  "index.debtsTitle": "Client debts",
  "index.debtsDesc": "Consignment and repayment control",
  "index.expensesTitle": "Expenses",
  "index.expensesDesc": "Rent, salaries and other costs",
  "index.analyticsTitle": "Analytics",
  "index.analyticsDesc": "Business summary",
  "index.openModule": "Open module",
  "index.logoutTitle": "Logout",
  "index.logoutDesc": "Clear token and sign out",
  "index.logoutButton": "Logout",
  "index.ownerRedirectTitle": "Owner dashboard",
  "index.ownerRedirectText": "Owners use a separate SaaS management screen.",
  "index.ownerRedirectButton": "Open owner dashboard",
  "clients_page_title": "BFC24 CONTROL — Clients",
  "clients_name": "Name",
  "clients_phone": "Phone",
  "clients_comment": "Comment",
  "items_desc": "Item directory",
  "locations_desc": "Create storage locations",
  "actions": "Actions",
  "status_active": "Active",
  "required_suffix": "is required",
  "yes": "Yes",
  "no": "No",
  "location_type_container": "Container",
  "location_type_warehouse": "Warehouse",
  "location_type_storage": "Storage",
  "location_type_shop": "Shop",
  "location_type_shelf": "Shelf",
  "location_type_other": "Other",
  "user": "User",
  "last_7_days": "Last 7 days",
  "last_30_days": "Last 30 days",
  "this_month": "This month",
  "location": "Location",
  "movements_page_title": "BFC24 CONTROL — Inventory Movements",
  "writeoff_page_title": "BFC24 CONTROL — Write-off",
  "submit_writeoff": "Submit write-off",
  "new_writeoff": "New write-off",
  "location_short": "Loc",
  "type_receipt": "Receipt",
  "type_sale": "Sale",
  "type_writeoff": "Write-off",
  "type_transfer_in": "Transfer +",
  "type_transfer_out": "Transfer -",
  "type_adjustment": "Adjustment",
  "history_title": "Movement history",
  "history_subtitle": "Shows inventory movements by warehouse operations.",
  "receipts": "Receipts",
  "sales_label": "Sales",
  "writeoffs": "Write-offs",
  "comment_required_hint": "Comment is required.",
  "comment_placeholder": "For example: defect, damage, mismatch, loss"
});
  Object.assign(dictionaries.zh, {
  "sales_page_title": "BFC24 CONTROL — 销售",
  "sales_title": "销售",
  "back": "← 主菜单",
  "logout": "退出",
  "sales_new_sale": "新销售",
  "sales_subtitle": "此页面使用 SaaS 后端。Owner 必须传 tenant_id。",
  "sales_items_loaded": "已加载商品",
  "sales_locations_loaded": "已加载库位",
  "sales_clients_loaded": "已加载客户",
  "sales_stock_loaded": "已加载库存行",
  "tenant_id": "Tenant ID",
  "owner_required_hint": "Owner 必填。",
  "payment_method": "支付方式",
  "payment_cash": "现金",
  "payment_card": "银行卡",
  "payment_transfer": "转账",
  "payment_consignment": "寄售",
  "item": "商品",
  "search_item_placeholder": "输入名称、条码、SKU 或货号开始搜索",
  "storage_location": "库位",
  "select_location": "请选择库位",
  "client": "客户",
  "without_client": "无客户",
  "quantity": "数量",
  "unit_price": "单价",
  "comment": "备注",
  "sales_comment_placeholder": "销售备注",
  "submit_sale": "提交销售",
  "refresh_data": "刷新数据",
  "selected_stock_prefix": "所选库位库存",
  "select_location_to_see_stock": "请选择库位以查看库存",
  "selected_item_title": "已选择商品：",
  "sku_short": "SKU",
  "barcode_short": "条码",
  "article_short": "货号",
  "nothing_found": "未找到结果",
  "check_search_query": "请检查名称、条码、SKU 或货号。",
  "unnamed": "未命名",
  "provide_tenant_id": "请填写 tenant_id",
  "choose_item_from_list": "请从列表中选择商品",
  "choose_location": "请选择库位",
  "qty_must_be_positive": "数量必须大于 0",
  "price_non_negative": "价格不能为负数",
  "stock_not_determined": "无法确定所选库位的库存",
  "insufficient_stock": "库存不足。可用数量",
  "loading_data": "正在加载数据...",
  "data_loaded": "数据已加载。",
  "load_error": "数据加载错误：",
  "processing_sale": "正在处理销售...",
  "sale_success": "销售已成功完成。",
  "sale_error": "销售错误",
  "error_generic": "错误",
  "lang_ru": "RU",
  "lang_en": "EN",
  "lang_zh": "中文",
  "stock_page_title": "BFC24 CONTROL — 库存",
  "stock_title": "库存",
  "filters": "筛选",
  "stock_search_label": "按商品 / 货号 / 条码搜索",
  "stock_search_placeholder": "例如：Test、SaaS、SKU、barcode",
  "all_locations": "全部库位",
  "refresh": "刷新",
  "stock_rows": "库存行数",
  "items": "商品数",
  "locations": "库位数",
  "filtered_total": "筛选合计",
  "grand_total": "总计",
  "current_stock": "当前库存",
  "current_stock_desc": "显示按商品和库位统计的实际库存。",
  "article_sku": "货号 / SKU",
  "barcode": "条码",
  "item_batches": "商品批次",
  "item_batches_desc": "用于 FIFO、资金占用和成本控制的采购批次。",
  "batch_date": "批次日期",
  "batch_qty": "批次数量",
  "batch_balance": "批次余额",
  "purchase_price": "采购价",
  "balance_amount": "余额金额",
  "loading_batches": "正在加载批次...",
  "no_stock_for_filter": "所选筛选条件下没有库存",
  "no_batches_for_filter": "所选筛选条件下没有批次",
  "stock_loading": "正在加载库存...",
  "rows_count": "库存行数",
  "batches_count": "批次数",
  "title": "资金",
  "search_label": "搜索",
  "search_placeholder": "输入以搜索...",
  "type": "类型",
  "all": "全部",
  "income": "收入",
  "expense": "支出",
  "cash": "现金",
  "card": "银行卡",
  "transfer": "转账",
  "consignment": "寄售",
  "quick_period": "快捷周期",
  "today": "今天",
  "week": "本周",
  "month": "月",
  "date_from": "开始日期",
  "date_to": "结束日期",
  "records": "记录数",
  "balance": "余额",
  "money_movements": "资金流水",
  "money_movements_desc": "显示销售、付款及其他操作的资金记录。",
  "amount": "金额",
  "payment": "支付",
  "category": "分类",
  "date": "日期",
  "no_data": "没有数据",
  "subtitle": "财务报表 · BFC24 CONTROL",
  "days_7": "7天",
  "days_30": "30天",
  "days_90": "90天",
  "year": "年",
  "reset": "重置",
  "apply": "应用",
  "loading": "加载中...",
  "error": "错误",
  "session_expired": "会话已过期。",
  "login_again": "重新登录",
  "tenant_missing_title": "未选择客户（tenant_id）。",
  "tenant_missing_text": "请在上方筛选中填写 Tenant ID 并点击应用，或用参数打开页面",
  "tenant_missing_tail": "在 URL 中。",
  "example": "例如：",
  "pnl": "P&L — 损益",
  "daily": "按天趋势",
  "top_items": "热销商品",
  "by_revenue": "按收入",
  "debts_sales": "欠款与寄售",
  "up_to_date": "当前快照",
  "warehouse_state": "仓库状态",
  "stock_diff": "库存差异",
  "expenses_categories": "分类支出",
  "no_data_period": "该期间没有数据",
  "expand_range": "请尝试扩大日期范围。",
  "revenue": "收入",
  "net_profit": "净利润",
  "gross_profit": "毛利润",
  "expenses": "支出",
  "no_sales_period": "该期间没有销售",
  "product": "商品",
  "qty": "数量",
  "cost": "成本",
  "gross_profit_short": "毛利润",
  "margin": "利润率",
  "top_total": "前列合计-",
  "no_open_debts": "没有未结欠款",
  "all_consignments_paid": "所有寄售已结清。",
  "counterparty": "客户",
  "debt": "欠款",
  "paid": "已支付",
  "progress": "进度",
  "term_overdue": "到期 / 逾期",
  "all_synced": "数据已同步",
  "stock_matches_batches": "stock 与 item_batches 库存一致。",
  "in_stock": "在 stock",
  "in_batches": "在 batches",
  "difference": "差异",
  "severity": "级别",
  "dynamics_error": "动态数据错误",
  "top_items_error": "热销商品错误",
  "top_open_debts": "未结欠款 TOP",
  "stock_value_fifo": "库存成本 (FIFO)",
  "sku_in_stock": "在库 SKU",
  "potential_revenue": "潜在收入",
  "sale_price": "按销售价",
  "potential_profit": "潜在利润",
  "sell_all_stock": "卖出全部库存",
  "stock_error": "库存错误",
  "debts_error": "欠款错误",
  "load_failed": "数据加载失败：",
  "server_error": "服务器错误",
  "top_by_revenue": "前 {n} 名（按收入）",
  "severe": "⚠ 严重",
  "minor": "△ 轻微",
  "incoming_page_title": "BFC24 CONTROL — 入库",
  "incoming_title": "入库",
  "new_receiving": "新入库",
  "incoming_subtitle": "请选择商品、库位、数量和采购价以完成入库。",
  "items_loaded": "已加载商品",
  "locations_loaded": "库位数量",
  "purchase_price_hint": "请输入每 1 件商品的采购价格。",
  "incoming_comment_placeholder": "例如：新到货、补货、退货",
  "comment_optional_hint": "备注非必填，但建议填写。",
  "submit_receiving": "提交入库",
  "qty_positive": "数量必须大于 0",
  "purchase_price_nonnegative": "采购价必须大于或等于 0",
  "processing_receiving": "正在处理入库...",
  "receiving_success": "入库已成功完成。",
  "receiving_error": "入库错误：",
  "common.languageRu": "RU",
  "common.languageEn": "EN",
  "common.languageZh": "中文",
  "common.appName": "BFC24 CONTROL",
  "common.loadingUser": "正在检查用户...",
  "common.ownerMode": "Owner 模式",
  "common.companyLabel": "公司",
  "common.userLabel": "用户",
  "common.roleLabel": "角色",
  "common.tenantLabel": "Tenant ID",
  "common.loginConnectionError": "连接错误",
  "login.heading": "BFC24 CONTROL",
  "login.usernamePlaceholder": "登录名",
  "login.passwordPlaceholder": "密码",
  "login.submit": "登录",
  "index.subtitle": "系统测试主菜单",
  "index.itemsTitle": "商品",
  "index.itemsDesc": "商品目录和价格",
  "index.locationsTitle": "库位",
  "index.locationsDesc": "集装箱、仓库和门店目录",
  "index.clientsTitle": "客户",
  "index.clientsDesc": "买家和往来方",
  "index.incomingTitle": "入库",
  "index.incomingDesc": "商品入库",
  "index.salesTitle": "销售",
  "index.salesDesc": "销售并扣减库存",
  "index.stockTitle": "库存",
  "index.stockDesc": "按商品和库位查看当前库存",
  "index.movementsTitle": "库存流水",
  "index.movementsDesc": "入库、销售和报损历史",
  "index.writeoffTitle": "报损",
  "index.writeoffDesc": "处理损坏、丢失和差异",
  "index.cashTitle": "资金",
  "index.cashDesc": "收入、支出和余额",
  "index.debtsTitle": "客户欠款",
  "index.debtsDesc": "寄售和回款控制",
  "index.expensesTitle": "支出",
  "index.expensesDesc": "房租、工资和其他费用",
  "index.analyticsTitle": "分析",
  "index.analyticsDesc": "业务汇总",
  "index.openModule": "打开模块",
  "index.logoutTitle": "退出",
  "index.logoutDesc": "清除令牌并退出系统",
  "index.logoutButton": "退出",
  "index.ownerRedirectTitle": "Owner 管理台",
  "index.ownerRedirectText": "Owner 使用单独的 SaaS 管理界面。",
  "index.ownerRedirectButton": "打开 Owner 管理台",
  "clients_page_title": "BFC24 CONTROL — 客户",
  "clients_name": "姓名",
  "clients_phone": "电话",
  "clients_comment": "备注",
  "items_desc": "商品目录",
  "locations_desc": "创建库位",
  "actions": "操作",
  "status_active": "启用",
  "required_suffix": "必填",
  "yes": "是",
  "no": "否",
  "location_type_container": "集装箱",
  "location_type_warehouse": "仓库",
  "location_type_storage": "Storage",
  "location_type_shop": "门店",
  "location_type_shelf": "货架",
  "location_type_other": "其他",
  "user": "用户",
  "last_7_days": "最近7天",
  "last_30_days": "最近30天",
  "this_month": "本月",
  "location": "库位",
  "movements_page_title": "BFC24 CONTROL — 库存流水",
  "writeoff_page_title": "BFC24 CONTROL — 报损",
  "submit_writeoff": "提交报损",
  "new_writeoff": "新报损",
  "location_short": "库位",
  "type_receipt": "入库",
  "type_sale": "销售",
  "type_writeoff": "报损",
  "type_transfer_in": "调拨 +",
  "type_transfer_out": "调拨 -",
  "type_adjustment": "调整",
  "history_title": "流水历史",
  "history_subtitle": "显示仓库业务产生的库存流水。",
  "receipts": "入库数",
  "sales_label": "销售数",
  "writeoffs": "报损数",
  "comment_required_hint": "备注必填。",
  "comment_placeholder": "例如：损坏、破损、错货、丢失"
});


  const __originalTextNodes = new WeakMap();
  const __originalPlaceholders = new WeakMap();
  const __originalTitles = new WeakMap();
  const __originalOptions = new WeakMap();
  let __originalDocumentTitle = null;
  let __observerStarted = false;
  let __observer = null;
  let __observerTimer = null;

  function translateRawText(text) {
    const source = String(text ?? '');
    if (!source) return source;
    const lang = getLang();
    if (lang === 'ru') return source;
    return rawTextMap[source]?.[lang] ?? source;
  }

  function shouldSkipTextNode(node) {
    if (!node || !node.parentNode) return true;
    const tag = String(node.parentNode.nodeName || '').toLowerCase();
    return tag === 'script' || tag === 'style' || tag === 'textarea';
  }

  function applyRawTextTranslations(root) {
    const scope = root || document.body;
    if (!scope) return;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (shouldSkipTextNode(node)) continue;
      const current = node.nodeValue;
      if (!current || !current.trim()) continue;
      if (!__originalTextNodes.has(node)) __originalTextNodes.set(node, current);
      const original = __originalTextNodes.get(node);
      if (!original || !original.trim()) continue;
      const trimmed = original.trim();
      const translated = translateRawText(trimmed);
      if (translated !== trimmed) {
        node.nodeValue = original.replace(trimmed, translated);
      } else {
        node.nodeValue = original;
      }
    }

    scope.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((el) => {
      if (!__originalPlaceholders.has(el)) __originalPlaceholders.set(el, el.getAttribute('placeholder') || '');
      const original = __originalPlaceholders.get(el);
      if (original) el.setAttribute('placeholder', translateRawText(original));
    });

    scope.querySelectorAll('[title]').forEach((el) => {
      if (!__originalTitles.has(el)) __originalTitles.set(el, el.getAttribute('title') || '');
      const original = __originalTitles.get(el);
      if (original) el.setAttribute('title', translateRawText(original));
    });

    scope.querySelectorAll('option').forEach((el) => {
      if (!__originalOptions.has(el)) __originalOptions.set(el, el.textContent || '');
      const original = __originalOptions.get(el);
      if (original) el.textContent = translateRawText(original);
    });

    if (__originalDocumentTitle === null) __originalDocumentTitle = document.title;
    document.title = translateRawText(document.title || __originalDocumentTitle);
  }

  function enableAutoTranslate() {
    if (__observerStarted) return;
    __observerStarted = true;
    const start = () => {
      if (!document.body) return;
      __observer = new MutationObserver(() => {
        clearTimeout(__observerTimer);
        __observerTimer = setTimeout(() => applyTranslations(document.body), 0);
      });
      __observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  function normalizeLang(lang) {
    const value = String(lang || 'ru').toLowerCase();
    if (value.startsWith('zh')) return 'zh';
    if (value.startsWith('en')) return 'en';
    return 'ru';
  }

  function getLang() {
    return normalizeLang(localStorage.getItem(STORAGE_KEY) || 'ru');
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, normalizeLang(lang));
    window.location.reload();
  }

  function t(key) {
    const lang = getLang();
    return dictionaries[lang]?.[key] ?? dictionaries.ru[key] ?? key;
  }

  function applyTranslations(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });

    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      el.innerHTML = t(key);
    });

    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.setAttribute('placeholder', t(key));
    });

    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      el.setAttribute('title', t(key));
    });

    const titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) {
      const key = titleEl.getAttribute('data-i18n');
      document.title = t(key);
    }

    document.documentElement.setAttribute('lang', getLang());
    applyRawTextTranslations(scope);
    enableAutoTranslate();
    document.dispatchEvent(new CustomEvent('app:language-changed', { detail: { lang: getLang() } }));
  }

  function renderLanguageSwitcher(containerId) {
    const container = document.getElementById(containerId || 'langSwitcher');
    if (!container) return;

    const current = getLang();
    container.innerHTML = `
      <button type="button" class="lang-btn ${current === 'ru' ? 'active' : ''}" data-lang="ru">${t('lang_ru')}</button>
      <button type="button" class="lang-btn ${current === 'en' ? 'active' : ''}" data-lang="en">${t('lang_en')}</button>
      <button type="button" class="lang-btn ${current === 'zh' ? 'active' : ''}" data-lang="zh">${t('lang_zh')}</button>
    `;

    container.querySelectorAll('[data-lang]').forEach((btn) => {
      btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang')));
    });
  }

  window.i18n = {
    dictionaries,
    getLang,
    setLang,
    t,
    applyTranslations,
    renderLanguageSwitcher,
    translateRawText,
    enableAutoTranslate
  };
})();