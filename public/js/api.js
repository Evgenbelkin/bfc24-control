window.API = (() => {
  function getToken() {
    return localStorage.getItem("token");
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem("user"));
    } catch {
      return null;
    }
  }

  function getTenantId() {
    const user = getUser();

    if (user && user.tenant_id) {
      return user.tenant_id;
    }

    return 1; // fallback
  }

  function headers() {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + getToken(),
    };
  }

  async function request(method, url, body) {
    const res = await fetch(AppConfig.API_BASE + url, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();

    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      throw new Error(data.error || data.message || "HTTP error");
    }

    return data;
  }

  return {
    get: (url) => request("GET", url),
    post: (url, body) => request("POST", url, body),
    put: (url, body) => request("PUT", url, body),
    patch: (url, body) => request("PATCH", url, body),
    delete: (url) => request("DELETE", url),

    getTenantId,
  };
})();