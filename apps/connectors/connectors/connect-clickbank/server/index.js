// @bun
// ../../../../../../node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || undefined;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
  };
};

// ../../../../../../node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// ../../../../../../node_modules/hono/dist/utils/body.js
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
};
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
var handleParsingAllValues = (form, key, value) => {
  if (form[key] !== undefined) {
    if (Array.isArray(form[key])) {
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
};
var handleParsingNestedValues = (form, key, value) => {
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};

// ../../../../../../node_modules/hono/dist/utils/url.js
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match, index) => {
    const mark = `@${index}`;
    groups.push([mark, match]);
    return mark;
  });
  return { groups, path };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1;i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1;j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*") {
    return "*";
  }
  const match = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match[1], new RegExp(`^${match[2]}(?=/${next})`)] : [label, match[1], new RegExp(`^${match[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
};
var tryDecode = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
      try {
        return decoder(match);
      } catch {
        return match;
      }
    });
  }
};
var tryDecodeURI = (str) => tryDecode(str, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (;i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const path = url.slice(start, queryIndex === -1 ? undefined : queryIndex);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63) {
      break;
    }
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var _decodeURI = (value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
};
var _getQueryParam = (url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? undefined : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(keyIndex + 1, valueIndex === -1 ? nextKeyIndex === -1 ? undefined : nextKeyIndex : valueIndex);
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? undefined : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// ../../../../../../node_modules/hono/dist/request.js
var tryDecodeURIComponent = (str) => tryDecode(str, decodeURIComponent_);
var HonoRequest = class {
  raw;
  #validatedData;
  #matchResult;
  routeIndex = 0;
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== undefined) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? undefined;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return this.bodyCache.parsedBody ??= await parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw[key]();
  };
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  text() {
    return this.#cachedBody("text");
  }
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  blob() {
    return this.#cachedBody("blob");
  }
  formData() {
    return this.#cachedBody("formData");
  }
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  get url() {
    return this.raw.url;
  }
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// ../../../../../../node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then((res) => Promise.all(res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))).then(() => buffer[0]));
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
};

// ../../../../../../node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
};
var Context = class {
  #rawRequest;
  #req;
  env = {};
  #var;
  finalized = false;
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  get res() {
    return this.#res ||= new Response(null, {
      headers: this.#preparedHeaders ??= new Headers
    });
  }
  set res(_res) {
    if (this.#res && _res) {
      _res = new Response(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  setLayout = (layout) => this.#layout = layout;
  getLayout = () => this.#layout;
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  header = (name, value, options) => {
    if (this.finalized) {
      this.#res = new Response(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers;
    if (value === undefined) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map;
    this.#var.set(key, value);
  };
  get = (key) => {
    return this.#var ? this.#var.get(key) : undefined;
  };
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers;
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return new Response(data, { status, headers: responseHeaders });
  }
  newResponse = (...args) => this.#newResponse(...args);
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(text, arg, setDefaultContentType(TEXT_PLAIN, headers));
  };
  json = (object, arg, headers) => {
    return this.#newResponse(JSON.stringify(object), arg, setDefaultContentType("application/json", headers));
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  redirect = (location, status) => {
    const locationString = String(location);
    this.header("Location", !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString));
    return this.newResponse(null, status ?? 302);
  };
  notFound = () => {
    this.#notFoundHandler ??= () => new Response;
    return this.#notFoundHandler(this);
  };
};

// ../../../../../../node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// ../../../../../../node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// ../../../../../../node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
var Hono = class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  router;
  getPath;
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  errorHandler = errorHandler;
  route(path, app) {
    const subApp = this.basePath(path);
    app.routes.map((r) => {
      let handler;
      if (app.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = async (c, next) => (await compose([], app.errorHandler)(c, () => r.handler(c, next))).res;
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = (request) => request;
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = undefined;
      try {
        executionContext = c.executionCtx;
      } catch {}
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    };
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then((resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(new Request(/^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`, requestInit), Env, executionCtx);
  };
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, undefined, event.request.method));
    });
  };
};

// ../../../../../../node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = (method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  };
  this.match = match2;
  return match2(method, path);
}

