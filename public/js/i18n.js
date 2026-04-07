(function () {
  const dictionaries = {
    ru: {
      common: {
        appName: "BFC24 CONTROL",
        loadingUser: "Проверка пользователя...",
        languageRu: "RU",
        languageEn: "EN",
        languageZh: "中文",
        loginConnectionError: "Ошибка подключения к серверу",
        userLabel: "Пользователь",
        roleLabel: "Роль",
        companyLabel: "Компания",
        tenantLabel: "tenant_id",
        ownerMode: "режим владельца"
      },

      login: {
        pageTitle: "BFC24 CONTROL — Вход",
        heading: "BFC24 CONTROL",
        usernamePlaceholder: "Логин",
        passwordPlaceholder: "Пароль",
        submit: "Войти"
      },

      index: {
        pageTitle: "BFC24 CONTROL — Главное меню",
        subtitle: "Главное меню тестирования системы",
        openModule: "Открыть модуль",
        itemsTitle: "Товары",
        itemsDesc: "Справочник товаров",
        locationsTitle: "Места хранения",
        locationsDesc: "Создание мест хранения",
        clientsTitle: "Клиенты",
        clientsDesc: "Для продаж и реализаций",
        stockTitle: "Остатки",
        stockDesc: "Все товары, остатки и места хранения",
        movementsTitle: "Движения",
        movementsDesc: "История движений товара",
        incomingTitle: "Приёмка",
        incomingDesc: "Приёмка товара в выбранное МХ",
        salesTitle: "Продажа",
        salesDesc: "Продажа с выбором МХ и клиента",
        writeoffTitle: "Списание",
        writeoffDesc: "Списание товара с МХ",
        cashTitle: "Деньги",
        cashDesc: "Журнал поступлений и оплат",
        expensesTitle: "Расходы",
        expensesDesc: "Учёт аренды, зарплаты, закупки и других расходов",
        analyticsTitle: "Аналитика",
        analyticsDesc: "PnL, капитализация склада и расхождения по остаткам",
        debtsTitle: "Долги клиентов",
        debtsDesc: "Контроль реализаций и погашений",
        logoutTitle: "Выход",
        logoutDesc: "Очистить токен и выйти из системы",
        logoutButton: "Выйти",
        ownerRedirectTitle: "Вы вошли как владелец системы",
        ownerRedirectText: "Для вас используется отдельный кабинет управления SaaS.",
        ownerRedirectButton: "Перейти в кабинет владельца"
      },

      clients: {
        pageTitle: "BFC24 CONTROL — Клиенты",
        heading: "Клиенты",
        backButton: "Назад",
        logoutButton: "Выйти",
        subtitle: "Карточка клиента для продаж, долгов и денежных операций.",
        statsClients: "Клиентов",
        statsTenant: "Tenant ID",
        formCreateTitle: "Создать клиента",
        formEditTitle: "Редактировать клиента #{id}",
        nameLabel: "Имя",
        namePlaceholder: "Например: ИП Иванов",
        phoneLabel: "Телефон",
        phonePlaceholder: "Например: 79991234567",
        commentLabel: "Комментарий",
        commentPlaceholder: "Примечание по клиенту",
        searchLabel: "Поиск",
        searchPlaceholder: "Поиск по имени, телефону, комментарию",
        saveButton: "Сохранить",
        saveChangesButton: "Сохранить изменения",
        cancelEditButton: "Отменить редактирование",
        refreshButton: "Обновить список",
        listTitle: "Список клиентов",
        tableId: "ID",
        tableName: "Имя",
        tablePhone: "Телефон",
        tableComment: "Комментарий",
        tableActive: "Активно",
        tableDate: "Дата",
        tableActions: "Действия",
        editButton: "Редактировать",
        activeYes: "Да",
        activeNo: "Нет",
        loadingData: "Загрузка данных...",
        noData: "Нет данных",
        loadErrorRow: "Ошибка загрузки данных",
        loadingStatus: "Загрузка клиентов...\nTenant ID: {tenantId}",
        loadedStatus: "Данные загружены.\nTenant ID: {tenantId}\nКлиентов: {count}",
        loadErrorStatus: "Ошибка: {error}",
        nameRequired: "Имя обязательно",
        savingCreate: "Создаю клиента...",
        savingUpdate: "Сохраняю изменения клиента #{id}...",
        createdSuccess: "Клиент успешно создан",
        updatedSuccess: "Клиент #{id} успешно обновлён",
        saveErrorStatus: "Ошибка сохранения: {error}"
      },

      locations: {
        pageTitle: "BFC24 CONTROL — Места хранения",
        heading: "Места хранения",
        backButton: "Назад",
        logoutButton: "Выйти",
        subtitle: "Например: Контейнер 1, Контейнер 2, Склад магазина, Витрина.",
        statsLocations: "Мест хранения",
        statsTenant: "Tenant ID",
        formCreateTitle: "Создать место хранения",
        formEditTitle: "Редактировать место хранения #{id}",
        nameLabel: "Название",
        namePlaceholder: "Например: Контейнер 1",
        codeLabel: "Код",
        codePlaceholder: "Например: K1",
        typeLabel: "Тип",
        typeContainer: "Контейнер",
        typeWarehouse: "Склад",
        typeStorage: "Storage",
        typeShop: "Магазин",
        typeShelf: "Полка",
        typeOther: "Другое",
        searchLabel: "Поиск",
        searchPlaceholder: "Поиск по названию, коду, типу",
        saveButton: "Сохранить",
        saveChangesButton: "Сохранить изменения",
        cancelEditButton: "Отменить редактирование",
        refreshButton: "Обновить список",
        listTitle: "Список мест хранения",
        tableId: "ID",
        tableName: "Название",
        tableCode: "Код",
        tableType: "Тип",
        tableActive: "Активно",
        tableDate: "Дата",
        tableActions: "Действия",
        editButton: "Редактировать",
        activeYes: "Да",
        activeNo: "Нет",
        loadingData: "Загрузка данных...",
        noData: "Нет данных",
        loadErrorRow: "Ошибка загрузки данных",
        loadingStatus: "Загрузка мест хранения...\nTenant ID: {tenantId}",
        loadedStatus: "Данные загружены.\nTenant ID: {tenantId}\nМест хранения: {count}",
        loadErrorStatus: "Ошибка: {error}",
        nameRequired: "Название обязательно",
        codeRequired: "Код обязателен",
        typeRequired: "Тип обязателен",
        savingCreate: "Создаю место хранения...",
        savingUpdate: "Сохраняю изменения места хранения #{id}...",
        createdSuccess: "Место хранения успешно создано",
        updatedSuccess: "Место хранения #{id} успешно обновлено",
        saveErrorStatus: "Ошибка сохранения: {error}",
        typeValue: {
          container: "Контейнер",
          warehouse: "Склад",
          storage: "Storage",
          shop: "Магазин",
          shelf: "Полка",
          other: "Другое"
        }
      }
    },

    en: {
      common: {
        appName: "BFC24 CONTROL",
        loadingUser: "Checking user...",
        languageRu: "RU",
        languageEn: "EN",
        languageZh: "中文",
        loginConnectionError: "Unable to connect to the server",
        userLabel: "User",
        roleLabel: "Role",
        companyLabel: "Company",
        tenantLabel: "tenant_id",
        ownerMode: "owner mode"
      },

      login: {
        pageTitle: "BFC24 CONTROL — Login",
        heading: "BFC24 CONTROL",
        usernamePlaceholder: "Username",
        passwordPlaceholder: "Password",
        submit: "Sign in"
      },

      index: {
        pageTitle: "BFC24 CONTROL — Main Menu",
        subtitle: "Main system menu",
        openModule: "Open module",
        itemsTitle: "Items",
        itemsDesc: "Product catalog",
        locationsTitle: "Locations",
        locationsDesc: "Storage locations setup",
        clientsTitle: "Clients",
        clientsDesc: "For sales and consignment",
        stockTitle: "Stock",
        stockDesc: "All items, balances and storage locations",
        movementsTitle: "Movements",
        movementsDesc: "Inventory movement history",
        incomingTitle: "Receiving",
        incomingDesc: "Receive goods into the selected location",
        salesTitle: "Sales",
        salesDesc: "Sales with location and client selection",
        writeoffTitle: "Write-off",
        writeoffDesc: "Write off goods from a location",
        cashTitle: "Cash",
        cashDesc: "Payments and receipts journal",
        expensesTitle: "Expenses",
        expensesDesc: "Track rent, payroll, purchasing and other expenses",
        analyticsTitle: "Analytics",
        analyticsDesc: "PnL, inventory capitalization and stock discrepancies",
        debtsTitle: "Client Debts",
        debtsDesc: "Consignment and repayment control",
        logoutTitle: "Logout",
        logoutDesc: "Clear token and sign out",
        logoutButton: "Sign out",
        ownerRedirectTitle: "You are signed in as the system owner",
        ownerRedirectText: "A separate SaaS management dashboard is used for your account.",
        ownerRedirectButton: "Open owner dashboard"
      },

      clients: {
        pageTitle: "BFC24 CONTROL — Clients",
        heading: "Clients",
        backButton: "Back",
        logoutButton: "Sign out",
        subtitle: "Client card for sales, debts and cash operations.",
        statsClients: "Clients",
        statsTenant: "Tenant ID",
        formCreateTitle: "Create client",
        formEditTitle: "Edit client #{id}",
        nameLabel: "Name",
        namePlaceholder: "For example: Ivanov LLC",
        phoneLabel: "Phone",
        phonePlaceholder: "For example: 79991234567",
        commentLabel: "Comment",
        commentPlaceholder: "Client note",
        searchLabel: "Search",
        searchPlaceholder: "Search by name, phone or comment",
        saveButton: "Save",
        saveChangesButton: "Save changes",
        cancelEditButton: "Cancel editing",
        refreshButton: "Refresh list",
        listTitle: "Clients list",
        tableId: "ID",
        tableName: "Name",
        tablePhone: "Phone",
        tableComment: "Comment",
        tableActive: "Active",
        tableDate: "Date",
        tableActions: "Actions",
        editButton: "Edit",
        activeYes: "Yes",
        activeNo: "No",
        loadingData: "Loading data...",
        noData: "No data",
        loadErrorRow: "Failed to load data",
        loadingStatus: "Loading clients...\nTenant ID: {tenantId}",
        loadedStatus: "Data loaded.\nTenant ID: {tenantId}\nClients: {count}",
        loadErrorStatus: "Error: {error}",
        nameRequired: "Name is required",
        savingCreate: "Creating client...",
        savingUpdate: "Saving changes for client #{id}...",
        createdSuccess: "Client created successfully",
        updatedSuccess: "Client #{id} updated successfully",
        saveErrorStatus: "Save error: {error}"
      },

      locations: {
        pageTitle: "BFC24 CONTROL — Locations",
        heading: "Locations",
        backButton: "Back",
        logoutButton: "Sign out",
        subtitle: "For example: Container 1, Container 2, Store warehouse, Showcase.",
        statsLocations: "Locations",
        statsTenant: "Tenant ID",
        formCreateTitle: "Create location",
        formEditTitle: "Edit location #{id}",
        nameLabel: "Name",
        namePlaceholder: "For example: Container 1",
        codeLabel: "Code",
        codePlaceholder: "For example: K1",
        typeLabel: "Type",
        typeContainer: "Container",
        typeWarehouse: "Warehouse",
        typeStorage: "Storage",
        typeShop: "Shop",
        typeShelf: "Shelf",
        typeOther: "Other",
        searchLabel: "Search",
        searchPlaceholder: "Search by name, code or type",
        saveButton: "Save",
        saveChangesButton: "Save changes",
        cancelEditButton: "Cancel editing",
        refreshButton: "Refresh list",
        listTitle: "Locations list",
        tableId: "ID",
        tableName: "Name",
        tableCode: "Code",
        tableType: "Type",
        tableActive: "Active",
        tableDate: "Date",
        tableActions: "Actions",
        editButton: "Edit",
        activeYes: "Yes",
        activeNo: "No",
        loadingData: "Loading data...",
        noData: "No data",
        loadErrorRow: "Failed to load data",
        loadingStatus: "Loading locations...\nTenant ID: {tenantId}",
        loadedStatus: "Data loaded.\nTenant ID: {tenantId}\nLocations: {count}",
        loadErrorStatus: "Error: {error}",
        nameRequired: "Name is required",
        codeRequired: "Code is required",
        typeRequired: "Type is required",
        savingCreate: "Creating location...",
        savingUpdate: "Saving changes for location #{id}...",
        createdSuccess: "Location created successfully",
        updatedSuccess: "Location #{id} updated successfully",
        saveErrorStatus: "Save error: {error}",
        typeValue: {
          container: "Container",
          warehouse: "Warehouse",
          storage: "Storage",
          shop: "Shop",
          shelf: "Shelf",
          other: "Other"
        }
      }
    },

    zh: {
      common: {
        appName: "BFC24 CONTROL",
        loadingUser: "正在检查用户...",
        languageRu: "RU",
        languageEn: "EN",
        languageZh: "中文",
        loginConnectionError: "无法连接到服务器",
        userLabel: "用户",
        roleLabel: "角色",
        companyLabel: "公司",
        tenantLabel: "tenant_id",
        ownerMode: "所有者模式"
      },

      login: {
        pageTitle: "BFC24 CONTROL — 登录",
        heading: "BFC24 CONTROL",
        usernamePlaceholder: "用户名",
        passwordPlaceholder: "密码",
        submit: "登录"
      },

      index: {
        pageTitle: "BFC24 CONTROL — 主菜单",
        subtitle: "系统主菜单",
        openModule: "打开模块",
        itemsTitle: "商品",
        itemsDesc: "商品目录",
        locationsTitle: "库位",
        locationsDesc: "创建库位",
        clientsTitle: "客户",
        clientsDesc: "用于销售和寄售",
        stockTitle: "库存",
        stockDesc: "所有商品、库存和库位",
        movementsTitle: "流水记录",
        movementsDesc: "商品流转历史",
        incomingTitle: "入库",
        incomingDesc: "商品入库到所选库位",
        salesTitle: "销售",
        salesDesc: "按库位和客户进行销售",
        writeoffTitle: "报损报废",
        writeoffDesc: "从库位中核销商品",
        cashTitle: "资金",
        cashDesc: "收款与付款流水",
        expensesTitle: "支出",
        expensesDesc: "记录租金、工资、采购及其他支出",
        analyticsTitle: "分析",
        analyticsDesc: "利润、库存资本化与库存差异",
        debtsTitle: "客户欠款",
        debtsDesc: "寄售与还款控制",
        logoutTitle: "退出",
        logoutDesc: "清除令牌并退出系统",
        logoutButton: "退出登录",
        ownerRedirectTitle: "您当前以系统所有者身份登录",
        ownerRedirectText: "您的账号使用独立的 SaaS 管理后台。",
        ownerRedirectButton: "进入所有者后台"
      },

      clients: {
        pageTitle: "BFC24 CONTROL — 客户",
        heading: "客户",
        backButton: "返回",
        logoutButton: "退出",
        subtitle: "用于销售、欠款和资金操作的客户资料卡。",
        statsClients: "客户数量",
        statsTenant: "Tenant ID",
        formCreateTitle: "创建客户",
        formEditTitle: "编辑客户 #{id}",
        nameLabel: "名称",
        namePlaceholder: "例如：Ivanov 个体户",
        phoneLabel: "电话",
        phonePlaceholder: "例如：79991234567",
        commentLabel: "备注",
        commentPlaceholder: "客户备注",
        searchLabel: "搜索",
        searchPlaceholder: "按名称、电话或备注搜索",
        saveButton: "保存",
        saveChangesButton: "保存修改",
        cancelEditButton: "取消编辑",
        refreshButton: "刷新列表",
        listTitle: "客户列表",
        tableId: "ID",
        tableName: "名称",
        tablePhone: "电话",
        tableComment: "备注",
        tableActive: "启用",
        tableDate: "日期",
        tableActions: "操作",
        editButton: "编辑",
        activeYes: "是",
        activeNo: "否",
        loadingData: "正在加载数据...",
        noData: "没有数据",
        loadErrorRow: "数据加载错误",
        loadingStatus: "正在加载客户...\nTenant ID: {tenantId}",
        loadedStatus: "数据已加载。\nTenant ID: {tenantId}\n客户数: {count}",
        loadErrorStatus: "错误: {error}",
        nameRequired: "名称为必填项",
        savingCreate: "正在创建客户...",
        savingUpdate: "正在保存客户 #{id} 的修改...",
        createdSuccess: "客户创建成功",
        updatedSuccess: "客户 #{id} 更新成功",
        saveErrorStatus: "保存错误: {error}"
      },

      locations: {
        pageTitle: "BFC24 CONTROL — 库位",
        heading: "库位",
        backButton: "返回",
        logoutButton: "退出",
        subtitle: "例如：Container 1、Container 2、店铺仓库、展示位。",
        statsLocations: "库位数量",
        statsTenant: "Tenant ID",
        formCreateTitle: "创建库位",
        formEditTitle: "编辑库位 #{id}",
        nameLabel: "名称",
        namePlaceholder: "例如：Container 1",
        codeLabel: "代码",
        codePlaceholder: "例如：K1",
        typeLabel: "类型",
        typeContainer: "集装箱",
        typeWarehouse: "仓库",
        typeStorage: "存储区",
        typeShop: "店铺",
        typeShelf: "货架",
        typeOther: "其他",
        searchLabel: "搜索",
        searchPlaceholder: "按名称、代码或类型搜索",
        saveButton: "保存",
        saveChangesButton: "保存修改",
        cancelEditButton: "取消编辑",
        refreshButton: "刷新列表",
        listTitle: "库位列表",
        tableId: "ID",
        tableName: "名称",
        tableCode: "代码",
        tableType: "类型",
        tableActive: "启用",
        tableDate: "日期",
        tableActions: "操作",
        editButton: "编辑",
        activeYes: "是",
        activeNo: "否",
        loadingData: "正在加载数据...",
        noData: "没有数据",
        loadErrorRow: "数据加载错误",
        loadingStatus: "正在加载库位...\nTenant ID: {tenantId}",
        loadedStatus: "数据已加载。\nTenant ID: {tenantId}\n库位数: {count}",
        loadErrorStatus: "错误: {error}",
        nameRequired: "名称为必填项",
        codeRequired: "代码为必填项",
        typeRequired: "类型为必填项",
        savingCreate: "正在创建库位...",
        savingUpdate: "正在保存库位 #{id} 的修改...",
        createdSuccess: "库位创建成功",
        updatedSuccess: "库位 #{id} 更新成功",
        saveErrorStatus: "保存错误: {error}",
        typeValue: {
          container: "集装箱",
          warehouse: "仓库",
          storage: "存储区",
          shop: "店铺",
          shelf: "货架",
          other: "其他"
        }
      }
    }
  };

  const defaultLang = "ru";
  const supported = ["ru", "en", "zh"];

  function normalizeLang(value) {
    const lang = String(value || "").toLowerCase();
    if (supported.includes(lang)) return lang;
    if (lang.startsWith("zh")) return "zh";
    if (lang.startsWith("en")) return "en";
    return defaultLang;
  }

  function getLang() {
    return normalizeLang(localStorage.getItem("lang") || defaultLang);
  }

  function setLang(lang) {
    const normalized = normalizeLang(lang);
    localStorage.setItem("lang", normalized);
    applyTranslations();
    document.dispatchEvent(new CustomEvent("app:language-changed", { detail: { lang: normalized } }));
  }

  function resolveKey(path) {
    const lang = getLang();
    const parts = String(path || "").split(".");

    let value = dictionaries[lang];
    for (const part of parts) value = value?.[part];
    if (value !== undefined) return value;

    value = dictionaries[defaultLang];
    for (const part of parts) value = value?.[part];
    return value !== undefined ? value : path;
  }

  function t(path) {
    return resolveKey(path);
  }

  function format(path, vars) {
    let text = String(resolveKey(path) ?? path);
    const data = vars || {};
    Object.keys(data).forEach((key) => {
      const pattern = new RegExp("\\{" + key + "\\}", "g");
      text = text.replace(pattern, String(data[key]));
    });
    return text;
  }

  function applyTranslations(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      el.textContent = t(key);
    });

    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      el.innerHTML = t(key);
    });

    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      el.setAttribute("placeholder", t(key));
    });

    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      el.setAttribute("title", t(key));
    });

    root.querySelectorAll("[data-lang]").forEach((el) => {
      const code = normalizeLang(el.getAttribute("data-lang"));
      el.classList.toggle("active", code === getLang());
    });

    const titleKey = document.documentElement.getAttribute("data-page-title-i18n");
    if (titleKey) document.title = t(titleKey);

    document.documentElement.setAttribute("lang", getLang());
  }

  function renderLanguageSwitcher(target) {
    const container = typeof target === "string" ? document.getElementById(target) : target;
    if (!container) return;

    container.innerHTML = `
      <button type="button" data-lang="ru">${t("common.languageRu")}</button>
      <button type="button" data-lang="en">${t("common.languageEn")}</button>
      <button type="button" data-lang="zh">${t("common.languageZh")}</button>
    `;

    container.querySelectorAll("[data-lang]").forEach((button) => {
      button.addEventListener("click", () => {
        setLang(button.getAttribute("data-lang"));
      });
    });

    applyTranslations(container);
  }

  window.i18n = {
    getLang,
    setLang,
    t,
    format,
    applyTranslations,
    renderLanguageSwitcher
  };
})();