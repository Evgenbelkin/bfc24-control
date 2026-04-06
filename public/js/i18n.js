(function () {
  const translations = {
    ru: {
      app_title: "BFC24 CONTROL",
      login: "Вход",
      username: "Логин",
      password: "Пароль",
      login_button: "Войти",
      loading_user: "Проверка пользователя...",
      main_menu: "Главное меню тестирования системы",
      logout: "Выход",
      logout_desc: "Очистить токен и выйти из системы",
      open_module: "Открыть модуль",

      items: "Товары",
      items_desc: "Справочник товаров",

      locations: "Места хранения",
      locations_desc: "Создание мест хранения",

      clients: "Клиенты",
      clients_desc: "Для продаж и реализаций",

      stock: "Остатки",
      stock_desc: "Все товары, остатки и места хранения",

      movements: "Движения",
      movements_desc: "История движений товара",

      incoming: "Приёмка",
      incoming_desc: "Приёмка товара в выбранное МХ",

      sales: "Продажа",
      sales_desc: "Продажа с выбором МХ и клиента",

      writeoff: "Списание",
      writeoff_desc: "Списание товара с МХ",

      cash: "Деньги",
      cash_desc: "Журнал поступлений и оплат",

      expenses: "Расходы",
      expenses_desc: "Учёт расходов",

      analytics: "Аналитика",
      analytics_desc: "PnL и капитализация",

      debts: "Долги клиентов",
      debts_desc: "Контроль реализаций"
    },

    en: {
      app_title: "BFC24 CONTROL",
      login: "Login",
      username: "Username",
      password: "Password",
      login_button: "Sign in",
      loading_user: "Checking user...",
      main_menu: "Main system menu",
      logout: "Logout",
      logout_desc: "Clear token and exit",
      open_module: "Open module",

      items: "Items",
      items_desc: "Product directory",

      locations: "Locations",
      locations_desc: "Storage locations",

      clients: "Clients",
      clients_desc: "Sales and consignment",

      stock: "Stock",
      stock_desc: "Inventory overview",

      movements: "Movements",
      movements_desc: "Stock movements history",

      incoming: "Receiving",
      incoming_desc: "Receive goods",

      sales: "Sales",
      sales_desc: "Sell items",

      writeoff: "Writeoff",
      writeoff_desc: "Remove items",

      cash: "Cash",
      cash_desc: "Payments journal",

      expenses: "Expenses",
      expenses_desc: "Track expenses",

      analytics: "Analytics",
      analytics_desc: "PnL and stock value",

      debts: "Client debts",
      debts_desc: "Debt tracking"
    },

    zh: {
      app_title: "BFC24 控制系统",
      login: "登录",
      username: "用户名",
      password: "密码",
      login_button: "进入",
      loading_user: "检查用户...",
      main_menu: "系统主菜单",
      logout: "退出",
      logout_desc: "退出系统",
      open_module: "打开模块",

      items: "商品",
      items_desc: "商品目录",

      locations: "库位",
      locations_desc: "仓储位置",

      clients: "客户",
      clients_desc: "销售和客户",

      stock: "库存",
      stock_desc: "库存总览",

      movements: "流水",
      movements_desc: "库存变动记录",

      incoming: "入库",
      incoming_desc: "商品入库",

      sales: "销售",
      sales_desc: "销售商品",

      writeoff: "报废",
      writeoff_desc: "商品报废",

      cash: "资金",
      cash_desc: "资金流水",

      expenses: "支出",
      expenses_desc: "费用管理",

      analytics: "分析",
      analytics_desc: "利润与库存",

      debts: "客户欠款",
      debts_desc: "欠款管理"
    }
  };

  function getLang() {
    return localStorage.getItem("lang") || "ru";
  }

  function setLang(lang) {
    localStorage.setItem("lang", lang);
    location.reload();
  }

  function t(key) {
    const lang = getLang();
    return translations[lang]?.[key] || translations.ru[key] || key;
  }

  function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      el.textContent = t(key);
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      const key = el.getAttribute("data-i18n-placeholder");
      el.placeholder = t(key);
    });
  }

  window.i18n = { t, setLang, applyTranslations };
})();