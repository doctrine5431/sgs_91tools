(function () {
  'use strict';

  const app = window.SGS91Assistant;
  if (!app) throw new Error('SGS91 core must load before game-message service.');
  if (app.getService('gameMessages')) return;

  const subscribers = new Set();
  const recentSignatures = new Map();
  const state = {
    startedAt: new Date().toISOString(),
    messageCount: 0,
    lastMessageAt: '',
    lastMessageType: '',
    lastSource: '',
    consoleHooked: false,
    sgsModuleAccessorHooked: false,
    sgsModuleHooked: false,
    optionalJndHooked: false,
  };

  function normalizeMessageType(type, payload) {
    const text = typeof type === 'string' ? type : '';
    const constructorName = payload?.__ctor || payload?.constructor?.name || '';
    if (constructorName && constructorName !== 'Object' && (!text || /^(logicmsg|cmsg|object)$/i.test(text))) {
      return constructorName;
    }
    const namespaced = text.match(/(?:^|\.)(Msg[A-Za-z0-9]+|[A-Z][A-Za-z0-9]*(?:Ntf|Notify|Motify))$/);
    return namespaced ? namespaced[1] : text;
  }

  function getMessageTypeFromArgs(args) {
    for (const arg of args) {
      if (arg && typeof arg === 'object') {
        const type = arg.type || arg.rawType || arg.msgName || arg.name || arg.__ctor || arg.constructor?.name;
        if (typeof type === 'string' && (/^(Msg|Notify|Ntf|C[A-Z])/.test(type) || /(Ntf|Notify|Motify)$/.test(type))) {
          return type;
        }
      }
      if (typeof arg === 'string') {
        const match = arg.match(/\b(Msg[A-Za-z0-9]+|[A-Z][A-Za-z0-9]*(?:Ntf|Notify|Motify))\b/);
        if (match) return match[1];
      }
    }
    return '';
  }

  function getPayloadFromArgs(args) {
    for (const arg of args) {
      if (!arg || typeof arg !== 'object') continue;
      if (arg.payload && typeof arg.payload === 'object') return arg.payload;
      if (arg.data && typeof arg.data === 'object' && !Array.isArray(arg.data)) return arg.data;
      return arg;
    }
    return {};
  }

  function messageSignature(type, payload) {
    return JSON.stringify({
      type,
      seat: payload?.seat ?? null,
      srcSeat: payload?.srcSeat ?? null,
      ownerSeat: payload?.ownerSeat ?? null,
      currentSeat: payload?.currentSeat ?? null,
      phase: payload?.phase ?? null,
      spellId: payload?.spellId ?? payload?.skillId ?? null,
      id: payload?.id ?? null,
      targets: Array.isArray(payload?.targets) ? payload.targets.slice(0, 8) : null,
      data: Array.isArray(payload?.data) ? payload.data.slice(0, 8) : null,
      spellIds: Array.isArray(payload?.spellIds) ? payload.spellIds.slice(0, 20) : null,
    });
  }

  function publish(source, type, payload = {}, meta = {}) {
    const normalizedType = normalizeMessageType(type, payload);
    if (!normalizedType) return false;
    const signature = messageSignature(normalizedType, payload);
    const now = Date.now();
    const previousAt = recentSignatures.get(signature) || 0;
    if (now - previousAt < 80) return false;
    recentSignatures.set(signature, now);
    if (recentSignatures.size > 120) {
      for (const [key, at] of recentSignatures) {
        if (now - at > 3000) recentSignatures.delete(key);
      }
    }
    state.messageCount += 1;
    state.lastMessageAt = new Date().toISOString();
    state.lastMessageType = normalizedType;
    state.lastSource = String(source || 'unknown');
    for (const listener of Array.from(subscribers)) {
      try { listener(normalizedType, payload || {}, { source: state.lastSource, ...meta }); }
      catch (error) { console.error('[三国杀91助手] 游戏消息处理失败', error); }
    }
    app.emit('game:message', {
      type: normalizedType,
      payload: payload || {},
      source: state.lastSource,
      meta,
    });
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Game message listener must be a function.');
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function extractMessage(args) {
    return {
      type: getMessageTypeFromArgs(args),
      payload: getPayloadFromArgs(args),
    };
  }

  function hookConsoleLog() {
    let original;
    try { original = console.log; } catch { return false; }
    if (original?.__sgs91GameMessagesHooked) {
      state.consoleHooked = true;
      return true;
    }
    function hookedConsoleLog(...args) {
      try {
        const message = extractMessage(args);
        if (message.type) publish('page-console', message.type, message.payload, { direction: 'in' });
      } catch {
      }
      return original.apply(this, args);
    }
    try { Object.defineProperty(hookedConsoleLog, '__sgs91GameMessagesHooked', { value: true }); }
    catch { hookedConsoleLog.__sgs91GameMessagesHooked = true; }
    try {
      Object.defineProperty(console, 'log', {
        configurable: true,
        get() { return hookedConsoleLog; },
        set(value) {
          if (typeof value === 'function' && value !== hookedConsoleLog) original = value;
        },
      });
    } catch {
      console.log = hookedConsoleLog;
    }
    state.consoleHooked = true;
    return true;
  }

  let sgsModuleValue;

  function attachSgsModule() {
    const bus = sgsModuleValue !== undefined ? sgsModuleValue : window.SGSMODULE;
    if (!Array.isArray(bus)) return false;
    if (bus.__sgs91GameMessagesHooked) {
      state.sgsModuleHooked = true;
      return true;
    }
    bus.push(function (...args) {
      const message = extractMessage(args);
      if (message.type) publish('page-sgsmodule', message.type, message.payload, { direction: 'in' });
    });
    try { Object.defineProperty(bus, '__sgs91GameMessagesHooked', { value: true }); }
    catch { bus.__sgs91GameMessagesHooked = true; }
    state.sgsModuleHooked = true;
    return true;
  }

  function hookSgsModule() {
    try { sgsModuleValue = window.SGSMODULE; } catch { sgsModuleValue = undefined; }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'SGSMODULE');
    if (!descriptor || descriptor.configurable) {
      try {
        Object.defineProperty(window, 'SGSMODULE', {
          configurable: true,
          get() { return sgsModuleValue; },
          set(value) {
            sgsModuleValue = value;
            if (Array.isArray(value)) setTimeout(attachSgsModule, 0);
          },
        });
        state.sgsModuleAccessorHooked = true;
      } catch {
      }
    }
    attachSgsModule();
    return state.sgsModuleAccessorHooked || state.sgsModuleHooked;
  }

  function attachOptionalJnd() {
    const jnd = window.__JND;
    if (!jnd || typeof jnd.onMsg !== 'function') return false;
    if (jnd.__sgs91CoreMessagesHooked) {
      state.optionalJndHooked = true;
      return true;
    }
    jnd.onMsg((type, payload) => publish('optional-jnd', type, payload || {}, { direction: 'in' }));
    try { Object.defineProperty(jnd, '__sgs91CoreMessagesHooked', { value: true }); }
    catch { jnd.__sgs91CoreMessagesHooked = true; }
    state.optionalJndHooked = true;
    return true;
  }

  function probe() {
    return {
      ...state,
      subscriberCount: subscribers.size,
      hasSgsModule: Array.isArray(sgsModuleValue),
      externalCompatibilityPresent: Boolean(window.__JND),
    };
  }

  const api = Object.freeze({
    subscribe,
    publish,
    probe,
    normalizeMessageType,
    extractMessage,
  });
  app.registerService('gameMessages', api);

  hookConsoleLog();
  hookSgsModule();
  attachOptionalJnd();
  const hookTimer = setInterval(() => {
    attachSgsModule();
    attachOptionalJnd();
  }, 500);
  setTimeout(() => clearInterval(hookTimer), 180000);
})();
