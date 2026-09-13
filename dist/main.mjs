// src/shared/redact.ts
var KEY_PATTERNS = [
  /sk-or-v1-[A-Za-z0-9_-]+/g,
  /sk-or-[A-Za-z0-9_-]+/g,
  /Bearer\s+\S+/gi
];
function redactSecrets(value) {
  let next = value;
  for (const pattern of KEY_PATTERNS) {
    next = next.replace(pattern, "[redacted]");
  }
  return next;
}

// src/shared/types.ts
var ACTIVITY_URL = "https://openrouter.ai/api/v1/activity";
var SECRET_KEY = "openrouter.managementKey";
var SETTINGS_PERIOD_KEY = "period";
var STORAGE_CACHE_KEY = "activity.cache.v1";
var DEFAULT_CACHE_TTL_MS = 60 * 60 * 1e3;
var DEFAULT_FETCH_TIMEOUT_MS = 1e4;
var PLUGIN_STORAGE_VALUE_MAX_BYTES = 256 * 1024;
var PANEL_MESSAGE_MAX_BYTES = 64 * 1024;
var PANEL_RESULT_SOFT_MAX_BYTES = 48 * 1024;
var METHOD_NAMES = [
  "connection.status",
  "connection.save",
  "connection.remove",
  "usage.query",
  "preferences.update"
];
var ZERO_TOTALS = {
  usage: 0,
  byokUsageInference: 0,
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0
};

// src/shared/methods.ts
function isMethodName(value) {
  return typeof value === "string" && METHOD_NAMES.includes(value);
}
function parsePeriod(value) {
  return value === 7 || value === 30 ? value : null;
}
function parseQueryRequest(params) {
  if (params == null) return {};
  if (typeof params !== "object" || Array.isArray(params)) {
    return { error: "params must be an object" };
  }
  const record = params;
  const extra = Object.keys(record).filter((key) => key !== "period" && key !== "forceRefresh");
  if (extra.length > 0) return { error: `unexpected fields: ${extra.join(", ")}` };
  const request = {};
  if ("period" in record) {
    const period = parsePeriod(record.period);
    if (!period) return { error: "period must be 7 or 30" };
    request.period = period;
  }
  if ("forceRefresh" in record) {
    if (typeof record.forceRefresh !== "boolean") return { error: "forceRefresh must be boolean" };
    request.forceRefresh = record.forceRefresh;
  }
  return request;
}
function parseSaveConnectionRequest(params) {
  if (typeof params !== "object" || params == null || Array.isArray(params)) {
    return { error: "params must be an object" };
  }
  const record = params;
  if (typeof record.apiKey !== "string") return { error: "apiKey must be a string" };
  const apiKey = record.apiKey.trim();
  if (apiKey.length < 8 || apiKey.length > 16 * 1024) {
    return { error: "apiKey length is invalid" };
  }
  return { apiKey };
}
function parsePreferencesUpdate(params) {
  if (typeof params !== "object" || params == null || Array.isArray(params)) {
    return { error: "params must be an object" };
  }
  const record = params;
  const extra = Object.keys(record).filter((key) => key !== "period");
  if (extra.length > 0) return { error: `unexpected fields: ${extra.join(", ")}` };
  if (!("period" in record)) return {};
  const period = parsePeriod(record.period);
  if (!period) return { error: "period must be 7 or 30" };
  return { period };
}

// src/shared/bytes.ts
function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}
function jsonUtf8Bytes(value) {
  return utf8Bytes(JSON.stringify(value));
}