// ../../../../../../node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node = class _Node {
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== undefined) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some((k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR)) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node;
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some((k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR)) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node;
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// ../../../../../../node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node;
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0;; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1;i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1;j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== undefined) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== undefined) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// ../../../../../../node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(path === "*" ? "" : `^${path.replace(/\/\*$|([.\\+*[^\]$()])/g, (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)")}$`);
}
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie;
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map((route) => [!/\*|\/:/.test(route[0]), ...route]).sort(([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length);
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length;i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (;paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length;i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length;j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length;k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
function findMiddleware(middleware, path) {
  if (!middleware) {
    return;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return;
}
var RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach((p) => re.test(p) && routes[m][p].push([handler, paramCount]));
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length;i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = undefined;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]]));
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// ../../../../../../node_modules/hono/dist/router/reg-exp-router/prepared-router.js
var PreparedRegExpRouter = class {
  name = "PreparedRegExpRouter";
  #matchers;
  #relocateMap;
  constructor(matchers, relocateMap) {
    this.#matchers = matchers;
    this.#relocateMap = relocateMap;
  }
  #addWildcard(method, handlerData) {
    const matcher = this.#matchers[method];
    matcher[1].forEach((list) => list && list.push(handlerData));
    Object.values(matcher[2]).forEach((list) => list[0].push(handlerData));
  }
  #addPath(method, path, handler, indexes, map) {
    const matcher = this.#matchers[method];
    if (!map) {
      matcher[2][path][0].push([handler, {}]);
    } else {
      indexes.forEach((index) => {
        if (typeof index === "number") {
          matcher[1][index].push([handler, map]);
        } else {
          matcher[2][index || path][0].push([handler, map]);
        }
      });
    }
  }
  add(method, path, handler) {
    if (!this.#matchers[method]) {
      const all = this.#matchers[METHOD_NAME_ALL];
      const staticMap = {};
      for (const key in all[2]) {
        staticMap[key] = [all[2][key][0].slice(), emptyParam];
      }
      this.#matchers[method] = [
        all[0],
        all[1].map((list) => Array.isArray(list) ? list.slice() : 0),
        staticMap
      ];
    }
    if (path === "/*" || path === "*") {
      const handlerData = [handler, {}];
      if (method === METHOD_NAME_ALL) {
        for (const m in this.#matchers) {
          this.#addWildcard(m, handlerData);
        }
      } else {
        this.#addWildcard(method, handlerData);
      }
      return;
    }
    const data = this.#relocateMap[path];
    if (!data) {
      throw new Error(`Path ${path} is not registered`);
    }
    for (const [indexes, map] of data) {
      if (method === METHOD_NAME_ALL) {
        for (const m in this.#matchers) {
          this.#addPath(m, path, handler, indexes, map);
        }
      } else {
        this.#addPath(method, path, handler, indexes, map);
      }
    }
  }
  buildAllMatchers() {
    return this.#matchers;
  }
  match = match;
};

// ../../../../../../node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (;i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length;i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = undefined;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// ../../../../../../node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var Node2 = class _Node2 {
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length;i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2;
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #getHandlerSets(node, method, nodeParams, params) {
    const handlerSets = [];
    for (let i = 0, len = node.#methods.length;i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== undefined) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length;i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
    return handlerSets;
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    for (let i = 0, len = parts.length;i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length;j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              handlerSets.push(...this.#getHandlerSets(nextNode.#children["*"], method, node.#params));
            }
            handlerSets.push(...this.#getHandlerSets(nextNode, method, node.#params));
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length;k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              handlerSets.push(...this.#getHandlerSets(astNode, method, node.#params));
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          const restPathString = parts.slice(i).join("/");
          if (matcher instanceof RegExp) {
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              handlerSets.push(...this.#getHandlerSets(child, method, node.#params, params));
              if (Object.keys(child.#children).length) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              handlerSets.push(...this.#getHandlerSets(child, method, params, node.#params));
              if (child.#children["*"]) {
                handlerSets.push(...this.#getHandlerSets(child.#children["*"], method, params, node.#params));
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      curNodes = tempNodes.concat(curNodesQueue.shift() ?? []);
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// ../../../../../../node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2;
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length;i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// ../../../../../../node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter, new TrieRouter]
    });
  }
};

// ../../../../../../node_modules/hono/dist/middleware/cors/index.js
var cors = (options) => {
  const defaults = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: []
  };
  const opts = {
    ...defaults,
    ...options
  };
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return optsAllowMethods;
    } else if (Array.isArray(optsAllowMethods)) {
      return () => optsAllowMethods;
    } else {
      return () => [];
    }
  })(opts.allowMethods);
  return async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposeHeaders?.length) {
      set("Access-Control-Expose-Headers", opts.exposeHeaders.join(","));
    }
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*") {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods.length) {
        set("Access-Control-Allow-Methods", allowMethods.join(","));
      }
      let headers = opts.allowHeaders;
      if (!headers?.length) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headers = requestHeaders.split(/\s*,\s*/);
        }
      }
      if (headers?.length) {
        set("Access-Control-Allow-Headers", headers.join(","));
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*") {
      c.header("Vary", "Origin", { append: true });
    }
  };
};

