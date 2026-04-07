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
  }

  window.i18n = {
    getLang,
    setLang,
    t,
    applyTranslations
  };
})();