// src/shared/utc.ts
var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}
function isUtcDateString(value) {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}
function parseActivityDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const day = trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
  if (!isUtcDateString(day)) return null;
  if (trimmed.length > 10) {
    const rest = trimmed.slice(10);
    if (!/^([ T]00:00:00(\.0+)?(Z)?)?$/.test(rest)) return null;
  }
  return day;
}
function addUtcDays(dateStr, days) {
  if (!isUtcDateString(dateStr)) {
    throw new Error(`invalid UTC date: ${dateStr}`);
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  return utcDateString(new Date(Date.UTC(year, month - 1, day + days)));
}
function compareUtcDate(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function enumerateUtcDates(start, end) {
  if (compareUtcDate(start, end) > 0) return [];
  const dates = [];
  let cursor = start;
  while (compareUtcDate(cursor, end) <= 0) {
    dates.push(cursor);
    cursor = addUtcDays(cursor, 1);
  }
  return dates;
}
function completedUtcWindow(now, days) {
  const today = utcDateString(now);
  const end = addUtcDays(today, -1);
  const start = addUtcDays(today, -days);
  return { start, end, dates: enumerateUtcDates(start, end) };
}
function dateInInclusiveRange(date, start, end) {
  return compareUtcDate(date, start) >= 0 && compareUtcDate(date, end) <= 0;
}

// src/worker/aggregate.ts
function addTotals(a, b) {
  return {
    usage: a.usage + b.usage,
    byokUsageInference: a.byokUsageInference + b.byokUsageInference,
    requests: a.requests + b.requests,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens
  };
}
function totalsFromItem(item) {
  return {
    usage: item.usage,
    byokUsageInference: item.byokUsageInference,
    requests: item.requests,
    promptTokens: item.promptTokens,
    completionTokens: item.completionTokens,
    reasoningTokens: item.reasoningTokens
  };
}
function modelKey(item) {
  return `${item.model}\0${item.modelPermaslug}`;
}
function providerKey(item) {
  return `${item.providerName}\0${item.endpointId}`;
}
function aggregateActivity(items, period, now, fetchedAt, cache, stale) {
  const window = completedUtcWindow(now, period);
  const inWindow = items.filter((item) => dateInInclusiveRange(item.date, window.start, window.end));
  const dailyMap = /* @__PURE__ */ new Map();
  for (const date of window.dates) dailyMap.set(date, { ...ZERO_TOTALS });
  const models = /* @__PURE__ */ new Map();
  let totals = { ...ZERO_TOTALS };
  for (const item of inWindow) {
    const piece = totalsFromItem(item);
    totals = addTotals(totals, piece);
    dailyMap.set(item.date, addTotals(dailyMap.get(item.date) ?? { ...ZERO_TOTALS }, piece));
    const mk = modelKey(item);
    let model = models.get(mk);
    if (!model) {
      model = {
        model: item.model,
        modelPermaslug: item.modelPermaslug,
        totals: { ...ZERO_TOTALS },
        providers: /* @__PURE__ */ new Map()
      };
      models.set(mk, model);
    }
    model.totals = addTotals(model.totals, piece);
    const pk = providerKey(item);
    const existing = model.providers.get(pk);
    if (existing) {
      existing.totals = addTotals(existing.totals, piece);
    } else {
      model.providers.set(pk, {
        providerName: item.providerName,
        endpointId: item.endpointId,
        totals: piece
      });
    }
  }
  const daily = window.dates.map((date) => ({
    date,
    totals: dailyMap.get(date) ?? { ...ZERO_TOTALS }
  }));
  const modelBuckets = [...models.values()].map((model) => ({
    model: model.model,
    modelPermaslug: model.modelPermaslug,
    totals: model.totals,
    providers: [...model.providers.values()].sort((a, b) => b.totals.usage - a.totals.usage)
  })).sort((a, b) => b.totals.usage - a.totals.usage || a.model.localeCompare(b.model));
  return trimSnapshot({
    period,
    fetchedAt: fetchedAt.toISOString(),
    dataStartDate: window.start,
    dataEndDate: window.end,
    stale,
    cache,
    totals,
    daily,
    models: modelBuckets,
    modelsTruncated: false,
    empty: inWindow.length === 0
  });
}
function trimSnapshot(snapshot, maxBytes = PANEL_RESULT_SOFT_MAX_BYTES) {
  let models = snapshot.models;
  let truncated = snapshot.modelsTruncated;
  while (models.length > 1 && jsonUtf8Bytes({ ...snapshot, models }) > maxBytes) {
    models = models.slice(0, Math.max(1, models.length - 1));
    truncated = true;
  }
  return { ...snapshot, models, modelsTruncated: truncated };
}

// src/worker/cache.ts
var ActivityCache = class {
  constructor(store, ttlMs = DEFAULT_CACHE_TTL_MS, now = Date.now) {
    this.store = store;
    this.ttlMs = ttlMs;
    this.now = now;
  }
  generation = 0;
  memory = null;
  inflight = /* @__PURE__ */ new Map();
  bumpGeneration() {
    this.generation += 1;
    this.memory = null;
    this.inflight.clear();
  }
  isFresh(entry, fingerprint, filterKey) {
    return entry.fingerprint === fingerprint && entry.filterKey === filterKey && utcDateString(new Date(entry.fetchedAt)) === utcDateString(new Date(this.now())) && this.now() - entry.fetchedAt <= this.ttlMs;
  }
  isUsable(entry, fingerprint, filterKey) {
    return entry.fingerprint === fingerprint && entry.filterKey === filterKey;
  }
  async loadPersisted() {
    const value = await this.store.storageGet(STORAGE_CACHE_KEY);
    if (!value || typeof value !== "object") return null;
    const record = value;
    if (typeof record.fingerprint !== "string" || typeof record.filterKey !== "string" || typeof record.fetchedAt !== "number" || !Array.isArray(record.items)) {
      return null;
    }
    return record;
  }
  async persist(entry) {
    if (jsonUtf8Bytes(entry) > PLUGIN_STORAGE_VALUE_MAX_BYTES) {
      return false;
    }
    try {
      await this.store.storageSet(STORAGE_CACHE_KEY, entry);
      return true;
    } catch {
      return false;
    }
  }
  async clearPersisted() {
    await this.store.storageDelete(STORAGE_CACHE_KEY);
  }
  remember(entry) {
    this.memory = entry;
  }
  async dedupe(key, run) {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    let settle;
    let fail2;
    const pending = new Promise((resolve, reject) => {
      settle = resolve;
      fail2 = reject;
    });
    this.inflight.set(key, pending);
    run().then(settle, fail2).finally(() => {
      if (this.inflight.get(key) === pending) this.inflight.delete(key);
    });
    return pending;
  }
};
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// src/worker/openrouter.ts
var MAX_ACTIVITY_BODY_BYTES = 2 * 1024 * 1024;
function pluginError(code, message, extra = {}) {
  return {
    code,
    message: redactSecrets(message),
    retryable: extra.retryable ?? false,
    retryAfterMs: extra.retryAfterMs
  };
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isNonNegativeNumber(value) {
  return isFiniteNumber(value) && value >= 0;
}
function isNonNegativeInt(value) {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}
function parseActivityItem(raw) {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return null;
  const row = raw;
  const date = parseActivityDate(row.date);
  if (!date) return null;
  if (!isNonEmptyString(row.model)) return null;
  if (!isNonEmptyString(row.model_permaslug)) return null;
  if (!isNonEmptyString(row.endpoint_id)) return null;
  if (!isNonEmptyString(row.provider_name)) return null;
  if (!isNonNegativeNumber(row.usage)) return null;
  if (!isNonNegativeNumber(row.byok_usage_inference)) return null;
  if (!isNonNegativeInt(row.requests)) return null;
  if (!isNonNegativeInt(row.prompt_tokens)) return null;
  if (!isNonNegativeInt(row.completion_tokens)) return null;
  if (!isNonNegativeInt(row.reasoning_tokens)) return null;
  return {
    date,
    model: row.model,
    modelPermaslug: row.model_permaslug,
    endpointId: row.endpoint_id,
    providerName: row.provider_name,
    usage: row.usage,
    byokUsageInference: row.byok_usage_inference,
    requests: row.requests,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens
  };
}
function parseActivityResponse(body) {
  if (typeof body !== "object" || body == null || Array.isArray(body)) return null;
  const data = body.data;
  if (!Array.isArray(data)) return null;
  const items = [];
  for (const row of data) {
    const item = parseActivityItem(row);
    if (!item) return null;
    items.push(item);
  }
  return items;
}
function parseRetryAfter(header, now) {
  if (!header) return void 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1e3, 15 * 60 * 1e3);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - now, 15 * 60 * 1e3));
  return void 0;
}
function mapStatus(status, retryAfterMs) {
  if (status === 401) {
    return pluginError("auth_failed", "Authentication failed. Check the management key.");
  }
  if (status === 403) {
    return pluginError(
      "forbidden",
      "OpenRouter rejected this key for Activity. A management key is required."
    );
  }
  if (status === 429) {
    return pluginError("rate_limited", "OpenRouter rate-limited the request.", {
      retryable: true,
      retryAfterMs
    });
  }
  if (status >= 500) {
    return pluginError("network", `OpenRouter returned HTTP ${status}.`, { retryable: true });
  }
  return pluginError("invalid_response", `OpenRouter returned HTTP ${status}.`);
}
async function fetchActivity(options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(ACTIVITY_URL, {
      method: "GET",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        accept: "application/json"
      },
      redirect: "error",
      signal: controller.signal
    });
    const retryAfterMs = parseRetryAfter(
      response.headers.get("retry-after"),
      (options.now ?? Date.now)()
    );
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.byteLength > MAX_ACTIVITY_BODY_BYTES) {
      return { ok: false, error: pluginError("invalid_response", "Activity response exceeded size limit.") };
    }
    if (!response.ok) {
      return { ok: false, error: mapStatus(response.status, retryAfterMs) };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      return { ok: false, error: pluginError("invalid_response", "Activity response was not JSON.") };
    }
    const items = parseActivityResponse(parsed);
    if (!items) {
      return {
        ok: false,
        error: pluginError("invalid_response", "Activity response failed validation.")
      };
    }
    return { ok: true, items };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: pluginError("timeout", "OpenRouter request timed out.", { retryable: true }) };
    }
    const message = error instanceof Error ? error.message : "network error";
    return {
      ok: false,
      error: pluginError("network", redactSecrets(message), { retryable: true })
    };
  } finally {
    clearTimeout(timeout);
  }
}