// ../../../../../../node_modules/hono/dist/utils/color.js
function getColorEnabled() {
  const { process: process2, Deno } = globalThis;
  const isNoColor = typeof Deno?.noColor === "boolean" ? Deno.noColor : process2 !== undefined ? "NO_COLOR" in process2?.env : false;
  return !isNoColor;
}
async function getColorEnabledAsync() {
  const { navigator } = globalThis;
  const cfWorkers = "cloudflare:workers";
  const isNoColor = navigator !== undefined && navigator.userAgent === "Cloudflare-Workers" ? await (async () => {
    try {
      return "NO_COLOR" in ((await import(cfWorkers)).env ?? {});
    } catch {
      return false;
    }
  })() : !getColorEnabled();
  return !isNoColor;
}

// ../../../../../../node_modules/hono/dist/middleware/logger/index.js
var humanize = (times) => {
  const [delimiter, separator] = [",", "."];
  const orderTimes = times.map((v) => v.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + delimiter));
  return orderTimes.join(separator);
};
var time = (start) => {
  const delta = Date.now() - start;
  return humanize([delta < 1000 ? delta + "ms" : Math.round(delta / 1000) + "s"]);
};
var colorStatus = async (status) => {
  const colorEnabled = await getColorEnabledAsync();
  if (colorEnabled) {
    switch (status / 100 | 0) {
      case 5:
        return `\x1B[31m${status}\x1B[0m`;
      case 4:
        return `\x1B[33m${status}\x1B[0m`;
      case 3:
        return `\x1B[36m${status}\x1B[0m`;
      case 2:
        return `\x1B[32m${status}\x1B[0m`;
    }
  }
  return `${status}`;
};
async function log(fn, prefix, method, path, status = 0, elapsed) {
  const out = prefix === "<--" ? `${prefix} ${method} ${path}` : `${prefix} ${method} ${path} ${await colorStatus(status)} ${elapsed}`;
  fn(out);
}
var logger = (fn = console.log) => {
  return async function logger2(c, next) {
    const { method, url } = c.req;
    const path = url.slice(url.indexOf("/", 8));
    await log(fn, "<--", method, path);
    const start = Date.now();
    await next();
    await log(fn, "-->", method, path, c.res.status, time(start));
  };
};

// src/types/index.ts
class ClickBankApiError extends Error {
  statusCode;
  errors;
  constructor(message, statusCode, errors) {
    super(message);
    this.name = "ClickBankApiError";
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// src/api/client.ts
var DEFAULT_BASE_URL = "https://api.clickbank.com/rest/1.3";

class ClickBankClient {
  apiKey;
  baseUrl;
  constructor(config) {
    if (!config.apiKey) {
      throw new Error("API key is required");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }
  buildUrl(path, params) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  }
  getAcceptHeader(format = "json") {
    return format === "xml" ? "application/xml" : "application/json";
  }
  async request(path, options = {}) {
    const { method = "GET", params, body, headers = {}, format = "json" } = options;
    const url = this.buildUrl(path, params);
    const requestHeaders = {
      Authorization: this.apiKey,
      Accept: this.getAcceptHeader(format),
      ...headers
    };
    if (body && (method === "POST" || method === "PUT")) {
      requestHeaders["Content-Type"] = "application/json";
    }
    const fetchOptions = {
      method,
      headers: requestHeaders
    };
    if (body && (method === "POST" || method === "PUT")) {
      fetchOptions.body = JSON.stringify(body);
    }
    const response = await fetch(url, fetchOptions);
    if (method === "HEAD") {
      return {
        active: response.status === 204,
        statusCode: response.status
      };
    }
    if (response.status === 204) {
      return {};
    }
    const hasMore = response.status === 206;
    let data;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    } else if (contentType.includes("application/xml")) {
      data = await response.text();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok && response.status !== 206) {
      const errorMessage = typeof data === "object" && data !== null ? JSON.stringify(data) : String(data || response.statusText);
      throw new ClickBankApiError(errorMessage, response.status);
    }
    if (hasMore && typeof data === "object" && data !== null) {
      data._hasMore = true;
    }
    return data;
  }
  async get(path, params, format) {
    return this.request(path, { method: "GET", params, format });
  }
  async post(path, body, params) {
    return this.request(path, { method: "POST", body, params });
  }
  async put(path, body, params) {
    return this.request(path, { method: "PUT", body, params });
  }
  async delete(path, params) {
    return this.request(path, { method: "DELETE", params });
  }
  async head(path, params) {
    return this.request(path, { method: "HEAD", params });
  }
  getApiKeyPreview() {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return "***";
  }
}

// src/api/orders.ts
class OrdersApi {
  client;
  constructor(client) {
    this.client = client;
  }
  async getSchema() {
    return this.client.get("/orders2/schema", undefined, "xml");
  }
  async getOrder(receipt, sku) {
    const params = sku ? { sku } : undefined;
    const response = await this.client.get(`/orders2/${receipt}`, params);
    const data = response.orderData;
    if (Array.isArray(data) && data[0]) {
      return data[0];
    }
    if (data && !Array.isArray(data)) {
      return data;
    }
    throw new Error("Order not found");
  }
  async getUpsells(receipt) {
    const response = await this.client.get(`/orders2/${receipt}/upsells`);
    if (!response.orderData)
      return [];
    return Array.isArray(response.orderData) ? response.orderData : [response.orderData];
  }
  async count(params) {
    const response = await this.client.get("/orders2/count", params);
    return response.count || 0;
  }
  async list(params) {
    const { page, ...queryParams } = params || {};
    const headers = page ? { page: String(page) } : undefined;
    const response = await this.client.request("/orders2/list", {
      method: "GET",
      params: queryParams,
      headers
    });
    const orders = response.orderData || [];
    return {
      orders: Array.isArray(orders) ? orders : [orders],
      hasMore: !!response._hasMore
    };
  }
  async changeProduct(receipt, params) {
    await this.client.post(`/orders2/${receipt}/changeProduct`, { ...params });
  }
  async changeAddress(receipt, params) {
    await this.client.post(`/orders2/${receipt}/changeAddress`, { ...params });
  }
  async changeDate(receipt, params) {
    await this.client.post(`/orders2/${receipt}/changeDate`, { ...params });
  }
  async extend(receipt, params) {
    await this.client.post(`/orders2/${receipt}/extend`, { ...params });
  }
  async pause(receipt, params) {
    await this.client.post(`/orders2/${receipt}/pause`, { ...params });
  }
  async reinstate(receipt, params) {
    await this.client.post(`/orders2/${receipt}/reinstate`, params);
  }
  async isActive(receipt, sku) {
    const params = sku ? { sku } : undefined;
    const response = await this.client.head(`/orders2/${receipt}`, params);
    return response.active;
  }
}

// src/api/products.ts
class ProductsApi {
  client;
  constructor(client) {
    this.client = client;
  }
  async getSchema() {
    return this.client.get("/products/schema", undefined, "xml");
  }
  async get(sku, site) {
    const response = await this.client.get(`/products/${sku}`, { site });
    const data = response.product;
    if (Array.isArray(data) && data[0]) {
      return data[0];
    }
    if (data && !Array.isArray(data)) {
      return data;
    }
    throw new Error("Product not found");
  }
  async list(params) {
    const response = await this.client.get("/products/list", { ...params });
    const products = response.products || [];
    return Array.isArray(products) ? products : [products];
  }
  async create(params) {
    const { sku, ...body } = params;
    const response = await this.client.put(`/products/${sku}`, body);
    return response.sku || sku;
  }
  async delete(sku, site) {
    await this.client.delete(`/products/${sku}`, { site });
  }
}

// src/api/tickets.ts
class TicketsApi {
  client;
  constructor(client) {
    this.client = client;
  }
  async getSchema() {
    return this.client.get("/tickets/schema", undefined, "xml");
  }
  async getPartialRefundSchema() {
    return this.client.get("/tickets/partialRefundDataSchema", undefined, "xml");
  }
  async get(ticketId) {
    const response = await this.client.get(`/tickets/${ticketId}`);
    return response.ticketData;
  }
  async count(params) {
    const response = await this.client.get("/tickets/count", params);
    return response.count || 0;
  }
  async list(params) {
    const { page, ...queryParams } = params || {};
    const headers = page ? { page: String(page) } : undefined;
    const response = await this.client.request("/tickets/list", {
      method: "GET",
      params: queryParams,
      headers
    });
    const tickets = response.ticketData || [];
    return {
      tickets: Array.isArray(tickets) ? tickets : [tickets],
      hasMore: !!response._hasMore
    };
  }
  async getRefundAmounts(receipt, params) {
    return this.client.get(`/tickets/refundAmounts/${receipt}`, { ...params });
  }
  async create(receipt, params) {
    const response = await this.client.post(`/tickets/${receipt}`, { ...params });
    return response.ticketData;
  }
  async update(ticketId, params) {
    const response = await this.client.put(`/tickets/${ticketId}`, params);
    return response.ticketData;
  }
  async close(ticketId, comment) {
    return this.update(ticketId, { action: "close", comment });
  }
  async reopen(ticketId, comment) {
    return this.update(ticketId, { action: "reopen", comment });
  }
  async addComment(ticketId, comment) {
    return this.update(ticketId, { comment });
  }
  async confirmReturn(ticketId) {
    await this.client.post(`/tickets/${ticketId}/returned`);
  }
  async createRefund(receipt, refundType, reason, options) {
    return this.create(receipt, {
      type: "rfnd",
      reason,
      refundType,
      ...options
    });
  }
  async createCancellation(receipt, reason, options) {
    return this.create(receipt, {
      type: "cncl",
      reason,
      ...options
    });
  }
  async createTechSupport(receipt, reason, comment) {
    return this.create(receipt, {
      type: "tech",
      reason,
      comment
    });
  }
}

// src/api/shipping.ts
class ShippingApi {
  client;
  constructor(client) {
    this.client = client;
  }
  async getSchema() {
    return this.client.get("/shipping2/schema", undefined, "xml");
  }
  async count(params) {
    const response = await this.client.get("/shipping2/count", params);
    return response.count || 0;
  }
  async list(params) {
    const { page, ...queryParams } = params || {};
    const headers = page ? { page: String(page) } : undefined;
    const response = await this.client.request("/shipping2/list", {
      method: "GET",
      params: queryParams,
      headers
    });
    const orders = response.orderShipData || [];
    return {
      orders: Array.isArray(orders) ? orders : [orders],
      hasMore: !!response._hasMore
    };
  }
  async getByReceipt(receipt) {
    const response = await this.list({ receipt });
    return response.orders[0] || null;
  }
  async getUnshipped(params) {
    return this.list({ ...params, status: "notshipped" });
  }
  async getShipped(params) {
    return this.list({ ...params, status: "shipped" });
  }
  async createShipNotice(params) {
    await this.client.post("/shipping2/shipnotice", { ...params });
  }
  async markShipped(receipt, itemNo, trackingId, carrier) {
    await this.createShipNotice({
      receipt,
      itemNo,
      trackingId,
      carrier,
      date: new Date().toISOString().split("T")[0]
    });
  }
}

// src/api/quickstats.ts
class QuickstatsApi {
  client;
  constructor(client) {
    this.client = client;
  }
  async getSchema() {
    return this.client.get("/quickstats/schema", undefined, "xml");
  }
  async getAccounts() {
    const response = await this.client.get("/quickstats/accounts");
    if (!response.account)
      return [];
    return Array.isArray(response.account) ? response.account : [response.account];
  }
  async count(params) {
    return this.client.get("/quickstats/count", params);
  }
  async list(params) {
    const { page, ...queryParams } = params || {};
    const headers = page ? { page: String(page) } : undefined;
    const response = await this.client.request("/quickstats/list", {
      method: "GET",
      params: queryParams,
      headers
    });
    const data = response.quickstatsData || [];
    return {
      data: Array.isArray(data) ? data : [data],
      hasMore: !!response._hasMore
    };
  }
  async getToday(account) {
    const today = new Date().toISOString().split("T")[0];
    return this.count({
      account,
      startDate: today,
      endDate: today
    });
  }
  async getLastDays(days, account) {
    const endDate = new Date;
    const startDate = new Date;
    startDate.setDate(startDate.getDate() - days);
    return this.count({
      account,
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0]
    });
  }
  async getDailyStats(startDate, endDate, account) {
    const result = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const response = await this.list({
        account,
        startDate,
        endDate,
        page
      });
      result.push(...response.data);
      hasMore = response.hasMore;
      page++;
    }
    return result;
  }
}