// src/worker/service.ts
function fail(error, snapshot) {
  return snapshot ? { ok: false, error, snapshot } : { ok: false, error };
}
function ok(value) {
  return { ok: true, value };
}
var UsageService = class {
  constructor(options) {
    this.options = options;
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.cache = new ActivityCache(options.store, options.ttlMs, () => this.now().getTime());
  }
  cache;
  now;
  timeoutMs;
  async dispatch(method, params) {
    switch (method) {
      case "connection.status":
        return ok(await this.connectionStatus());
      case "connection.save":
        return this.saveConnection(params);
      case "connection.remove":
        return this.removeConnection();
      case "usage.query":
        return this.query(params);
      case "preferences.update":
        return this.updatePreferences(params);
    }
  }
  async connectionStatus() {
    const key = await this.options.store.secretsGet(SECRET_KEY);
    return { connected: typeof key === "string" && key.length > 0 };
  }
  async saveConnection(params) {
    const parsed = parseSaveConnectionRequest(params);
    if ("error" in parsed) {
      return fail({ code: "invalid_params", message: parsed.error, retryable: false });
    }
    const generation = this.cache.generation;
    const fetched = await fetchActivity({
      apiKey: parsed.apiKey,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.options.fetchImpl,
      now: () => this.now().getTime()
    });
    if (generation !== this.cache.generation) {
      return fail({ code: "discarded", message: "Connection changed during verification.", retryable: true });
    }
    if (!fetched.ok) return fail(fetched.error);
    try {
      await this.options.store.secretsSet(SECRET_KEY, parsed.apiKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to store secret";
      return fail({
        code: "unavailable",
        message: redactSecrets(message),
        retryable: false
      });
    }
    if (generation !== this.cache.generation) {
      const current = await this.options.store.secretsGet(SECRET_KEY);
      if (current === parsed.apiKey) await this.options.store.secretsDelete(SECRET_KEY);
      return fail({ code: "discarded", message: "Connection changed during verification.", retryable: true });
    }
    this.cache.bumpGeneration();
    await this.cache.clearPersisted();
    const fingerprint = await sha256Hex(parsed.apiKey);
    const entry = {
      fingerprint,
      filterKey: "account",
      fetchedAt: this.now().getTime(),
      items: fetched.items
    };
    this.cache.remember(entry);
    await this.cache.persist(entry);
    this.options.store.log("management key verified and stored");
    return ok({ connected: true });
  }
  async removeConnection() {
    this.cache.bumpGeneration();
    await this.options.store.secretsDelete(SECRET_KEY);
    await this.cache.clearPersisted();
    return ok({ connected: false });
  }
  async updatePreferences(params) {
    const parsed = parsePreferencesUpdate(params);
    if ("error" in parsed) {
      return fail({ code: "invalid_params", message: parsed.error, retryable: false });
    }
    const period = parsed.period ?? await this.readPeriod();
    await this.options.store.settingsSet(SETTINGS_PERIOD_KEY, period);
    return ok({ period });
  }
  async query(params) {
    const parsed = parseQueryRequest(params);
    if ("error" in parsed) {
      return fail({ code: "invalid_params", message: parsed.error, retryable: false });
    }
    const period = parsed.period ?? await this.readPeriod();
    const forceRefresh = parsed.forceRefresh === true;
    const filterKey = "account";
    if (!forceRefresh && this.cache.memory && this.cache.isFresh(this.cache.memory, this.cache.memory.fingerprint, filterKey)) {
      return ok(this.snapshotFromCache(this.cache.memory, period, "fresh", false));
    }
    return this.cache.dedupe(`account:${this.cache.generation}:${period}`, async () => {
      const apiKey = await this.options.store.secretsGet(SECRET_KEY);
      if (!apiKey) {
        return fail({
          code: "not_connected",
          message: "No management key is stored.",
          retryable: false
        });
      }
      const fingerprint = await sha256Hex(apiKey);
      if (!forceRefresh) {
        const cached = await this.resolveCached(fingerprint, filterKey);
        if (cached && this.cache.isFresh(cached, fingerprint, filterKey)) {
          return ok(this.snapshotFromCache(cached, period, "fresh", false));
        }
      }
      const generation = this.cache.generation;
      const fetched = await fetchActivity({
        apiKey,
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
        now: () => this.now().getTime()
      });
      if (generation !== this.cache.generation) {
        return fail({
          code: "discarded",
          message: "A newer connection replaced this request.",
          retryable: true
        });
      }
      if (!fetched.ok) {
        const previous = await this.resolveCached(fingerprint, filterKey);
        const snapshot = previous ? this.snapshotFromCache(previous, period, "stale", true) : void 0;
        return fail(fetched.error, snapshot);
      }
      const entry = {
        fingerprint,
        filterKey,
        fetchedAt: this.now().getTime(),
        items: fetched.items
      };
      this.cache.remember(entry);
      await this.cache.persist(entry);
      return ok(this.snapshotFromCache(entry, period, "fresh", false));
    });
  }
  async resolveCached(fingerprint, filterKey) {
    if (this.cache.memory && this.cache.isUsable(this.cache.memory, fingerprint, filterKey)) {
      return this.cache.memory;
    }
    const persisted = await this.cache.loadPersisted();
    if (persisted && this.cache.isUsable(persisted, fingerprint, filterKey)) {
      this.cache.remember(persisted);
      return persisted;
    }
    return null;
  }
  snapshotFromCache(entry, period, cache, stale) {
    return aggregateActivity(entry.items, period, this.now(), new Date(entry.fetchedAt), cache, stale);
  }
  async readPeriod() {
    const settings = await this.options.store.settingsGet();
    return parsePeriod(settings[SETTINGS_PERIOD_KEY]) ?? 7;
  }
  async hydrateFromStorage(apiKey) {
    if (!apiKey) return;
    const persisted = await this.cache.loadPersisted();
    if (!persisted) return;
    const fingerprint = await sha256Hex(apiKey);
    if (this.cache.isUsable(persisted, fingerprint, persisted.filterKey)) {
      this.cache.remember(persisted);
    }
  }
};
function formatNotificationSummary(snapshot) {
  const usage = snapshot.totals.usage.toFixed(4);
  return `UTC ${snapshot.dataStartDate}\u2013${snapshot.dataEndDate}: $${usage}, ${snapshot.totals.requests} requests`;
}

// src/worker/store.ts
function createOrcaStore(orca) {
  return {
    async secretsGet(key) {
      const result = await orca.host.call("secrets.get", { key });
      return result.value;
    },
    async secretsSet(key, value) {
      await orca.host.call("secrets.set", { key, value });
    },
    async secretsDelete(key) {
      await orca.host.call("secrets.delete", { key });
    },
    async storageGet(key) {
      const result = await orca.host.call("storage.get", { key });
      return result.value;
    },
    async storageSet(key, value) {
      await orca.host.call("storage.set", { key, value });
    },
    async storageDelete(key) {
      await orca.host.call("storage.delete", { key });
    },
    async settingsGet() {
      const result = await orca.host.call("settings.get", {});
      return result.settings ?? {};
    },
    async settingsSet(key, value) {
      await orca.host.call("settings.set", { key, value });
    },
    async notify(title, body) {
      await orca.host.call("notifications.show", { title, body });
    },
    log(message) {
      orca.log(message);
    }
  };
}

// src/worker/main.ts
function notificationBody(result) {
  if (result.ok) return formatNotificationSummary(result.value);
  const suffix = result.snapshot ? ` Last data: ${formatNotificationSummary(result.snapshot)}.` : "";
  return `${result.error.message}${suffix}`;
}
async function activate(orca) {
  const store = createOrcaStore(orca);
  const service = new UsageService({
    store,
    fetchImpl: globalThis.fetch.bind(globalThis)
  });
  const existing = await store.secretsGet(SECRET_KEY);
  await service.hydrateFromStorage(existing);
  const dispatch = (method, params) => service.dispatch(method, params);
  orca.commands.register("openrouter.status", async () => {
    const status = await service.connectionStatus();
    await store.notify?.(
      "OpenRouter Usage",
      status.connected ? "Management key is stored." : "No management key is stored."
    );
    return status;
  });
  orca.commands.register("openrouter.refresh", async () => {
    const result = await service.query({ forceRefresh: true });
    await store.notify?.("OpenRouter Usage", notificationBody(result));
    return result.ok ? {
      ok: true,
      period: result.value.period,
      totals: result.value.totals,
      dataEndDate: result.value.dataEndDate,
      empty: result.value.empty
    } : { ok: false, code: result.error.code, message: result.error.message };
  });
  orca.commands.register("openrouter.disconnect", async () => {
    const result = await service.removeConnection();
    await store.notify?.("OpenRouter Usage", "Disconnected. Cached activity was cleared.");
    return result.ok ? result.value : { ok: false, code: result.error.code };
  });
  if (orca.requests && typeof orca.requests.register === "function") {
    const register = (method) => {
      orca.requests.register(method, (params) => dispatch(method, params));
    };
    register("connection.status");
    register("connection.save");
    register("connection.remove");
    register("usage.query");
    register("preferences.update");
  } else {
    orca.log("panel request API is not present on this Orca host");
  }
}
function createStandaloneDispatcher(service) {
  return async (method, params) => {
    if (!isMethodName(method)) {
      return {
        ok: false,
        error: { code: "unknown_method", message: redactSecrets(`unknown method: ${method}`), retryable: false }
      };
    }
    return service.dispatch(method, params);
  };
}
export {
  createStandaloneDispatcher,
  activate as default
};