// src/api/analytics.ts
class AnalyticsApi {
  client;
  constructor(client) {
    this.client = client;
  }
  async getStatus() {
    return this.client.get("/analytics/status");
  }
  async getSubscriptionTrends(params) {
    const { role, ...queryParams } = params;
    const response = await this.client.get(`/analytics/${role.toLowerCase()}/subscription/trends`, queryParams);
    return response.subscriptionTrend || [];
  }
  async getSubscriptionDetails(params) {
    const { role, page, ...queryParams } = params;
    const headers = page ? { page: String(page) } : undefined;
    const response = await this.client.request(`/analytics/${role.toLowerCase()}/subscription/details`, {
      method: "GET",
      params: queryParams,
      headers
    });
    return {
      details: response.subscriptionDetails || [],
      hasMore: !!response._hasMore
    };
  }
  async getSubscriptionStatus(role, account) {
    return this.client.get(`/analytics/${role.toLowerCase()}/subscription/status`, account ? { account } : undefined);
  }
  async getStats(params) {
    const { role, dimension, ...queryParams } = params;
    const response = await this.client.get(`/analytics/${role.toLowerCase()}/${dimension.toLowerCase()}`, queryParams);
    return response.analyticsData || [];
  }
  async getVendorProductStats(account, startDate, endDate) {
    return this.getStats({
      role: "VENDOR",
      dimension: "PRODUCT_SKU",
      account,
      startDate,
      endDate
    });
  }
  async getAffiliateVendorStats(account, startDate, endDate) {
    return this.getStats({
      role: "AFFILIATE",
      dimension: "VENDOR_PRODUCT_SKU",
      account,
      startDate,
      endDate
    });
  }
  async getCountryStats(role, account, startDate, endDate) {
    return this.getStats({
      role,
      dimension: "COUNTRY",
      account,
      startDate,
      endDate
    });
  }
  async getAllSubscriptionDetails(account, status) {
    const result = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const response = await this.getSubscriptionDetails({
        role: "VENDOR",
        account,
        status,
        page
      });
      result.push(...response.details);
      hasMore = response.hasMore;
      page++;
    }
    return result;
  }
  async getSubscriptionDetailsByFilter(filter, params) {
    const { role, page, ...queryParams } = params;
    const headers = page ? { page: String(page) } : undefined;
    const response = await this.client.request(`/analytics/${role.toLowerCase()}/subscription/details/${filter}`, {
      method: "GET",
      params: queryParams,
      headers
    });
    return {
      details: response.subscriptionDetails || [],
      hasMore: !!response._hasMore
    };
  }
  async getCanceledByDateRange(account, startDate, endDate, page) {
    return this.getSubscriptionDetailsByFilter("canceldate", {
      role: "VENDOR",
      account,
      startDate,
      endDate,
      page
    });
  }
  async getCanceledLast60Days(account, page) {
    return this.getSubscriptionDetailsByFilter("cancelsixty", {
      role: "VENDOR",
      account,
      page
    });
  }
  async getCanceledLast30Days(account, page) {
    return this.getSubscriptionDetailsByFilter("cancelthirty", {
      role: "VENDOR",
      account,
      page
    });
  }
  async getCompletingIn60Days(account, page) {
    return this.getSubscriptionDetailsByFilter("compsixty", {
      role: "VENDOR",
      account,
      page
    });
  }
  async getCompletingIn30Days(account, page) {
    return this.getSubscriptionDetailsByFilter("compthirty", {
      role: "VENDOR",
      account,
      page
    });
  }
  async getByNextPaymentDate(account, startDate, endDate, page) {
    return this.getSubscriptionDetailsByFilter("nextpmtdate", {
      role: "VENDOR",
      account,
      startDate,
      endDate,
      page
    });
  }
  async getByStartDate(account, startDate, endDate, page) {
    return this.getSubscriptionDetailsByFilter("startdate", {
      role: "VENDOR",
      account,
      startDate,
      endDate,
      page
    });
  }
  async getBySubscriptionStatus(account, status, page) {
    return this.getSubscriptionDetailsByFilter("status", {
      role: "VENDOR",
      account,
      status,
      page
    });
  }
  async getStatsSummary(params) {
    const { role, dimension, ...queryParams } = params;
    const response = await this.client.get(`/analytics/${role.toLowerCase()}/${dimension.toLowerCase()}/summary`, queryParams);
    return response.analyticsData || [];
  }
  async getVendorProductSummary(account, startDate, endDate) {
    return this.getStatsSummary({
      role: "VENDOR",
      dimension: "PRODUCT_SKU",
      account,
      startDate,
      endDate
    });
  }
  async getSchemas() {
    const [analyticsResult, analyticsStatus, subscriptionDetail, subscriptionTrends, subscriptionDetailRow] = await Promise.all([
      this.client.get("/analytics/schema/AnalyticsResult", undefined, "xml"),
      this.client.get("/analytics/schema/AnalyticsStatus", undefined, "xml"),
      this.client.get("/analytics/schema/SubscriptionDetailResult", undefined, "xml"),
      this.client.get("/analytics/schema/SubscriptionTrendsData", undefined, "xml"),
      this.client.get("/analytics/schema/SubscriptionDetailResultRow", undefined, "xml")
    ]);
    return {
      analyticsResult,
      analyticsStatus,
      subscriptionDetail,
      subscriptionTrends,
      subscriptionDetailRow
    };
  }
}

// src/api/images.ts
class ImagesApi {
  client;
  constructor(client) {
    this.client = client;
  }
  async getSchema() {
    return this.client.get("/images/schema", undefined, "xml");
  }
  async list(params) {
    const { page, ...queryParams } = params;
    const headers = page ? { page: String(page) } : undefined;
    const response = await this.client.request("/images/list", {
      method: "GET",
      params: queryParams,
      headers
    });
    return {
      images: response.imageData || [],
      hasMore: !!response._hasMore
    };
  }
  async getAll(site, approvedOnly, type) {
    const result = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const response = await this.list({ site, approvedOnly, type, page });
      result.push(...response.images);
      hasMore = response.hasMore;
      page++;
    }
    return result;
  }
  async getApproved(site, type) {
    return this.list({ site, approvedOnly: true, type });
  }
  async getProductImages(site, approvedOnly) {
    return this.list({ site, approvedOnly, type: "PRODUCT" });
  }
  async getBannerImages(site, approvedOnly) {
    return this.list({ site, approvedOnly, type: "BANNER" });
  }
  async getCustomBannerImages(site, approvedOnly) {
    return this.list({ site, approvedOnly, type: "CUSTOM_BANNER" });
  }
  async getOrderformImages(site, approvedOnly) {
    return this.list({ site, approvedOnly, type: "CUSTOM_ORDERFORM" });
  }
}

// src/api/index.ts
class ClickBank {
  client;
  orders;
  products;
  tickets;
  shipping;
  quickstats;
  analytics;
  images;
  constructor(config) {
    this.client = new ClickBankClient(config);
    this.orders = new OrdersApi(this.client);
    this.products = new ProductsApi(this.client);
    this.tickets = new TicketsApi(this.client);
    this.shipping = new ShippingApi(this.client);
    this.quickstats = new QuickstatsApi(this.client);
    this.analytics = new AnalyticsApi(this.client);
    this.images = new ImagesApi(this.client);
  }
  static fromEnv() {
    const apiKey = process.env.CLICKBANK_API_KEY;
    if (!apiKey) {
      throw new Error("CLICKBANK_API_KEY environment variable is required");
    }
    return new ClickBank({ apiKey });
  }
  getApiKeyPreview() {
    return this.client.getApiKeyPreview();
  }
}

// src/server/index.ts
var app = new Hono2;
app.use("*", cors());
app.use("*", logger());
function getClient(c) {
  const apiKey = c.req.header("X-ClickBank-API-Key") || process.env.CLICKBANK_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new ClickBank({ apiKey });
}
app.get("/", (c) => {
  return c.json({
    service: "connect-clickbank",
    status: "running",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});
app.get("/health", (c) => {
  return c.json({ status: "healthy" });
});
app.get("/api/orders", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const params = {
      affiliate: c.req.query("affiliate"),
      vendor: c.req.query("vendor"),
      email: c.req.query("email"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      type: c.req.query("type"),
      role: c.req.query("role"),
      page: c.req.query("page") ? parseInt(c.req.query("page")) : undefined
    };
    const result = await client.orders.list(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/orders/count", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const params = {
      affiliate: c.req.query("affiliate"),
      vendor: c.req.query("vendor"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      type: c.req.query("type")
    };
    const count = await client.orders.count(params);
    return c.json({ count });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/orders/:receipt", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const receipt = c.req.param("receipt");
    const sku = c.req.query("sku");
    const order = await client.orders.getOrder(receipt, sku);
    return c.json(order);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/orders/:receipt/upsells", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const receipt = c.req.param("receipt");
    const upsells = await client.orders.getUpsells(receipt);
    return c.json(upsells);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/orders/:receipt/active", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const receipt = c.req.param("receipt");
    const sku = c.req.query("sku");
    const isActive = await client.orders.isActive(receipt, sku);
    return c.json({ active: isActive });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.post("/api/orders/:receipt/pause", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const receipt = c.req.param("receipt");
    const body = await c.req.json();
    await client.orders.pause(receipt, body);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.post("/api/orders/:receipt/reinstate", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const receipt = c.req.param("receipt");
    const body = await c.req.json().catch(() => ({}));
    await client.orders.reinstate(receipt, body);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.post("/api/orders/:receipt/extend", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const receipt = c.req.param("receipt");
    const body = await c.req.json();
    await client.orders.extend(receipt, body);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/products", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const site = c.req.query("site");
    if (!site) {
      return c.json({ error: "site parameter required" }, 400);
    }
    const type = c.req.query("type");
    const products = await client.products.list({ site, type });
    return c.json(products);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/products/:sku", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const sku = c.req.param("sku");
    const site = c.req.query("site");
    if (!site) {
      return c.json({ error: "site parameter required" }, 400);
    }
    const product = await client.products.get(sku, site);
    return c.json(product);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.put("/api/products/:sku", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const sku = c.req.param("sku");
    const body = await c.req.json();
    const result = await client.products.create({ sku, ...body });
    return c.json({ sku: result });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.delete("/api/products/:sku", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const sku = c.req.param("sku");
    const site = c.req.query("site");
    if (!site) {
      return c.json({ error: "site parameter required" }, 400);
    }
    await client.products.delete(sku, site);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/tickets", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const params = {
      receipt: c.req.query("receipt"),
      status: c.req.query("status"),
      type: c.req.query("type"),
      createDateFrom: c.req.query("createDateFrom"),
      createDateTo: c.req.query("createDateTo"),
      page: c.req.query("page") ? parseInt(c.req.query("page")) : undefined
    };
    const result = await client.tickets.list(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/tickets/count", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const params = {
      receipt: c.req.query("receipt"),
      status: c.req.query("status"),
      type: c.req.query("type")
    };
    const count = await client.tickets.count(params);
    return c.json({ count });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/tickets/:ticketId", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const ticketId = c.req.param("ticketId");
    const ticket = await client.tickets.get(ticketId);
    return c.json(ticket);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.post("/api/tickets/:receipt", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const receipt = c.req.param("receipt");
    const body = await c.req.json();
    const ticket = await client.tickets.create(receipt, body);
    return c.json(ticket);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.put("/api/tickets/:ticketId", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const ticketId = c.req.param("ticketId");
    const body = await c.req.json();
    const ticket = await client.tickets.update(ticketId, body);
    return c.json(ticket);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.post("/api/tickets/:ticketId/close", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const ticketId = c.req.param("ticketId");
    const body = await c.req.json().catch(() => ({}));
    const ticket = await client.tickets.close(ticketId, body.comment);
    return c.json(ticket);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.post("/api/tickets/:ticketId/reopen", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const ticketId = c.req.param("ticketId");
    const body = await c.req.json();
    const ticket = await client.tickets.reopen(ticketId, body.comment);
    return c.json(ticket);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/shipping", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const params = {
      status: c.req.query("status"),
      receipt: c.req.query("receipt"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      days: c.req.query("days") ? parseInt(c.req.query("days")) : undefined,
      page: c.req.query("page") ? parseInt(c.req.query("page")) : undefined
    };
    const result = await client.shipping.list(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/shipping/count", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const params = {
      status: c.req.query("status"),
      receipt: c.req.query("receipt"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate")
    };
    const count = await client.shipping.count(params);
    return c.json({ count });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.post("/api/shipping/shipnotice", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const body = await c.req.json();
    await client.shipping.createShipNotice(body);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/quickstats/accounts", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const accounts = await client.quickstats.getAccounts();
    return c.json(accounts);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/quickstats", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const params = {
      account: c.req.query("account"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      page: c.req.query("page") ? parseInt(c.req.query("page")) : undefined
    };
    const result = await client.quickstats.list(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/quickstats/count", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const params = {
      account: c.req.query("account"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate")
    };
    const result = await client.quickstats.count(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/analytics/status", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const status = await client.analytics.getStatus();
    return c.json(status);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/analytics/subscriptions/trends", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const params = {
      role: c.req.query("role") || "VENDOR",
      account: c.req.query("account"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate")
    };
    const trends = await client.analytics.getSubscriptionTrends(params);
    return c.json(trends);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/analytics/subscriptions/details", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const params = {
      role: c.req.query("role") || "VENDOR",
      account: c.req.query("account"),
      status: c.req.query("status"),
      page: c.req.query("page") ? parseInt(c.req.query("page")) : undefined
    };
    const result = await client.analytics.getSubscriptionDetails(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/analytics/stats/:dimension", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const dimension = c.req.param("dimension").toUpperCase();
    const params = {
      role: c.req.query("role") || "VENDOR",
      dimension,
      account: c.req.query("account"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate")
    };
    const stats = await client.analytics.getStats(params);
    return c.json(stats);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/images", async (c) => {
  const client = getClient(c);
  if (!client) {
    return c.json({ error: "API key required" }, 401);
  }
  try {
    const site = c.req.query("site");
    if (!site) {
      return c.json({ error: "site parameter required" }, 400);
    }
    const params = {
      site,
      type: c.req.query("type"),
      approvedOnly: c.req.query("approvedOnly") === "true" ? true : c.req.query("approvedOnly") === "false" ? false : undefined,
      page: c.req.query("page") ? parseInt(c.req.query("page")) : undefined
    };
    const result = await client.images.list(params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
var port = parseInt(process.env.PORT || "3013");
var server_default = {
  port,
  fetch: app.fetch
};
console.log(`connect-clickbank server running on port ${port}`);
export {
  server_default as default
};
