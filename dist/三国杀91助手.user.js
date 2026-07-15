// ==UserScript==
// @name         三国杀91助手
// @namespace    https://github.com/doctrine5431
// @version      0.3.0
// @description  多武将只读对局助手：提供技能状态、目标与手牌提示，并支持手牌花色排序。
// @author       FAWEI
// @license      MIT
// @homepageURL  https://github.com/doctrine5431/sgs_91tools
// @supportURL   https://github.com/doctrine5431/sgs_91tools/issues
// @updateURL    https://github.com/doctrine5431/sgs_91tools/releases/latest/download/sgs91-assistant.user.js
// @downloadURL  https://github.com/doctrine5431/sgs_91tools/releases/latest/download/sgs91-assistant.user.js
// @match        https://web.sanguosha.com/*
// @match        https://*.sanguosha.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function (sgs91PageWindow) {
  'use strict';

  // Tampermonkey/Violentmonkey 会把 GM 菜单 API 放在隔离环境中。
  // 所有游戏读取与显示逻辑必须显式使用真实页面 window，才能访问 Laya 和游戏消息。
  const window = sgs91PageWindow;
  const document = sgs91PageWindow.document;
  const location = sgs91PageWindow.location;
  const navigator = sgs91PageWindow.navigator;
  const console = sgs91PageWindow.console || globalThis.console;
  const CustomEvent = sgs91PageWindow.CustomEvent || globalThis.CustomEvent;

// ---- src/core/00-registry.user.js ----
(function () {
  'use strict';

  if (window.SGS91Assistant) return;

  const modules = new Map();
  const services = new Map();
  const listeners = new Map();
  const allowedModuleTypes = new Set(['hero', 'feature', 'integration']);

  function requiredText(value, field) {
    const text = String(value || '').trim();
    if (!text) throw new TypeError(`Module ${field} is required.`);
    return text;
  }

  function toFrozenArray(value) {
    return Object.freeze(Array.isArray(value) ? value.slice() : []);
  }

  function registerModule(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new TypeError('Module definition must be an object.');
    }
    const id = requiredText(definition.id, 'id');
    const type = requiredText(definition.type, 'type');
    if (!allowedModuleTypes.has(type)) throw new TypeError(`Unsupported module type: ${type}`);
    if (modules.has(id)) throw new Error(`Duplicate module id: ${id}`);

    const record = Object.freeze({
      id,
      type,
      name: requiredText(definition.name, 'name'),
      version: requiredText(definition.version, 'version'),
      description: String(definition.description || '').trim(),
      capabilities: toFrozenArray(definition.capabilities),
      characterIds: toFrozenArray(definition.characterIds),
      skillIds: toFrozenArray(definition.skillIds),
      api: definition.api || Object.freeze({}),
    });
    modules.set(id, record);
    emit('module:registered', record);
    return record;
  }

  function getModule(id) {
    return modules.get(String(id)) || null;
  }

  function listModules(type) {
    const items = Array.from(modules.values());
    return type ? items.filter((item) => item.type === type) : items;
  }

  function registerService(name, service) {
    const id = requiredText(name, 'service name');
    if (!service || (typeof service !== 'object' && typeof service !== 'function')) {
      throw new TypeError(`Service ${id} must be an object or function.`);
    }
    if (services.has(id)) throw new Error(`Duplicate service: ${id}`);
    services.set(id, service);
    return service;
  }

  function getService(name) {
    return services.get(String(name)) || null;
  }

  function on(eventName, listener) {
    const name = requiredText(eventName, 'event name');
    if (typeof listener !== 'function') throw new TypeError('Event listener must be a function.');
    const group = listeners.get(name) || new Set();
    group.add(listener);
    listeners.set(name, group);
    return () => group.delete(listener);
  }

  function emit(eventName, payload) {
    const group = listeners.get(String(eventName));
    if (!group) return;
    for (const listener of Array.from(group)) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[三国杀91助手] 事件处理失败：${eventName}`, error);
      }
    }
  }

  window.SGS91Assistant = Object.freeze({
    name: '三国杀91助手',
    version: '0.3.0',
    registerModule,
    getModule,
    listModules,
    registerService,
    getService,
    on,
    emit,
  });
})();

// ---- src/core/10-game-scene.user.js ----
(function () {
  'use strict';

  const app = window.SGS91Assistant;
  if (!app) throw new Error('SGS91 core must load before game-scene service.');

  const GAME_SCENES = Object.freeze([
    'TableGameScene', 'HeroBattle1v1GameScene', 'ShenWuZaiShiGameScene',
    'RogueLikeGameScene', 'RogueLike1v1GameScene', 'PointRace2V2GameScene',
    'ZhuGongShaGameScene', 'GuanDuZhiZhanGameScene', 'ShiDianYanLuoGameScene',
    'HuLaoGuanGameScene', 'ChallengeMatchFigureGameScene', 'ChallengeMatch2v2GameScene',
    'GuideFiveFigureGameScene', 'GuideHappyGameScene', 'NewBieForceTrainGameScene',
    'NewBieForceGameScene', 'QMBZGameScene', 'LZHZGameScene', 'ShenZhiShiLianGameScene',
    'QianLiDJGameScene', 'DouDiZhuGameScene', 'GuideGameScene', 'New1v1GameScene',
    'TSGameScene', 'XzcbpGameScene', 'PaiWeiGameScene', 'GuoGameScene',
    'ChallengeMatchDouDiZhuGameScene', 'ChallengeMatchCountryGameScene',
    'OfflineMatch2V2GameScene', 'DouDiZhu2023GameScene', 'ObDDZGameScene',
    'ObGamePractice2v2Scene', 'ObGameScene'
  ]);

  function findInScene(target, ...path) {
    if (!target) return null;
    const single = (items) => Array.isArray(items) && items.length === 1 ? items[0] : items;

    function getChildren(object, name) {
      if (name in object) return object[name];
      if (!Array.isArray(object._children)) return [];
      const found = object._children.filter((child) =>
        child && (child.name === name || (child.constructor && child.constructor.name === name))
      );
      return found.length ? single(found) : [];
    }

    let current = target;
    for (const name of path) {
      if (!current || typeof current !== 'object') return null;
      current = Array.isArray(current)
        ? (current.length ? current.flatMap((item) => getChildren(item, name)) : [])
        : getChildren(current, name);
      if (Array.isArray(current)) current = single(current);
    }
    return current && (Array.isArray(current) ? (current.length ? single(current) : null) : current) || null;
  }

  function getGameScene() {
    const stage = window.Laya && window.Laya.stage;
    const sceneLayer = findInScene(stage, 'SceneLayer');
    if (!sceneLayer) return null;
    for (const name of GAME_SCENES) {
      const scene = findInScene(sceneLayer, name);
      if (scene) return scene;
    }
    return null;
  }

  function getSelfSeatUi() {
    return findInScene(getGameScene(), 'SelfSeatUi');
  }

  function getCardContainer() {
    const container = findInScene(getSelfSeatUi(), 'cardContainer');
    return container && Array.isArray(container.cardUis) ? container : null;
  }

  app.registerService('gameScene', Object.freeze({
    GAME_SCENES,
    findInScene,
    getGameScene,
    getSelfSeatUi,
    getCardContainer,
  }));
})();

// ---- src/core/20-game-message-bus.user.js ----
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

// ---- src/core/25-notice-overlay.user.js ----
(function () {
  'use strict';

  const app = window.SGS91Assistant;
  if (!app) throw new Error('SGS91 core must load before notice-overlay service.');
  if (app.getService('noticeOverlay')) return;

  const rendered = new Map();
  const STYLE = Object.freeze({
    resourceKey: 'gameActionBg',
    fallbackWidth: 640,
    fallbackHeight: 50,
    privateWidthFactor: 1.3,
    publicWidthFactor: 1.1,
    maxWidthFactor: 1.5,
    privateAutoWidthPaddingRatio: 0.05,
    publicAutoWidthPaddingRatio: 0.1,
    gradientColor: '#0d0d0d',
    gradientStripCount: 128,
    gradientStops: Object.freeze([
      Object.freeze({ pos: 0, alpha: 0 }),
      Object.freeze({ pos: 0.16, alpha: 0.56 }),
      Object.freeze({ pos: 0.84, alpha: 0.56 }),
      Object.freeze({ pos: 1, alpha: 0 }),
    ]),
    noticeBaseY: 314,
    groupOffsetY: -6,
    privateOffsetY: 35,
    privateDefaultDy: 200,
    actionPromptGap: 36,
    font: 'FZBW',
    fontSize: 24,
    fzbwOffsetY: 1.5,
    textColor: '#f6de9c',
    zOrder: 99999,
  });
  let feed = null;
  let feedParent = null;

  function findLayaObject(root, predicate, maxObjects = 5000) {
    if (!root || typeof predicate !== 'function') return null;
    const queue = [root];
    const seen = new Set();
    while (queue.length && seen.size < maxObjects) {
      const object = queue.shift();
      if (!object || typeof object !== 'object' || seen.has(object)) continue;
      seen.add(object);
      try { if (predicate(object)) return object; } catch {}
      if (Array.isArray(object._children)) queue.push(...object._children);
    }
    return null;
  }

  function findSurface() {
    const stage = window.Laya?.stage;
    const scene = findLayaObject(stage, (object) => Boolean(
      object?.gameActionTipContainer && typeof object.gameActionTipContainer.addChild === 'function'
    ));
    return scene ? { scene, layer: scene.gameActionTipContainer } : null;
  }

  function readNodeText(node) {
    try {
      return String(node?.text ?? node?._text ?? node?.htmlText ?? '').replace(/\s+/g, '');
    } catch {
      return '';
    }
  }

  function isVisibleWithin(node, ancestor) {
    let current = node;
    while (current && current !== ancestor) {
      if (current.visible === false || Number(current.alpha) === 0) return false;
      current = current.parent;
    }
    return current === ancestor;
  }

  function nodeTopWithin(node, ancestor) {
    try {
      if (typeof node?.localToGlobal === 'function' && typeof ancestor?.globalToLocal === 'function') {
        const Point = window.Laya?.Point;
        const origin = Point ? new Point(0, 0) : { x: 0, y: 0 };
        const globalPoint = node.localToGlobal(origin);
        const localPoint = ancestor.globalToLocal(globalPoint);
        if (Number.isFinite(Number(localPoint?.y))) return Number(localPoint.y);
      }
    } catch {}

    let y = 0;
    let current = node;
    while (current && current !== ancestor) {
      const scaleY = Number.isFinite(Number(current.scaleY)) ? Number(current.scaleY) : 1;
      y = (Number(current.y) || 0) + y * scaleY;
      current = current.parent;
    }
    return current === ancestor && Number.isFinite(y) ? y : null;
  }

  function findActionPromptY(layer) {
    const candidates = [];
    const queue = [...(layer?._children || [])];
    const seen = new Set();
    while (queue.length && seen.size < 2000) {
      const node = queue.shift();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      if (node.name === 'sgs91-notice-feed') continue;
      const text = readNodeText(node);
      if ((text.includes('请选择') && text.includes('卡牌'))
        || (text.includes('出牌阶段') && text.includes('选择'))) {
        const y = isVisibleWithin(node, layer) ? nodeTopWithin(node, layer) : null;
        if (Number.isFinite(y)) candidates.push(y);
      }
      if (Array.isArray(node._children)) queue.push(...node._children);
    }
    return candidates.length ? Math.min(...candidates) : null;
  }

  function getBannerResource() {
    try {
      return window.RES?.GetRes?.(STYLE.resourceKey)
        || window.Laya?.loader?.getRes?.(STYLE.resourceKey)
        || window.Laya?.Loader?.getRes?.(STYLE.resourceKey)
        || null;
    } catch {
      return null;
    }
  }

  function ensureFeed(layer) {
    const Laya = window.Laya;
    if (!layer || !Laya?.Sprite || typeof layer.addChild !== 'function') return null;
    if (feed && feedParent === layer && feed.parent === layer) return feed;
    try { feed?.removeSelf?.(); } catch {}
    feed = new Laya.Sprite();
    feed.name = 'sgs91-notice-feed';
    feed.zOrder = STYLE.zOrder;
    feed.mouseEnabled = false;
    layer.addChild(feed);
    feedParent = layer;
    return feed;
  }

  function normalizeParts(options) {
    if (Array.isArray(options?.parts) && options.parts.length) return options.parts.map((part) => ({
      text: String(part?.text ?? ''),
      font: part?.font || STYLE.font,
      size: Number(part?.size) || STYLE.fontSize,
      color: part?.color || STYLE.textColor,
      offsetY: Number.isFinite(Number(part?.offsetY)) ? Number(part.offsetY) : STYLE.fzbwOffsetY,
    }));
    return [{
      text: String(options?.text || ''),
      font: STYLE.font,
      size: STYLE.fontSize,
      color: STYLE.textColor,
      offsetY: STYLE.fzbwOffsetY,
    }];
  }

  function createText(part) {
    const label = new window.Laya.Text();
    label.text = part.text;
    label.font = part.font;
    label.fontSize = part.size;
    label.color = part.color;
    label.valign = 'middle';
    label.mouseEnabled = false;
    return label;
  }

  function measuredWidth(label) {
    const direct = Math.ceil(Number(label?.textWidth) || 0);
    if (direct > 0) return direct;
    return Math.ceil(Array.from(String(label?.text || '')).reduce((sum, character) => (
      sum + (/^[\x00-\xff]$/.test(character) ? Number(label.fontSize) * 0.58 : Number(label.fontSize))
    ), 0));
  }

  function gradientAlpha(position) {
    const stops = STYLE.gradientStops;
    if (position <= stops[0].pos) return stops[0].alpha;
    for (let index = 1; index < stops.length; index += 1) {
      const right = stops[index];
      if (position > right.pos) continue;
      const left = stops[index - 1];
      let ratio = right.pos > left.pos ? (position - left.pos) / (right.pos - left.pos) : 0;
      ratio = ratio * ratio * (3 - 2 * ratio);
      return left.alpha + (right.alpha - left.alpha) * ratio;
    }
    return stops[stops.length - 1].alpha;
  }

  function drawGradient(row, width, height) {
    const Sprite = window.Laya.Sprite;
    for (let index = 0; index < STYLE.gradientStripCount; index += 1) {
      const left = Math.round(index * width / STYLE.gradientStripCount);
      const right = Math.round((index + 1) * width / STYLE.gradientStripCount);
      if (right <= left) continue;
      const strip = new Sprite();
      strip.name = 'sgs91-notice-gradient-strip';
      strip.size(right - left, height);
      strip.pos(left, 0);
      strip.graphics.drawRect(0, 0, right - left, height, STYLE.gradientColor);
      strip.alpha = Math.max(0, Math.min(1, gradientAlpha((index + 0.5) / STYLE.gradientStripCount)));
      strip.mouseEnabled = false;
      row.addChild(strip);
    }
  }

  function clear(key) {
    const id = String(key || '');
    const item = rendered.get(id);
    try { item?.row?.removeSelf?.(); } catch {}
    try { item?.row?.destroy?.(true); } catch {}
    rendered.delete(id);
    return true;
  }

  function show(key, options = {}) {
    if (!key || !options?.text) return false;
    const Laya = window.Laya;
    const surface = findSurface();
    if (!Laya?.Sprite || !Laya?.Text || !surface) return false;
    clear(key);

    const lane = options.lane === 'private' ? 'private' : 'public';
    const resource = getBannerResource();
    const baseWidth = Math.round(Number(resource?.width) || STYLE.fallbackWidth);
    const height = Math.round(Number(resource?.height) || STYLE.fallbackHeight);
    const parts = normalizeParts(options);
    const labels = parts.map(createText);
    const widths = labels.map(measuredWidth);
    const textWidth = widths.reduce((sum, width) => sum + width, 0);
    const widthFactor = lane === 'private' ? STYLE.privateWidthFactor : STYLE.publicWidthFactor;
    const paddingRatio = lane === 'private'
      ? STYLE.privateAutoWidthPaddingRatio : STYLE.publicAutoWidthPaddingRatio;
    const width = Math.min(
      Math.round(baseWidth * STYLE.maxWidthFactor),
      Math.max(Math.round(baseWidth * widthFactor), Math.ceil(textWidth * (1 + paddingRatio * 2))),
    );
    const sceneWidth = Number(surface.scene?.width) || Number(Laya.stage?.width) || 1600;
    const dx = Number(options.dx) || 0;
    const dy = lane === 'private'
      ? (Number.isFinite(Number(options.dy)) ? Number(options.dy) : STYLE.privateDefaultDy)
      : (Number(options.dy) || 0);
    const noticeBaseY = (Number.isFinite(Number(options.noticeBaseY))
      ? Number(options.noticeBaseY)
      : STYLE.noticeBaseY);
    const normalBaseY = noticeBaseY + dy + (lane === 'private' ? STYLE.privateOffsetY : 0);
    const promptY = options.anchor === 'before-action-prompt'
      ? findActionPromptY(surface.layer)
      : null;
    const promptGap = Number.isFinite(Number(options.anchorGap))
      ? Number(options.anchorGap)
      : STYLE.actionPromptGap;
    const baseY = Number.isFinite(promptY)
      ? Math.round(promptY - height - promptGap)
      : options.anchor === 'notice-base' ? noticeBaseY : normalBaseY;

    const row = new Laya.Sprite();
    row.name = `sgs91-notice-overlay-${String(key).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    row.zOrder = STYLE.zOrder;
    row.mouseEnabled = false;
    row.size(width, height);
    row.pos(Math.round((sceneWidth - width) / 2) + dx, baseY);
    drawGradient(row, width, height);

    const content = new Laya.Sprite();
    content.name = 'sgs91-notice-content';
    content.size(width, height);
    content.mouseEnabled = false;
    let x = Math.round((width - textWidth) / 2);
    labels.forEach((label, index) => {
      label.pos(x, Math.round((height - label.fontSize) / 2) + parts[index].offsetY);
      content.addChild(label);
      x += widths[index];
    });
    row.addChild(content);
    const parent = ensureFeed(surface.layer);
    if (!parent) return false;
    parent.addChild(row);
    rendered.set(String(key), { row, lane, text: String(options.text), width, height });
    return true;
  }

  app.registerService('noticeOverlay', Object.freeze({
    show,
    clear,
    findSurface,
    style: STYLE,
    probe() {
      return Array.from(rendered.entries()).map(([key, value]) => ({
        key,
        lane: value.lane,
        text: value.text,
        width: value.width,
        height: value.height,
        x: value.row?.x,
        y: value.row?.y,
      }));
    },
  }));
})();

// ---- src/core/30-seat-overlay.user.js ----
(function () {
  'use strict';

  const app = window.SGS91Assistant;
  if (!app) throw new Error('SGS91 core must load before seat-overlay service.');
  if (app.getService('seatOverlay')) return;

  const rendered = new Map();
  const STRIP_STYLE = Object.freeze({
    imageUrl: 'https://web.sanguosha.com/10/pc/res/assets/game/yjcmSeat.webp?v=ca8060a813',
    frame: Object.freeze({ x: 972, y: 825, width: 175, height: 23 }),
    x: 7,
    y: 28,
    textDy: 2,
    font: 'FZBW',
    fontSize: 16,
    color: 'rgb(242, 217, 87)',
  });
  let stripTexture = null;
  let textureLoadStarted = false;

  function isRealSeat(value) {
    const seat = Number(value);
    return Number.isFinite(seat) && seat >= 0 && seat < 12;
  }

  function findLayaObject(root, predicate, maxObjects = 3200) {
    if (!root || typeof predicate !== 'function') return null;
    const queue = [root];
    const seen = new Set();
    while (queue.length && seen.size < maxObjects) {
      const object = queue.shift();
      if (!object || typeof object !== 'object' || seen.has(object)) continue;
      seen.add(object);
      try { if (predicate(object)) return object; } catch {}
      if (Array.isArray(object._children)) queue.push(...object._children);
    }
    return null;
  }

  function findGameManager() {
    const stage = window.Laya?.stage;
    if (!stage) return null;
    return findLayaObject(stage, (object) => {
      if (object.gameManager?.Seats || object.gameManager?.seats) return true;
      return Boolean((object.Seats || object.seats) && (
        object.selfSeatIndex != null || object.SelfSeatIndex != null || object.selfSeat != null
      ));
    })?.gameManager || findLayaObject(stage, (object) => Boolean(
      (object.Seats || object.seats) && (
        object.selfSeatIndex != null || object.SelfSeatIndex != null || object.selfSeat != null
      )
    ));
  }

  function readSeatObject(manager, seat) {
    const seats = manager?.Seats || manager?.seats;
    if (!seats || !isRealSeat(seat)) return null;
    try { return seats[seat] || seats.getNumberKey?.(Number(seat)) || null; }
    catch { return null; }
  }

  function findSeatAvatar(seat) {
    const object = readSeatObject(findGameManager(), seat);
    const direct = object?.SeatUI?.seatAvatar || object?.seatUI?.seatAvatar
      || object?.SeatUI?.avatar || object?.seatUI?.avatar
      || object?.seatAvatar || object?.avatar;
    if (direct && typeof direct.localToGlobal === 'function') return direct;
    const stage = window.Laya?.stage;
    return findLayaObject(stage, (candidate) => {
      const candidateSeat = Number(candidate?.seat ?? candidate?.seatId ?? candidate?.SeatId ?? candidate?.userSeat);
      const name = String(candidate?.name || candidate?.constructor?.name || '');
      return candidateSeat === Number(seat)
        && /avatar|seat/i.test(name)
        && typeof candidate.localToGlobal === 'function';
    }, 1800);
  }

  function findSeatLayer() {
    const stage = window.Laya?.stage;
    return findLayaObject(stage, (object) => {
      const name = String(object?.name || object?.constructor?.name || '');
      return /seatComboSprite|seatComboLayer|seatLayer/i.test(name)
        && typeof object.globalToLocal === 'function'
        && typeof object.addChild === 'function';
    }, 1800) || stage;
  }

  function safeDomId(key) {
    return `sgs91-seat-overlay-${String(key).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  function textureSource(resource) {
    return resource?.bitmap || resource?._bitmap || resource?.source || resource || null;
  }

  function getCachedResource() {
    const Laya = window.Laya;
    const plainUrl = STRIP_STYLE.imageUrl.split('?')[0];
    for (const url of [STRIP_STYLE.imageUrl, plainUrl]) {
      try {
        const resource = Laya?.loader?.getRes?.(url) || Laya?.Loader?.getRes?.(url);
        if (resource) return resource;
      } catch {}
    }
    return null;
  }

  function createStripTexture() {
    if (stripTexture) return stripTexture;
    const Laya = window.Laya;
    const source = textureSource(getCachedResource());
    if (!source || !Laya?.Texture?.create) return null;
    const frame = STRIP_STYLE.frame;
    try {
      stripTexture = Laya.Texture.create(
        source,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        0,
        0,
        frame.width,
        frame.height,
      ) || null;
    } catch {
      stripTexture = null;
    }
    return stripTexture;
  }

  function redrawAfterTextureLoad() {
    stripTexture = null;
    const rows = Array.from(rendered.entries()).map(([key, value]) => ({
      key,
      seat: value.seat,
      text: value.text,
      options: value.options || {},
    }));
    rows.forEach((row) => show(row.key, row.seat, row.text, row.options));
  }

  function preloadStripTexture() {
    if (createStripTexture() || textureLoadStarted) return;
    const Laya = window.Laya;
    if (!Laya?.loader?.load) return;
    textureLoadStarted = true;
    try {
      const complete = Laya.Handler?.create
        ? Laya.Handler.create(null, redrawAfterTextureLoad)
        : redrawAfterTextureLoad;
      Laya.loader.load(STRIP_STYLE.imageUrl, complete, null, Laya.Loader?.IMAGE);
    } catch {
      textureLoadStarted = false;
    }
  }

  function fittedFontSize(text, requested, options, width) {
    let size = Math.max(10, Number(requested) || STRIP_STYLE.fontSize);
    if (options.fitText !== true) return size;
    const minimum = Math.max(8, Number(options.minFontSize) || 12);
    const padding = Math.max(0, Number(options.textPaddingX) || 0);
    const available = Math.max(1, width - padding * 2 - 2);
    const estimatedUnits = Array.from(String(text)).reduce((sum, character) => (
      sum + (/\s/.test(character) ? 0.35 : /[\x00-\xff]/.test(character) ? 0.62 : 1)
    ), 0);
    while (size > minimum && estimatedUnits * size > available) size -= 1;
    return size;
  }

  function clear(key) {
    const id = String(key);
    const item = rendered.get(id);
    if (item?.node) {
      try { item.node.removeSelf?.(); } catch {}
      try { item.node.remove?.(); } catch {}
    }
    document.getElementById(safeDomId(id))?.remove();
    rendered.delete(id);
    return true;
  }

  function renderLaya(key, seat, text, options) {
    const Laya = window.Laya;
    const avatar = findSeatAvatar(seat);
    const layer = findSeatLayer();
    if (!Laya?.Sprite || !Laya?.Text || !Laya?.Point || !avatar || !layer
      || typeof avatar.localToGlobal !== 'function' || typeof layer.globalToLocal !== 'function'
      || typeof layer.addChild !== 'function') return false;
    try {
      const texture = createStripTexture();
      if (!texture) preloadStripTexture();
      const width = Number(texture?.width) || STRIP_STYLE.frame.width;
      const height = Number(texture?.height) || STRIP_STYLE.frame.height;
      const fontSize = fittedFontSize(text, options.fontSize, options, width);
      const center = avatar.localToGlobal(new Laya.Point(
        (avatar.width || 0) / 2,
        (avatar.height || 0) / 2,
      ), true);
      const local = layer.globalToLocal(new Laya.Point(center.x, center.y), true);
      const strip = new Laya.Sprite();
      strip.name = `sgs91-seat-overlay-${key}`;
      strip.zOrder = Number(options.zOrder) || 99999;
      strip.size(width, height);
      strip.pos(
        Math.round(local.x - width / 2 + (Number(options.x) || STRIP_STYLE.x)),
        Math.round(local.y - height / 2 + (Number(options.y) || STRIP_STYLE.y)),
      );
      if (texture && typeof strip.graphics.drawTexture === 'function') {
        strip.graphics.drawTexture(texture, 0, 0, width, height);
      } else {
        try { strip.graphics.drawRect(0, 0, width, height, options.background || '#2b2b2b', options.borderColor || '#a78649', 1); }
        catch { strip.graphics.drawRect(0, 0, width, height, options.background || '#2b2b2b'); }
      }
      const label = new Laya.Text();
      label.text = String(text);
      label.font = options.font || STRIP_STYLE.font;
      label.fontSize = fontSize;
      label.bold = options.bold !== false;
      label.color = options.color || STRIP_STYLE.color;
      label.align = 'center';
      label.valign = 'middle';
      const padding = Math.max(0, Number(options.textPaddingX) || 0);
      label.width = Math.max(1, width - padding * 2);
      label.height = height;
      label.pos?.(padding, Number(options.textDy) || STRIP_STYLE.textDy);
      strip.addChild(label);
      layer.addChild(strip);
      rendered.set(String(key), {
        mode: 'laya', node: strip, seat: Number(seat), text: String(text), options: { ...options },
      });
      return true;
    } catch {
      return false;
    }
  }

  function avatarClientPoint(avatar) {
    const Laya = window.Laya;
    if (!Laya?.Point || !avatar || typeof avatar.localToGlobal !== 'function') return null;
    try {
      const point = avatar.localToGlobal(new Laya.Point(
        (avatar.width || 0) / 2,
        (avatar.height || 0) / 2,
      ), true);
      const canvas = Laya.stage?.canvas || Laya.stage?._canvas;
      const rect = canvas?.getBoundingClientRect?.();
      if (rect && Laya.stage?.width && Laya.stage?.height) {
        return {
          x: rect.left + point.x * rect.width / Laya.stage.width,
          y: rect.top + point.y * rect.height / Laya.stage.height,
        };
      }
      return { x: point.x, y: point.y };
    } catch {
      return null;
    }
  }

  function renderDom(key, seat, text, options) {
    if (!document.body) return false;
    const point = avatarClientPoint(findSeatAvatar(seat));
    if (!point) return false;
    const element = document.createElement('div');
    element.id = safeDomId(key);
    element.textContent = String(text);
    const width = STRIP_STYLE.frame.width;
    const height = STRIP_STYLE.frame.height;
    const fontSize = fittedFontSize(text, options.fontSize, options, width);
    Object.assign(element.style, {
      position: 'fixed',
      left: `${Math.round(point.x - width / 2 + (Number(options.x) || STRIP_STYLE.x))}px`,
      top: `${Math.round(point.y - height / 2 + (Number(options.y) || STRIP_STYLE.y))}px`,
      zIndex: String(options.zOrder || 99999),
      width: `${width}px`,
      height: `${height}px`,
      boxSizing: 'border-box',
      padding: `${Number(options.textDy) || STRIP_STYLE.textDy}px ${Math.max(0, Number(options.textPaddingX) || 0)}px 0`,
      border: '0',
      borderRadius: '0',
      background: options.background || 'rgba(43, 43, 43, .94)',
      backgroundImage: `url("${STRIP_STYLE.imageUrl}")`,
      backgroundPosition: `-${STRIP_STYLE.frame.x}px -${STRIP_STYLE.frame.y}px`,
      backgroundRepeat: 'no-repeat',
      color: options.color || STRIP_STYLE.color,
      font: `${options.bold === false ? '400' : '700'} ${fontSize}px/${height}px ${options.font || STRIP_STYLE.font}, sans-serif`,
      textAlign: 'center',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      overflow: 'hidden',
    });
    document.body.appendChild(element);
    rendered.set(String(key), {
      mode: 'dom', node: element, seat: Number(seat), text: String(text), options: { ...options },
    });
    return true;
  }

  function show(key, seat, text, options = {}) {
    if (!key || !isRealSeat(seat) || !text) return false;
    clear(key);
    return renderLaya(String(key), Number(seat), String(text), options)
      || renderDom(String(key), Number(seat), String(text), options);
  }

  function clearPrefix(prefix) {
    for (const key of Array.from(rendered.keys())) {
      if (key.startsWith(String(prefix))) clear(key);
    }
  }

  app.registerService('seatOverlay', Object.freeze({
    show,
    clear,
    clearPrefix,
    findGameManager,
    readSeatObject,
    findSeatAvatar,
    style: STRIP_STYLE,
    probe() {
      return Array.from(rendered.entries()).map(([key, value]) => ({
        key,
        mode: value.mode,
        seat: value.seat,
        text: value.text,
      }));
    },
  }));
})();

// ---- src/heroes/hu-ban-chongyi.user.js ----
(function () {
  'use strict';

  const app = window.SGS91Assistant;
  if (!app) throw new Error('SGS91 core must load before Hu Ban Chongyi module.');
  if (app.getModule('hero.hu-ban.chongyi')) return;

  const CONFIG = Object.freeze({
    version: '1.0.0',
    characterId: 1122,
    tipKey: 'hu-ban-chongyi-tip',
    tipText: 'Tips：崇义：首张出【杀】',
    font: 'FZBW',
    skillColor: '#c7de2c',
    outlineColor: '#3a281d',
    refreshIntervalMs: 120,
  });

  function toNumber(value, fallback = null) {
    if (value === '' || value == null) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function isRealSeat(value) {
    const seat = toNumber(value, null);
    return seat != null && seat >= 0 && seat < 12;
  }

  function normalizePhase(value) {
    if (value === 4 || value === '4' || value === 'play' || value === '出牌阶段') return 'play';
    return value == null ? '' : String(value);
  }

  function normalizeCardName(value) {
    return String(value || '')
      .replace(/[【】\[\]\s]/g, '')
      .replace(/^普通/, '')
      .trim();
  }

  function isSlashName(value) {
    return /^(?:冰|火|雷)?杀$/.test(normalizeCardName(value));
  }

  function extractSeat(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return toNumber(
      payload.currentSeat
      ?? payload.turnSeat
      ?? payload.seat
      ?? payload.srcSeat
      ?? payload.userSeat
      ?? payload.ownerSeat
      ?? payload.waitSeat,
      null,
    );
  }

  function extractCardName(cardOrUi) {
    if (!cardOrUi) return '';
    const card = cardOrUi.Card || cardOrUi.theCard || cardOrUi.card
      || cardOrUi.cardData || cardOrUi.data || cardOrUi;
    const direct = card.CardName || card.cardName || card.Name
      || card.name || card.displayName || card.label;
    if (typeof direct === 'string' && direct.trim()) return normalizeCardName(direct);
    const constructorName = String(card.constructor?.name || '');
    if (/^(?:Bing|Huo|Lei)?Sha(?:N)?Card$/i.test(constructorName)) {
      if (/Bing/i.test(constructorName)) return '冰杀';
      if (/Huo/i.test(constructorName)) return '火杀';
      if (/Lei/i.test(constructorName)) return '雷杀';
      return '杀';
    }
    return '';
  }

  function evaluatePrompt(input = {}) {
    const enabled = input.enabled !== false;
    const preview = input.preview === true;
    const currentSeat = toNumber(input.currentSeat, null);
    const alliedSeats = new Set((input.alliedSeats || []).map(Number).filter(Number.isFinite));
    const huBanSeats = new Set((input.huBanSeats || []).map(Number).filter(Number.isFinite));
    const cards = Array.isArray(input.currentCards) ? input.currentCards : [];
    const slashIndexes = [];
    cards.forEach((card, index) => {
      const name = typeof card === 'string' ? card : card?.name;
      if (isSlashName(name)) slashIndexes.push(index);
    });

    let reason = 'ready';
    if (!enabled) reason = 'disabled';
    else if (!preview && normalizePhase(input.phase) !== 'play') reason = 'not-play-phase';
    else if (!preview && input.firstCardPending !== true) reason = 'first-card-already-used';
    else if (!preview && !alliedSeats.has(currentSeat)) reason = 'current-seat-not-allied';
    else if (!preview && !Array.from(huBanSeats).some((seat) => alliedSeats.has(seat))) {
      reason = 'allied-huban-not-found';
    } else if (!slashIndexes.length) reason = 'no-visible-slash';

    const showTip = reason === 'ready';
    const showRecommendations = reason === 'ready';
    return Object.freeze({
      show: showTip,
      showTip,
      showRecommendations,
      reason,
      slashIndexes: Object.freeze(slashIndexes),
    });
  }

  function createLogicState(overrides = {}) {
    return {
      currentSeat: null,
      phase: '',
      firstCardPending: false,
      generals: {},
      ...overrides,
    };
  }

  function reduceMessage(previous, rawType, payload = {}) {
    const state = {
      ...createLogicState(),
      ...(previous || {}),
      generals: { ...((previous && previous.generals) || {}) },
    };
    const type = String(rawType || '').split('.').pop();

    if (/^(?:MsgDealCharacters|MsgGameStart|MsgStartGame|MsgGameOver|MsgGameEnd)$/.test(type)) {
      state.currentSeat = null;
      state.phase = '';
      state.firstCardPending = false;
      if (type !== 'MsgGameOver' && type !== 'MsgGameEnd') state.generals = {};
    }

    if (type === 'MsgGameSetCharacter' || type === 'MsgDealCharacters') {
      const rows = Array.isArray(payload.characterInfo)
        ? payload.characterInfo
        : Array.isArray(payload.characters)
          ? payload.characters
          : [];
      rows.forEach((row, index) => {
        const seat = toNumber(row && (row.seat ?? row.seatId ?? row.SeatId), index);
        const generalId = toNumber(row && (
          row.characterId ?? row.generalId ?? row.GeneralId ?? row.CharacterId
        ), null);
        if (isRealSeat(seat) && generalId != null) state.generals[seat] = generalId;
      });
    }

    if (type === 'MsgGameTurnNtf') {
      state.currentSeat = extractSeat(payload);
      state.phase = '';
      state.firstCardPending = true;
    }

    if (type === 'MsgSetGamePhaseNtf') {
      const seat = extractSeat(payload);
      if (isRealSeat(seat)) state.currentSeat = seat;
      state.phase = normalizePhase(payload.phase);
      state.firstCardPending = state.phase === 'play';
    }

    if (type === 'MsgUseCard') {
      const actor = extractSeat(payload);
      if (state.phase === 'play' && actor != null && actor === state.currentSeat) {
        state.firstCardPending = false;
      }
    }

    return state;
  }

  function computeHandOverlayLayout(cardRects, slashIndexes) {
    const rows = (Array.isArray(cardRects) ? cardRects : [])
      .map((rect, index) => ({
        index,
        x: Number(rect?.x),
        y: Number(rect?.y),
        width: Math.max(1, Number(rect?.width) || 1),
      }))
      .filter((rect) => Number.isFinite(rect.x) && Number.isFinite(rect.y));
    if (!rows.length) return [];
    const slashSet = new Set((slashIndexes || []).map(Number));
    return rows
      .filter((rect) => slashSet.has(rect.index))
      .map((rect) => ({
        index: rect.index,
        x: Math.round(rect.x + rect.width / 2 - 42),
        y: Math.round(rect.y - 34),
        width: 84,
        height: 30,
      }));
  }

  function isLiveObject(value) {
    return Boolean(value && !value.destroyed && value._destroyed !== true);
  }

  function scanStage(predicate, limit = 6000) {
    const stage = window.Laya?.stage;
    if (!stage) return [];
    const queue = [stage];
    const seen = new Set();
    const found = [];
    let visited = 0;
    while (queue.length && visited < limit) {
      const item = queue.shift();
      if (!item || seen.has(item)) continue;
      seen.add(item);
      visited += 1;
      try {
        if (predicate(item)) found.push(item);
      } catch {
      }
      const children = Array.isArray(item._children) ? item._children : [];
      children.forEach((child) => {
        if (child && !seen.has(child)) queue.push(child);
      });
    }
    return found;
  }

  function findGameManager() {
    const fromService = app.getService('seatOverlay')?.findGameManager?.();
    if (fromService) return fromService;
    const direct = scanStage((object) => object?.gameManager
      && (object.gameManager.Seats || object.gameManager.seats), 4500)[0];
    if (direct?.gameManager) return direct.gameManager;
    return scanStage((object) => object && (object.Seats || object.seats) && (
      object.selfSeatIndex != null || object.SelfSeatIndex != null || object.selfSeat != null
    ), 4500)[0] || null;
  }

  function getSeats(manager) {
    return manager && (manager.Seats || manager.seats) || null;
  }

  function readSeatObject(seats, index) {
    if (!seats || !isRealSeat(index)) return null;
    try {
      return seats[index] || seats.getNumberKey?.(index) || null;
    } catch {
      return null;
    }
  }

  function seatIndexOf(object, manager) {
    if (!object) return null;
    for (const key of ['SeatId', 'seatId', 'SeatIndex', 'seatIndex', 'Index', 'index', 'seat']) {
      const value = toNumber(object[key], null);
      if (isRealSeat(value)) return value;
    }
    const seats = getSeats(manager);
    for (let index = 0; index < 12; index += 1) {
      if (readSeatObject(seats, index) === object) return index;
    }
    return null;
  }

  function getSelfSeat(manager) {
    return toNumber(manager && (
      manager.selfSeatIndex ?? manager.SelfSeatIndex ?? manager.selfSeat
    ), null);
  }

  function getCurrentSeat(manager, state) {
    const direct = toNumber(manager && (
      manager.currentSeat ?? manager.CurrentSeat ?? manager.turnSeat ?? manager.TurnSeat
      ?? manager.actionSeat ?? manager.ActionSeat ?? manager.waitSeat ?? manager.WaitSeat
    ), null);
    return direct != null ? direct : state.currentSeat;
  }

  function getGeneralId(seatObject) {
    return toNumber(seatObject && (
      seatObject.GeneralId ?? seatObject.generalId
      ?? seatObject.CharacterId ?? seatObject.characterId
    ), null);
  }

  function readTeamKey(seatObject) {
    if (!seatObject) return '';
    for (const key of [
      'TeamId', 'teamId', 'Team', 'team', 'CampId', 'campId',
      'Camp', 'camp', 'Side', 'side', 'GroupId', 'groupId',
    ]) {
      const value = seatObject[key];
      if (value !== undefined && value !== null && String(value) !== '') {
        return `${key.toLowerCase()}:${String(value)}`;
      }
    }
    return '';
  }

  function detectTwoVersusTwo(manager, alliedSeats, state) {
    const modeText = String(
      manager?.modeName ?? manager?.ModeName ?? manager?.gameMode ?? manager?.GameMode
      ?? manager?.constructor?.name ?? '',
    );
    if (/(?:2\s*(?:v|vs)\s*2|2V2)/i.test(modeText)) return true;
    const occupiedSeats = new Set();
    const seats = getSeats(manager);
    for (let index = 0; index < 12; index += 1) {
      if (readSeatObject(seats, index)) occupiedSeats.add(index);
    }
    Object.keys(state?.generals || {}).forEach((seat) => {
      if (isRealSeat(seat)) occupiedSeats.add(Number(seat));
    });
    return occupiedSeats.size === 4 && alliedSeats.length === 2;
  }

  function readHandViews(manager) {
    const candidates = scanStage((object) => object?.cardContainer
      && Array.isArray(object.cardContainer.cardUis) && object.seat, 6500);
    const bySeat = new Map();
    candidates.forEach((view) => {
      const seatObject = view.seat || view.cardContainer?.seat;
      const seat = seatIndexOf(seatObject, manager);
      if (!isRealSeat(seat)) return;
      const cardUis = view.cardContainer.cardUis.filter(isLiveObject);
      const cards = cardUis.map((ui, index) => ({ ui, index, name: extractCardName(ui) }));
      const readable = cards.filter((card) => card.name).length;
      const row = { seat, seatObject, view, cardContainer: view.cardContainer, cards, readable };
      const old = bySeat.get(seat);
      if (!old || readable > old.readable || (readable === old.readable && cards.length > old.cards.length)) {
        bySeat.set(seat, row);
      }
    });
    return Array.from(bySeat.values());
  }

  function collectAlliedSeats(manager, handViews) {
    const allied = new Set();
    const selfSeat = getSelfSeat(manager);
    if (isRealSeat(selfSeat)) allied.add(selfSeat);
    const seats = getSeats(manager);
    if (isRealSeat(selfSeat)) {
      const selfTeam = readTeamKey(readSeatObject(seats, selfSeat));
      if (selfTeam) {
        for (let index = 0; index < 12; index += 1) {
          const seatObject = readSeatObject(seats, index);
          if (seatObject && readTeamKey(seatObject) === selfTeam) allied.add(index);
        }
      }
    }
    handViews.forEach((row) => {
      if (row.seat === selfSeat || row.readable > 0) allied.add(row.seat);
    });
    return Array.from(allied).sort((left, right) => left - right);
  }

  function collectHuBanSeats(manager, alliedSeats, state) {
    const seats = getSeats(manager);
    return alliedSeats.filter((seat) => {
      const direct = getGeneralId(readSeatObject(seats, seat));
      const cached = toNumber(state.generals[seat], null);
      return direct === CONFIG.characterId || cached === CONFIG.characterId;
    });
  }

  const runtime = {
    enabled: true,
    preview: false,
    hookAttached: false,
    hookFailure: '',
    lastMessageAt: '',
    lastMessageType: '',
    lastRenderReason: 'waiting-for-game',
    lastRenderSurface: { topTip: 'hidden', recommendations: 'hidden' },
    lastSnapshot: null,
    recentMessages: [],
  };
  let logic = createLogicState();
  let messageUnsubscribe = null;
  let refreshTimer = 0;
  let layer = null;
  let layerParent = null;
  let lastLayerSignature = '';

  function attachMessageBus() {
    if (runtime.hookAttached) return true;
    const messages = app.getService('gameMessages');
    if (!messages || typeof messages.subscribe !== 'function') {
      runtime.hookFailure = '三国杀91助手内置消息服务不可用';
      return false;
    }
    try {
      messageUnsubscribe = messages.subscribe((type, payload) => onMessage(type, payload || {}, 'internal'));
      runtime.hookAttached = true;
      runtime.hookFailure = '';
      return true;
    } catch (error) {
      runtime.hookFailure = String(error?.message || error);
      return false;
    }
  }

  function ensureLayer(parent) {
    const Laya = window.Laya;
    if (!parent || !Laya?.Sprite || !Laya?.Text || typeof parent.addChild !== 'function') return null;
    if (layer && layerParent === parent && isLiveObject(layer)) return layer;
    if (layer?.destroy) {
      try { layer.destroy(true); } catch {
      }
    }
    layer = new Laya.Sprite();
    layer.name = 'sgs91-hu-ban-chongyi-layer';
    layer.zOrder = 999999;
    layer.mouseEnabled = false;
    parent.addChild(layer);
    layerParent = parent;
    lastLayerSignature = '';
    return layer;
  }

  function addRecommendation(target, position) {
    const label = new window.Laya.Text();
    label.text = '推荐';
    label.font = CONFIG.font;
    label.fontSize = 24;
    label.color = CONFIG.skillColor;
    label.stroke = 2;
    label.strokeColor = CONFIG.outlineColor;
    label.align = 'center';
    label.valign = 'middle';
    label.width = position.width;
    label.height = position.height;
    label.pos(position.x, position.y);
    label.mouseEnabled = false;
    target.addChild(label);
  }

  function renderRecommendations(show, cards, slashCards) {
    if (!window.Laya?.Sprite || !window.Laya?.Text) return false;
    if (!show) {
      layer?.removeChildren?.();
      lastLayerSignature = '';
      return true;
    }
    const visibleCards = (cards || []).filter((card) => card && isLiveObject(card.ui));
    const parent = visibleCards[0]?.ui?.parent;
    if (!parent) return false;
    const sameParentCards = visibleCards.filter((card) => card.ui.parent === parent);
    const slashUis = new Set((slashCards || []).map((card) => card?.ui));
    const cardRects = sameParentCards.map((card) => ({
      x: Number(card.ui.x) || 0,
      y: Number(card.ui.y) || 0,
      width: Math.max(1, (Number(card.ui.width) || 72) * (Number(card.ui.scaleX) || 1)),
    }));
    const slashIndexes = sameParentCards
      .map((card, index) => slashUis.has(card.ui) ? index : -1)
      .filter((index) => index >= 0);
    const recommendations = computeHandOverlayLayout(cardRects, slashIndexes);
    const target = ensureLayer(parent);
    if (!target) return false;
    const signature = JSON.stringify(recommendations);
    if (signature === lastLayerSignature) return true;
    lastLayerSignature = signature;
    target.removeChildren?.();
    recommendations.forEach((position) => addRecommendation(target, position));
    return true;
  }

  function renderTopTip(show) {
    const overlay = app.getService('noticeOverlay');
    app.getService('seatOverlay')?.clear?.(CONFIG.tipKey);
    if (!show) {
      overlay?.clear?.(CONFIG.tipKey);
      return true;
    }
    return overlay?.show?.(CONFIG.tipKey, {
      lane: 'private',
      anchor: 'before-action-prompt',
      duration: 1000000,
      text: CONFIG.tipText,
      parts: [
        { text: 'Tips：', font: CONFIG.font, size: 24, color: '#f6de9c' },
        { text: '崇义：', font: CONFIG.font, size: 24, color: CONFIG.skillColor },
        { text: '首张出', font: CONFIG.font, size: 24, color: '#f6de9c' },
        { text: '【杀】', font: CONFIG.font, size: 24, color: '#E7B43C' },
      ],
    }) === true;
  }

  function buildSnapshot() {
    const manager = findGameManager();
    const handViews = readHandViews(manager);
    const alliedSeats = collectAlliedSeats(manager, handViews);
    const huBanSeats = collectHuBanSeats(manager, alliedSeats, logic);
    const twoVersusTwo = detectTwoVersusTwo(manager, alliedSeats, logic);
    const currentSeat = getCurrentSeat(manager, logic);
    const currentView = handViews.find((row) => row.seat === currentSeat)
      || (runtime.preview ? handViews.find((row) => row.cards.some((card) => isSlashName(card.name))) : null);
    const currentCards = currentView?.cards || [];
    const result = evaluatePrompt({
      enabled: runtime.enabled,
      preview: runtime.preview,
      twoVersusTwo,
      currentSeat: currentView ? currentView.seat : currentSeat,
      alliedSeats,
      huBanSeats,
      phase: logic.phase,
      firstCardPending: logic.firstCardPending,
      currentCards,
    });
    const slashCards = result.slashIndexes.map((index) => currentCards[index]).filter(Boolean);
    return {
      managerFound: Boolean(manager),
      selfSeat: getSelfSeat(manager),
      currentSeat,
      twoVersusTwo,
      phase: logic.phase,
      firstCardPending: logic.firstCardPending,
      alliedSeats,
      huBanSeats,
      views: handViews.map((row) => ({
        seat: row.seat,
        generalId: getGeneralId(row.seatObject) ?? logic.generals[row.seat] ?? null,
        cards: row.cards.map((card) => card.name || '?'),
      })),
      result,
      currentCards,
      slashCards,
    };
  }

  function refresh() {
    const snapshot = buildSnapshot();
    runtime.lastSnapshot = {
      ...snapshot,
      currentCards: snapshot.currentCards.map((card) => ({ index: card.index, name: card.name })),
      slashCards: snapshot.slashCards.map((card) => ({ index: card.index, name: card.name })),
    };
    runtime.lastRenderReason = snapshot.result.reason;
    const tipRendered = renderTopTip(snapshot.result.showTip);
    const cardsRendered = renderRecommendations(
      snapshot.result.showRecommendations,
      snapshot.currentCards,
      snapshot.slashCards,
    );
    runtime.lastRenderSurface = {
      topTip: tipRendered && snapshot.result.showTip ? '锦囊袋同款私有顶部提示' : 'hidden',
      recommendations: cardsRendered && snapshot.result.showRecommendations ? 'Laya手牌层' : 'hidden',
    };
    return runtime.lastSnapshot;
  }

  function onMessage(type, payload = {}, source = 'manual') {
    if (!type) return null;
    logic = reduceMessage(logic, type, payload);
    runtime.lastMessageAt = new Date().toISOString();
    runtime.lastMessageType = String(type);
    runtime.recentMessages.push({
      at: runtime.lastMessageAt,
      source,
      type: String(type).split('.').pop(),
      seat: extractSeat(payload),
      phase: payload?.phase,
      card: extractCardName(payload?.card || payload?.Card || payload),
    });
    if (runtime.recentMessages.length > 40) runtime.recentMessages.shift();
    return refresh();
  }

  function cloneDiagnostic(value, depth = 0, seen = new Set()) {
    if (depth > 4 || value == null) return value == null ? value : String(value);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 40).map((item) => cloneDiagnostic(item, depth + 1, seen));
    const output = {};
    Object.keys(value).slice(0, 80).forEach((key) => {
      try { output[key] = cloneDiagnostic(value[key], depth + 1, seen); }
      catch { output[key] = '[Unreadable]'; }
    });
    return output;
  }

  function diagnostic() {
    refresh();
    return {
      module: 'hero.hu-ban.chongyi',
      version: CONFIG.version,
      exportedAt: new Date().toISOString(),
      config: { characterId: CONFIG.characterId, tipText: CONFIG.tipText },
      runtime: cloneDiagnostic(runtime),
      logic: cloneDiagnostic(logic),
    };
  }

  async function copyDiagnostic() {
    const text = JSON.stringify(diagnostic(), null, 2);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return text;
      } catch {
      }
    }
    if (!document.body) return text;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand?.('copy');
    textarea.remove();
    return text;
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = 0;
    if (typeof messageUnsubscribe === 'function') messageUnsubscribe();
    messageUnsubscribe = null;
    runtime.hookAttached = false;
    renderTopTip(false);
    layer?.removeChildren?.();
    if (layer?.destroy) {
      try { layer.destroy(true); } catch {
      }
    }
    layer = null;
    layerParent = null;
    lastLayerSignature = '';
  }

  const api = Object.freeze({
    version: CONFIG.version,
    state: runtime,
    refresh,
    probe: diagnostic,
    exportDiagnostic: diagnostic,
    copyDiagnostic,
    onMessage(type, payload) { return onMessage(type, payload || {}, 'manual'); },
    setEnabled(value = true) {
      runtime.enabled = Boolean(value);
      return refresh();
    },
    setPreview(value = true) {
      runtime.preview = Boolean(value);
      lastLayerSignature = '';
      return refresh();
    },
    destroy,
    __test: Object.freeze({
      normalizePhase,
      normalizeCardName,
      isSlashName,
      extractSeat,
      extractCardName,
      evaluatePrompt,
      createLogicState,
      reduceMessage,
      computeHandOverlayLayout,
      readTeamKey,
      detectTwoVersusTwo,
    }),
  });
  window.HuBanChongyiHelper = api;

  app.registerModule({
    id: 'hero.hu-ban.chongyi',
    type: 'hero',
    name: '胡班·崇义',
    version: CONFIG.version,
    description: '2V2 我方有胡班时，在当前我方角色出牌阶段首张牌使用前提示优先出【杀】，并标记可见的【杀】。',
    capabilities: ['game-message-read', 'hand-read', 'card-overlay', 'top-notice', 'diagnostic-export'],
    characterIds: [CONFIG.characterId],
    skillIds: [],
    api,
  });

  attachMessageBus();
  refreshTimer = setInterval(refresh, CONFIG.refreshIntervalMs);
  setTimeout(refresh, 0);
})();

// ---- src/heroes/huan-jie-jianli.user.js ----
(function () {
  'use strict';

  const app = window.SGS91Assistant;
  if (!app) throw new Error('SGS91 core must load before Huan Jie Jianli module.');
  if (app.getModule('hero.huan-jie.jianli')) return;

  const CONFIG = {
    version: '1.0.0',
    characterId: 1098,
    skillId: 3735,
    characterNames: ['桓阶'],
    skillNames: ['谏立'],
    stripKeyPrefix: 'sgs91-huan-jie-jianli-',
    dedupeMs: 250,
    refreshIntervalMs: 300,
  };
  const RESET_MESSAGE = /(?:MsgDealCharacters|MsgGameStart|MsgStartGame|MsgGameOver|NotifyGameOver|MsgGameEnd|MsgLeaveGame|CRespLobbyTableLeave|CNotifyTableLeave|CRespTableLeave|CNotifyTableExit|CRespTableExit)$/i;
  const FORBIDDEN_ACTIVATION_MESSAGE = /(?:MsgRoleOptTargetNtf$|Target|Choose|Select|Prompt|Candidate|Request|Req$|Ask|Preview)/i;
  const CONFIRMED_ACTIVATION_MESSAGE = /(?:^MsgUseSpell$|(?:Use|Cast|Play).*(?:Skill|Spell)|(?:Skill|Spell).*(?:Effect|Result|Finish|Done|Success))/i;

  function toNumber(value, fallback = null) {
    if (value === '' || value == null) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function isRealSeat(value) {
    const seat = toNumber(value, null);
    return seat != null && seat >= 0 && seat < 12;
  }

  function normalizePhase(value) {
    if (value === 4 || value === '4' || value === 'play' || value === '出牌阶段') return 'play';
    return value == null ? '' : String(value);
  }

  function normalizeMessageType(type, payload) {
    let text = typeof type === 'string' ? type.trim() : '';
    const constructorName = payload && (payload.__ctor || payload.constructor?.name) || '';
    if (constructorName && constructorName !== 'Object' && (!text || /^(?:logicmsg|cmsg|object)$/i.test(text))) {
      text = constructorName;
    }
    if (text.includes('.')) text = text.split('.').pop();
    if (/^%[a-z]$/i.test(text)) return '';
    return text;
  }

  function payloadSkillId(payload) {
    return toNumber(payload && (
      payload.spellId ?? payload.skillId ?? payload.SpellId ?? payload.SkillId
      ?? payload.spell?.id ?? payload.skill?.id
    ), null);
  }

  function payloadSkillName(payload) {
    return String(payload && (
      payload.spellName ?? payload.skillName ?? payload.SpellName ?? payload.SkillName
      ?? payload.spell?.name ?? payload.skill?.name
    ) || '');
  }

  function payloadCharacterId(payload) {
    return toNumber(payload && (
      payload.ownerCharacterId ?? payload.characterId ?? payload.generalId
      ?? payload.CharacterId ?? payload.GeneralId ?? payload.heroId
    ), null);
  }

  function payloadCharacterName(payload) {
    return String(payload && (
      payload.ownerCharacterName ?? payload.characterName ?? payload.generalName
      ?? payload.CharacterName ?? payload.GeneralName ?? payload.heroName
    ) || '');
  }

  function payloadCasterSeat(payload) {
    return toNumber(payload && (
      payload.spellCasterSeat ?? payload.casterSeat ?? payload.srcSeat ?? payload.userSeat
      ?? payload.ownerSeat ?? payload.optSeat ?? payload.fromSeat ?? payload.seat
    ), null);
  }

  function extractSkillIds(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (typeof item === 'number' || typeof item === 'string') return toNumber(item, null);
      return payloadSkillId(item) ?? toNumber(item?.id, null);
    }).filter((item) => item != null);
  }

  function includesAnyName(value, names) {
    const text = String(value || '');
    return names.some((name) => text.includes(name));
  }

  function createModel(overrides = {}) {
    const model = {
      selfSeat: null,
      currentTurnSeat: null,
      currentPhase: '',
      turnToken: 0,
      uses: 0,
      selfIsHuanJie: false,
      selfSkillIds: [],
      discoveredSkillId: null,
      skillNamesById: {},
      seatStates: {},
      lastTransition: '等待游戏消息',
      lastResetReason: '',
      ...overrides,
      selfSkillIds: Array.isArray(overrides.selfSkillIds) ? overrides.selfSkillIds.slice() : [],
      skillNamesById: { ...(overrides.skillNamesById || {}) },
      seatStates: {},
    };
    Object.entries(overrides.seatStates || {}).forEach(([seat, state]) => {
      if (!isRealSeat(seat)) return;
      model.seatStates[seat] = {
        isHuanJie: Boolean(state?.isHuanJie),
        uses: Math.max(0, Math.min(2, toNumber(state?.uses, 0))),
        turnToken: Math.max(0, toNumber(state?.turnToken, 0)),
        lastResetTurnToken: toNumber(state?.lastResetTurnToken, null),
        characterId: toNumber(state?.characterId, null),
        skillIds: Array.isArray(state?.skillIds) ? state.skillIds.slice() : [],
      };
    });
    if (isRealSeat(model.selfSeat)) {
      const state = ensureSeatState(model, model.selfSeat);
      state.isHuanJie = Boolean(model.selfIsHuanJie || state.isHuanJie);
      state.uses = Math.max(0, Math.min(2, toNumber(model.uses, state.uses)));
      state.turnToken = Math.max(0, toNumber(model.turnToken, state.turnToken));
      state.lastResetTurnToken = toNumber(overrides.lastResetTurnToken, state.lastResetTurnToken);
      state.skillIds = Array.from(new Set(state.skillIds.concat(model.selfSkillIds)));
      syncSelfState(model);
    }
    return model;
  }

  function ensureSeatState(model, seat) {
    const seatNumber = toNumber(seat, null);
    if (!isRealSeat(seatNumber)) return null;
    const key = String(seatNumber);
    if (!model.seatStates[key]) {
      model.seatStates[key] = {
        isHuanJie: false,
        uses: 0,
        turnToken: 0,
        lastResetTurnToken: null,
        characterId: null,
        skillIds: [],
      };
    }
    return model.seatStates[key];
  }

  function syncSelfState(model) {
    if (!isRealSeat(model.selfSeat)) return;
    const state = ensureSeatState(model, model.selfSeat);
    model.selfIsHuanJie = state.isHuanJie;
    model.uses = state.uses;
    model.selfSkillIds = state.skillIds.slice();
  }

  function markHuanJieSeat(model, seat, evidence = {}) {
    const state = ensureSeatState(model, seat);
    if (!state) return false;
    let changed = false;
    if (!state.isHuanJie) {
      state.isHuanJie = true;
      changed = true;
    }
    const characterId = toNumber(evidence.characterId, null);
    if (characterId != null && state.characterId !== characterId) {
      state.characterId = characterId;
      changed = true;
    }
    const skillIds = extractSkillIds(evidence.skillIds || []);
    const nextSkillIds = Array.from(new Set(state.skillIds.concat(skillIds)));
    if (nextSkillIds.length !== state.skillIds.length) {
      state.skillIds = nextSkillIds;
      changed = true;
    }
    if (toNumber(seat, null) === model.selfSeat) syncSelfState(model);
    return changed;
  }

  function resetMatchModel(model, reason = 'reset') {
    model.currentTurnSeat = null;
    model.currentPhase = '';
    model.turnToken = 0;
    model.uses = 0;
    model.selfIsHuanJie = false;
    model.selfSkillIds = [];
    model.discoveredSkillId = null;
    model.skillNamesById = {};
    model.seatStates = {};
    model.lastTransition = `已清理：${reason}`;
    model.lastResetReason = reason;
  }

  function cacheSkillEvidence(model, payload, config = CONFIG) {
    if (!payload || typeof payload !== 'object') return false;
    let changed = false;
    const queue = [{ value: payload, depth: 0 }];
    const seen = new Set();
    while (queue.length) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 3) continue;
      seen.add(value);
      const id = payloadSkillId(value);
      const name = payloadSkillName(value);
      if (id != null && name) {
        if (model.skillNamesById[id] !== name) {
          model.skillNamesById[id] = name;
          changed = true;
        }
        if (includesAnyName(name, config.skillNames) && model.discoveredSkillId !== id) {
          model.discoveredSkillId = id;
          changed = true;
        }
      }
      Object.keys(value).slice(0, 60).forEach((key) => {
        let nested;
        try { nested = value[key]; } catch { return; }
        if (nested && typeof nested === 'object') queue.push({ value: nested, depth: depth + 1 });
      });
    }
    return changed;
  }

  function payloadLooksLikeJianli(payload, model, config = CONFIG) {
    if (!payload || typeof payload !== 'object') return false;
    const id = payloadSkillId(payload);
    if (id != null && (id === toNumber(config.skillId, null) || id === toNumber(model.discoveredSkillId, null))) return true;
    if (includesAnyName(payloadSkillName(payload), config.skillNames)) return true;
    return id != null && includesAnyName(model.skillNamesById[id], config.skillNames);
  }

  function cacheIdentityEvidence(model, payload, config = CONFIG) {
    if (!payload || typeof payload !== 'object') return false;
    const seat = payloadCasterSeat(payload);
    if (!isRealSeat(seat)) return false;
    const characterId = payloadCharacterId(payload);
    const characterMatches = characterId === toNumber(config.characterId, null)
      || includesAnyName(payloadCharacterName(payload), config.characterNames);
    if (characterMatches || payloadLooksLikeJianli(payload, model, config)) {
      return markHuanJieSeat(model, seat, { characterId });
    }
    return false;
  }

  function isConfirmedJianliActivation(type, payload, model, config = CONFIG) {
    const typeText = normalizeMessageType(type, payload);
    if (!typeText || FORBIDDEN_ACTIVATION_MESSAGE.test(typeText)) return false;
    if (!CONFIRMED_ACTIVATION_MESSAGE.test(typeText)) return false;
    if (!payloadLooksLikeJianli(payload, model, config)) return false;
    const caster = payloadCasterSeat(payload);
    return isRealSeat(caster) && model.currentPhase === 'play' && model.currentTurnSeat === caster;
  }

  function reduceMessage(model, type, payload = {}, config = CONFIG) {
    const typeText = normalizeMessageType(type, payload);
    if (!typeText) return { changed: false, activation: false, reset: false };
    let changed = false;
    let reset = false;
    if (RESET_MESSAGE.test(typeText)) {
      resetMatchModel(model, typeText);
      changed = true;
      reset = true;
    }
    if (cacheSkillEvidence(model, payload, config)) changed = true;
    if (cacheIdentityEvidence(model, payload, config)) changed = true;

    if (typeText === 'MsgGameSetCharacter' || typeText === 'MsgDealCharacters') {
      const characters = payload.characterInfo ?? payload.characters ?? payload.characterInfos ?? payload.roles ?? [];
      if (Array.isArray(characters)) characters.forEach((character) => {
        const seat = payloadCasterSeat(character);
        const characterId = payloadCharacterId(character);
        if (characterId === toNumber(config.characterId, null)
          || includesAnyName(payloadCharacterName(character), config.characterNames)) {
          if (markHuanJieSeat(model, seat, { characterId })) changed = true;
        }
      });
    }

    if (['MsgSetCharacterSpell', 'MsgAddCharacterSpell', 'MsgRemoveCharacterSpell'].includes(typeText)) {
      const seat = toNumber(payload.seat ?? payload.ownerSeat ?? payload.srcSeat, null);
      if (isRealSeat(seat)) {
        const state = ensureSeatState(model, seat);
        const incoming = extractSkillIds(payload.spellIds ?? payload.skillIds ?? payload.spells ?? payload.skills ?? []);
        if (typeText === 'MsgSetCharacterSpell') state.skillIds = incoming;
        if (typeText === 'MsgAddCharacterSpell') state.skillIds = Array.from(new Set(state.skillIds.concat(incoming)));
        if (typeText === 'MsgRemoveCharacterSpell') {
          const removed = new Set(incoming);
          state.skillIds = state.skillIds.filter((id) => !removed.has(id));
        }
        const matchesCharacter = payloadCharacterId(payload) === toNumber(config.characterId, null)
          || includesAnyName(payloadCharacterName(payload), config.characterNames);
        const knownIds = [toNumber(config.skillId, null), toNumber(model.discoveredSkillId, null)].filter((id) => id != null);
        if (matchesCharacter || knownIds.some((id) => state.skillIds.includes(id))) {
          if (markHuanJieSeat(model, seat, { characterId: payloadCharacterId(payload) })) changed = true;
        }
        if (seat === model.selfSeat) syncSelfState(model);
        changed = true;
      }
    }

    if (typeText === 'MsgGameTurnNtf') {
      const seat = toNumber(payload.currentSeat ?? payload.turnSeat ?? payload.seat ?? payload.srcSeat, null);
      if (isRealSeat(seat)) {
        model.turnToken += 1;
        const state = ensureSeatState(model, seat);
        state.turnToken += 1;
        model.currentTurnSeat = seat;
        model.currentPhase = '';
        model.lastTransition = `新回合：座位${seat}`;
        changed = true;
      }
    }

    if (typeText === 'MsgSetGamePhaseNtf') {
      const phase = normalizePhase(payload.phase);
      const seat = toNumber(payload.currentSeat ?? payload.turnSeat ?? payload.seat ?? payload.srcSeat ?? payload.userSeat, model.currentTurnSeat);
      if (isRealSeat(seat)) model.currentTurnSeat = seat;
      model.currentPhase = phase;
      if (phase === '0' && isRealSeat(seat)) {
        model.turnToken += 1;
        ensureSeatState(model, seat).turnToken += 1;
      }
      const active = isRealSeat(model.currentTurnSeat) ? ensureSeatState(model, model.currentTurnSeat) : null;
      if (phase === 'play' && active?.isHuanJie && active.lastResetTurnToken !== active.turnToken) {
        active.uses = 0;
        active.lastResetTurnToken = active.turnToken;
        model.lastResetReason = `huan-jie-play:${model.currentTurnSeat}:${active.turnToken}`;
        model.lastTransition = `座位${model.currentTurnSeat}进入出牌阶段：谏立次数已重置`;
      } else {
        model.lastTransition = `阶段：${phase || '未知'}`;
      }
      syncSelfState(model);
      changed = true;
    }

    const activation = isConfirmedJianliActivation(typeText, payload, model, config);
    if (activation) {
      const caster = payloadCasterSeat(payload);
      markHuanJieSeat(model, caster, { characterId: payloadCharacterId(payload) });
      const state = ensureSeatState(model, caster);
      state.uses = Math.min(2, state.uses + 1);
      if (caster === model.selfSeat) syncSelfState(model);
      model.lastTransition = `座位${caster}谏立确认发动：${state.uses}次`;
      changed = true;
    }
    return { changed, activation, reset };
  }

  function derivePresentation(model, seat = model.selfSeat) {
    const seatNumber = toNumber(seat, null);
    const state = isRealSeat(seatNumber) ? model.seatStates[String(seatNumber)] : null;
    const isHuanJie = seatNumber === model.selfSeat
      ? Boolean(model.selfIsHuanJie || state?.isHuanJie)
      : Boolean(state?.isHuanJie);
    if (!isHuanJie || model.currentTurnSeat !== seatNumber || model.currentPhase !== 'play') return null;
    const uses = seatNumber === model.selfSeat
      ? Math.max(0, Math.min(2, toNumber(model.uses, state?.uses || 0)))
      : Math.max(0, Math.min(2, toNumber(state?.uses, 0)));
    if (uses >= 2) return { text: '谏立已失效', color: '#d8bd83', borderColor: '#9b865b' };
    if (uses === 1) return { text: '谏立可发动次数 1 次', color: '#f4d17b', borderColor: '#b88942' };
    return { text: '谏立可发动次数 2 次', color: '#a9f0af', borderColor: '#75b979' };
  }

  function derivePresentations(model) {
    const result = {};
    Object.keys(model.seatStates || {}).forEach((seat) => {
      const presentation = derivePresentation(model, Number(seat));
      if (presentation) result[seat] = presentation;
    });
    return result;
  }

  function messageSignature(type, payload = {}) {
    return JSON.stringify({
      type: normalizeMessageType(type, payload),
      seat: payload.seat ?? payload.srcSeat ?? payload.ownerSeat ?? payload.currentSeat ?? null,
      phase: payload.phase ?? null,
      skillId: payload.spellId ?? payload.skillId ?? null,
      skillName: payload.spellName ?? payload.skillName ?? null,
      characterId: payload.ownerCharacterId ?? payload.characterId ?? payload.generalId ?? null,
      targets: Array.isArray(payload.targets) ? payload.targets.slice(0, 12) : null,
    });
  }

  function createMessageReceiver(handler, options = {}) {
    const recent = new Map();
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const dedupeMs = toNumber(options.dedupeMs, CONFIG.dedupeMs);
    return function receive(source, type, payload = {}) {
      const normalizedType = normalizeMessageType(type, payload);
      if (!normalizedType) return { processed: false, duplicate: false };
      const signature = messageSignature(normalizedType, payload);
      const at = now();
      const previousAt = recent.get(signature);
      if (previousAt != null && at - previousAt < dedupeMs) {
        options.onDuplicate?.(source, normalizedType, payload);
        return { processed: false, duplicate: true };
      }
      recent.set(signature, at);
      for (const [key, timestamp] of recent) if (at - timestamp > dedupeMs * 4) recent.delete(key);
      handler(normalizedType, payload, source);
      return { processed: true, duplicate: false };
    };
  }

  function readGeneralId(object) {
    return toNumber(object && (object.GeneralId ?? object.generalId ?? object.CharacterId ?? object.characterId), null);
  }

  function readGeneralName(object) {
    return String(object && (object.GeneralName ?? object.generalName ?? object.CharacterName ?? object.characterName) || '');
  }

  function readSeatSkillIds(object) {
    return extractSkillIds(object && (object.spellIds ?? object.skillIds ?? object.SpellIds ?? object.skills) || []);
  }

  function readSelfSeat(manager) {
    return toNumber(manager && (manager.selfSeatIndex ?? manager.SelfSeatIndex ?? manager.selfSeat ?? manager.SelfSeat), null);
  }

  function refreshIdentity(model) {
    const overlay = app.getService('seatOverlay');
    const manager = overlay?.findGameManager?.();
    if (!manager) return false;
    const selfSeat = readSelfSeat(manager);
    if (isRealSeat(selfSeat)) model.selfSeat = selfSeat;
    let changed = false;
    for (let seat = 0; seat < 12; seat += 1) {
      const object = overlay.readSeatObject?.(manager, seat);
      if (!object) continue;
      const characterId = readGeneralId(object);
      const characterName = readGeneralName(object);
      const skillIds = readSeatSkillIds(object);
      const isHuanJie = characterId === CONFIG.characterId
        || includesAnyName(characterName, CONFIG.characterNames)
        || skillIds.includes(CONFIG.skillId)
        || (model.discoveredSkillId != null && skillIds.includes(model.discoveredSkillId));
      if (isHuanJie && markHuanJieSeat(model, seat, { characterId, skillIds })) changed = true;
    }
    syncSelfState(model);
    return changed;
  }

  function createSeatStripRenderer(getOverlay = () => app.getService('seatOverlay')) {
    const displayed = new Map();
    const stats = { showCalls: 0, clearCalls: 0, skippedSameText: 0, lastError: '' };
    const keyForSeat = (seat) => `${CONFIG.stripKeyPrefix}${seat}`;
    function clearSeat(seat) {
      if (!displayed.has(String(seat))) return;
      try { getOverlay()?.clear?.(keyForSeat(seat)); stats.clearCalls += 1; }
      catch (error) { stats.lastError = String(error?.message || error); }
      displayed.delete(String(seat));
    }
    function render(hints = {}) {
      const allSeats = new Set([...displayed.keys(), ...Object.keys(hints)]);
      for (const seat of allSeats) {
        const hint = hints[seat];
        const previous = displayed.get(String(seat));
        if (!hint) { clearSeat(seat); continue; }
        if (previous?.text === hint.text && previous.color === hint.color) {
          stats.skippedSameText += 1;
          continue;
        }
        if (previous) clearSeat(seat);
        try {
          const ok = getOverlay()?.show?.(keyForSeat(seat), Number(seat), hint.text, {
            font: 'FZBW',
            fontSize: 16,
            minFontSize: 12,
            fitText: true,
            textPaddingX: 4,
            color: hint.color,
            borderColor: hint.borderColor,
            zOrder: 99999,
          });
          stats.showCalls += 1;
          if (ok !== false) displayed.set(String(seat), { text: hint.text, color: hint.color });
        } catch (error) { stats.lastError = String(error?.message || error); }
      }
    }
    function clearAll() { Array.from(displayed.keys()).forEach(clearSeat); }
    return { render, clearAll, displayed, stats };
  }

  const model = createModel();
  const renderer = createSeatStripRenderer();
  const runtime = {
    hookAttached: false,
    hookFailure: '',
    lastMessageAt: '',
    lastMessageType: '',
    hints: {},
    refreshCount: 0,
    duplicates: 0,
  };
  let refreshTimer = 0;
  let unsubscribe = null;

  function refresh() {
    refreshIdentity(model);
    runtime.hints = derivePresentations(model);
    runtime.refreshCount += 1;
    renderer.render(runtime.hints);
    return runtime.hints;
  }

  const receive = createMessageReceiver((type, payload) => {
    runtime.lastMessageAt = new Date().toISOString();
    runtime.lastMessageType = type;
    reduceMessage(model, type, payload, CONFIG);
    refresh();
  }, { onDuplicate() { runtime.duplicates += 1; } });

  function onMessage(type, payload = {}) {
    return receive('gameMessages', type, payload);
  }

  function attachMessageBus() {
    if (runtime.hookAttached) return true;
    const messages = app.getService('gameMessages');
    if (!messages?.subscribe) return false;
    try {
      unsubscribe = messages.subscribe((type, payload) => onMessage(type, payload || {}));
      runtime.hookAttached = true;
      return true;
    } catch (error) {
      runtime.hookFailure = String(error?.message || error);
      return false;
    }
  }

  function cloneDiagnostic(value, depth = 0, seen = new Set()) {
    if (depth > 4 || value == null) return value == null ? value : String(value);
    if (['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 40).map((item) => cloneDiagnostic(item, depth + 1, seen));
    const output = {};
    Object.keys(value).slice(0, 80).forEach((key) => {
      try { output[key] = cloneDiagnostic(value[key], depth + 1, seen); }
      catch { output[key] = '[Unreadable]'; }
    });
    return output;
  }

  function diagnostic() {
    refresh();
    return {
      module: 'hero.huan-jie.jianli',
      version: CONFIG.version,
      exportedAt: new Date().toISOString(),
      config: { characterId: CONFIG.characterId, skillId: CONFIG.skillId },
      runtime: cloneDiagnostic(runtime),
      state: cloneDiagnostic(model),
      renderStats: cloneDiagnostic(renderer.stats),
    };
  }

  async function copyDiagnostic() {
    const text = JSON.stringify(diagnostic(), null, 2);
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return text; } catch {}
    }
    if (!document.body) return text;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand?.('copy');
    textarea.remove();
    return text;
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = 0;
    unsubscribe?.();
    unsubscribe = null;
    runtime.hookAttached = false;
    renderer.clearAll();
  }

  const api = Object.freeze({
    version: CONFIG.version,
    state: runtime,
    refresh,
    probe: diagnostic,
    exportDiagnostic: diagnostic,
    copyDiagnostic,
    onMessage,
    destroy,
    __test: Object.freeze({
      normalizePhase,
      normalizeMessageType,
      createModel,
      reduceMessage,
      derivePresentation,
      derivePresentations,
      createMessageReceiver,
      createSeatStripRenderer,
      refreshIdentity,
    }),
  });
  window.HuanJieJianliHelper = api;

  app.registerModule({
    id: 'hero.huan-jie.jianli',
    type: 'hero',
    name: '桓阶·谏立',
    version: CONFIG.version,
    description: '在场上桓阶的出牌阶段显示谏立剩余发动次数，确认发动两次后显示失效。',
    capabilities: ['game-message-read', 'seat-overlay', 'diagnostic-export'],
    characterIds: [CONFIG.characterId],
    skillIds: [CONFIG.skillId],
    api,
  });

  if (!attachMessageBus()) runtime.hookFailure = '三国杀91助手内置消息服务不可用';
  refreshTimer = setInterval(refresh, CONFIG.refreshIntervalMs);
  setTimeout(refresh, 0);
})();

// ---- src/heroes/linglie-shouhu.user.js ----
(function () {
  'use strict';

  const app = window.SGS91Assistant;
  if (!app) throw new Error('SGS91 core must load before Linglie Shouhu module.');
  if (app.getModule('hero.linglie.shouhu')) return;

  const CONFIG = Object.freeze({
    characterId: 1126,
    shouhuSkillId: 3757,
    yizhunSkillId: 3758,
    stripKey: 'sgs91-linglie-shouhu',
  });

  const state = {
    selfSeat: null,
    selfIsLinglie: false,
    currentTurnSeat: null,
    currentPhase: '',
    shouhuStatus: 'unknown',
    selfSkillIds: [],
    lastStatusAt: '',
    lastRenderMode: 'hidden',
    recentMessages: [],
    hookStatus: {
      jndSeen: false,
      jndHooked: false,
      sgsModuleSeen: false,
      sgsModuleHooked: false,
      internalMessagesHooked: false,
    },
  };

  const recentSignatures = new Map();
  let layaStrip = null;

  function toNumber(value, fallback = null) {
    if (value === '' || value == null) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function isRealSeat(value) {
    const seat = toNumber(value, null);
    return seat != null && seat >= 0 && seat < 12;
  }

  function normalizePhase(value) {
    if (value === 4 || value === '4' || value === 'play' || value === '出牌阶段') return 'play';
    return value == null ? '' : String(value);
  }

  function normalizeMessageType(type, payload) {
    const text = typeof type === 'string' ? type : '';
    const constructorName = payload?.__ctor || payload?.constructor?.name || '';
    if (constructorName && constructorName !== 'Object' && (!text || /^(logicmsg|cmsg|object)$/i.test(text))) {
      return constructorName;
    }
    return text;
  }

  function messageSignature(type, payload) {
    return JSON.stringify({
      type,
      seat: payload?.seat ?? null,
      ownerSeat: payload?.ownerSeat ?? null,
      srcSeat: payload?.srcSeat ?? null,
      currentSeat: payload?.currentSeat ?? null,
      phase: payload?.phase ?? null,
      spellId: payload?.spellId ?? payload?.skillId ?? null,
      id: payload?.id ?? null,
      data: Array.isArray(payload?.data) ? payload.data.slice(0, 8) : null,
      spellIds: Array.isArray(payload?.spellIds) ? payload.spellIds.slice(0, 20) : null,
    });
  }

  function rememberMessage(type, payload, source) {
    state.recentMessages.push({
      at: new Date().toISOString(),
      source,
      type,
      payload: {
        seat: payload?.seat ?? null,
        ownerSeat: payload?.ownerSeat ?? null,
        srcSeat: payload?.srcSeat ?? null,
        currentSeat: payload?.currentSeat ?? null,
        phase: payload?.phase ?? null,
        spellId: payload?.spellId ?? payload?.skillId ?? null,
        ownerCharacterId: payload?.ownerCharacterId ?? payload?.characterId ?? null,
        id: payload?.id ?? null,
        data: Array.isArray(payload?.data) ? payload.data.slice(0, 12) : null,
        spellIds: Array.isArray(payload?.spellIds) ? payload.spellIds.slice(0, 30) : null,
      },
    });
    if (state.recentMessages.length > 50) state.recentMessages.splice(0, state.recentMessages.length - 50);
  }

  function findGameManager() {
    try {
      const manager = window.__JND?.findGameManager?.();
      if (manager) return manager;
    } catch {
    }
    const stage = window.Laya?.stage;
    if (!stage) return null;
    const queue = [stage];
    const seen = new Set();
    while (queue.length && seen.size < 500) {
      const object = queue.shift();
      if (!object || typeof object !== 'object' || seen.has(object)) continue;
      seen.add(object);
      if (object.gameManager?.Seats || object.gameManager?.seats) return object.gameManager;
      if ((object.Seats || object.seats) && (
        object.selfSeatIndex != null || object.SelfSeatIndex != null || object.selfSeat != null
      )) return object;
      if (Array.isArray(object._children)) queue.push(...object._children);
    }
    return null;
  }

  function readSeatObject(manager, seat) {
    const seats = manager?.Seats || manager?.seats;
    if (!seats || seat == null) return null;
    try {
      return seats[seat] || seats.getNumberKey?.(seat) || null;
    } catch {
      return null;
    }
  }

  function extractSkillIds(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (typeof item === 'number' || typeof item === 'string') return toNumber(item, null);
      return toNumber(item?.spellId ?? item?.skillId ?? item?.id, null);
    }).filter((item) => item != null);
  }

  function refreshIdentityFromGame() {
    const seatObject = readSeatObject(findGameManager(), state.selfSeat);
    if (!seatObject) return;
    const characterId = toNumber(
      seatObject.GeneralId ?? seatObject.generalId ?? seatObject.characterId
      ?? seatObject.CharacterId ?? seatObject.heroId,
      null,
    );
    const skillIds = extractSkillIds(
      seatObject.spellIds ?? seatObject.skillIds ?? seatObject.spells ?? seatObject.skills
      ?? seatObject.SpellIds ?? seatObject.SkillIds,
    );
    if (characterId != null) {
      state.selfIsLinglie = characterId === CONFIG.characterId;
      return;
    }
    if (skillIds.length) {
      state.selfSkillIds = skillIds;
      state.selfIsLinglie = skillIds.includes(CONFIG.shouhuSkillId) || skillIds.includes(CONFIG.yizhunSkillId);
    }
  }

  function readSelfSeat() {
    try {
      const seat = window.__JND?.selfSeatIndex?.();
      if (isRealSeat(seat)) return toNumber(seat, null);
    } catch {
    }
    const manager = findGameManager();
    const managerSeat = toNumber(manager?.selfSeatIndex ?? manager?.SelfSeatIndex ?? manager?.selfSeat, null);
    if (isRealSeat(managerSeat)) return managerSeat;
    return isRealSeat(state.selfSeat) ? state.selfSeat : null;
  }

  function clearStrip() {
    try {
      app.getService?.('seatOverlay')?.clear?.(CONFIG.stripKey);
    } catch {
    }
    try {
      window.__JND?.clearSeatSkillStrip?.(CONFIG.stripKey);
    } catch {
    }
    if (layaStrip) {
      try { layaStrip.removeSelf(); } catch {}
      layaStrip = null;
    }
    document.getElementById('sgs91-linglie-shouhu-dom')?.remove();
  }

  function renderSharedStrip(presentation) {
    const overlay = app.getService?.('seatOverlay');
    if (!overlay?.show || state.selfSeat == null) return false;
    try {
      const rendered = overlay.show(CONFIG.stripKey, state.selfSeat, presentation.text, {
        font: 'FZBW',
        fontSize: 16,
        minFontSize: 10,
        fitText: true,
        textPaddingX: 4,
        color: presentation.color,
        borderColor: presentation.borderColor,
        zOrder: 99999,
      }) === true;
      if (rendered) state.lastRenderMode = 'sgs91-seat-overlay';
      return rendered;
    } catch {
      return false;
    }
  }

  function resetGameState() {
    state.selfSeat = readSelfSeat();
    state.selfIsLinglie = false;
    state.selfSkillIds = [];
    state.currentTurnSeat = null;
    state.currentPhase = '';
    state.shouhuStatus = 'unknown';
    state.lastStatusAt = '';
    state.lastRenderMode = 'hidden';
    clearStrip();
  }

  function findSeatAvatar(seat) {
    const seatObject = readSeatObject(findGameManager(), seat);
    const direct = seatObject?.SeatUI?.seatAvatar || seatObject?.seatUI?.seatAvatar
      || seatObject?.SeatUI?.avatar || seatObject?.seatUI?.avatar;
    if (direct && typeof direct.localToGlobal === 'function') return direct;
    try {
      const fromJnd = window.__JND?.getSeatAvatar?.(seat);
      if (fromJnd && typeof fromJnd.localToGlobal === 'function') return fromJnd;
    } catch {
    }
    return null;
  }

  function findSeatComboLayer() {
    try {
      const box = window.__JND?._box;
      const layer = box?.comboLayer || box?.seatComboLayer || box?.seatLayer || box?.gameLayer;
      if (layer && typeof layer.globalToLocal === 'function') return layer;
    } catch {
    }
    const stage = window.Laya?.stage;
    if (!stage) return null;
    const queue = [stage];
    const seen = new Set();
    while (queue.length && seen.size < 500) {
      const object = queue.shift();
      if (!object || typeof object !== 'object' || seen.has(object)) continue;
      seen.add(object);
      const name = object.name || object.constructor?.name || '';
      if (/seatComboSprite/i.test(name) && typeof object.globalToLocal === 'function') return object;
      if (Array.isArray(object._children)) queue.push(...object._children);
    }
    return null;
  }

  function renderJndStrip(presentation) {
    const jnd = window.__JND;
    if (!jnd || typeof jnd.showSeatSkillStrip !== 'function' || state.selfSeat == null) return false;
    try {
      const rendered = jnd.showSeatSkillStrip(CONFIG.stripKey, state.selfSeat, presentation.text, {
        fontSize: 13,
        minFontSize: 10,
        fitText: true,
        textPaddingX: 4,
        color: presentation.color,
        zOrder: 99999,
      }) === true;
      if (rendered) state.lastRenderMode = 'jnd';
      return rendered;
    } catch {
      return false;
    }
  }

  function renderLayaStrip(presentation) {
    const Laya = window.Laya;
    const avatar = findSeatAvatar(state.selfSeat);
    const layer = findSeatComboLayer();
    if (!Laya?.Sprite || !Laya?.Text || !Laya?.Point || !avatar || !layer || typeof layer.globalToLocal !== 'function') {
      return false;
    }
    if (layaStrip) {
      try { layaStrip.removeSelf(); } catch {}
      layaStrip = null;
    }
    try {
      const width = 96;
      const height = 22;
      const center = avatar.localToGlobal(new Laya.Point((avatar.width || 0) / 2, (avatar.height || 0) / 2), true);
      const local = layer.globalToLocal(new Laya.Point(center.x, center.y), true);
      const strip = new Laya.Sprite();
      strip.name = 'sgs91-linglie-shouhu-strip';
      strip.zOrder = 99999;
      strip.alpha = 0.94;
      strip.size(width, height);
      strip.pos(Math.round(local.x - width / 2), Math.round(local.y - (avatar.height || 82) / 2 - height - 4));
      try { strip.graphics.drawRect(0, 0, width, height, '#2b2b2b', presentation.borderColor, 1); }
      catch { strip.graphics.drawRect(0, 0, width, height, '#2b2b2b'); }
      const label = new Laya.Text();
      label.text = presentation.text;
      label.font = 'FZBW';
      label.fontSize = 13;
      label.bold = true;
      label.color = presentation.color;
      label.align = 'center';
      label.valign = 'middle';
      label.width = width;
      label.height = height;
      strip.addChild(label);
      layer.addChild(strip);
      layaStrip = strip;
      state.lastRenderMode = 'laya';
      return true;
    } catch {
      return false;
    }
  }

  function renderDomStrip(presentation) {
    if (!document.body) return false;
    let element = document.getElementById('sgs91-linglie-shouhu-dom');
    if (!element) {
      element = document.createElement('div');
      element.id = 'sgs91-linglie-shouhu-dom';
      document.body.appendChild(element);
    }
    element.textContent = presentation.text;
    Object.assign(element.style, {
      position: 'fixed',
      left: '50%',
      bottom: '154px',
      transform: 'translateX(-50%)',
      zIndex: '99998',
      minWidth: '88px',
      height: '22px',
      boxSizing: 'border-box',
      padding: '2px 6px',
      border: `1px solid ${presentation.borderColor}`,
      borderRadius: '2px',
      background: 'rgba(43, 43, 43, .94)',
      color: presentation.color,
      font: '700 13px/16px FZBW, "Microsoft YaHei", sans-serif',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      boxShadow: '0 2px 6px rgba(0, 0, 0, .35)',
    });
    state.lastRenderMode = 'dom';
    return true;
  }

  function render() {
    state.selfSeat = readSelfSeat();
    refreshIdentityFromGame();
    const isOwnPlayPhase = state.selfSeat != null
      && state.currentTurnSeat === state.selfSeat
      && state.currentPhase === 'play';
    if (!state.selfIsLinglie || !isOwnPlayPhase) {
      state.lastRenderMode = 'hidden';
      clearStrip();
      return;
    }
    const presentation = state.shouhuStatus === 'ready'
      ? { text: '狩虎 可用', color: '#a9f0af', borderColor: '#75b979' }
      : state.shouhuStatus === 'used'
        ? { text: '狩虎 不可用', color: '#d8bd83', borderColor: '#9b865b' }
        : { text: '狩虎 检测中', color: '#b8b8b8', borderColor: '#777777' };
    if (renderSharedStrip(presentation) || renderJndStrip(presentation)) {
      if (layaStrip) {
        try { layaStrip.removeSelf(); } catch {}
        layaStrip = null;
      }
      document.getElementById('sgs91-linglie-shouhu-dom')?.remove();
      return;
    }
    if (renderLayaStrip(presentation)) {
      document.getElementById('sgs91-linglie-shouhu-dom')?.remove();
      return;
    }
    renderDomStrip(presentation);
  }

  function onMessage(type, payload = {}, source = 'api') {
    type = normalizeMessageType(type, payload);
    if (!type) return;
    rememberMessage(type, payload, source);
    state.selfSeat = readSelfSeat();
    if ((type === 'MsgGameHandCardNtf' || type === 'MsgGamePlayCardNtf') && state.selfSeat == null) {
      const inferredSeat = toNumber(payload.seat ?? payload.userSeat ?? payload.ownerSeat, null);
      if (isRealSeat(inferredSeat)) state.selfSeat = inferredSeat;
    }
    if (type === 'MsgDealCharacters') resetGameState();
    if ([
      'MsgGameOver', 'NotifyGameOver', 'CRespLobbyTableLeave', 'CNotifyTableLeave',
      'CRespTableLeave', 'CNotifyTableExit', 'CRespTableExit',
    ].includes(type)) {
      resetGameState();
      return;
    }
    if (type === 'MsgSetCharacterSpell' || type === 'MsgAddCharacterSpell' || type === 'MsgRemoveCharacterSpell') {
      const seat = toNumber(payload.seat ?? payload.ownerSeat ?? payload.srcSeat, null);
      const skills = payload.spellIds ?? payload.skillIds ?? payload.spells ?? payload.skills ?? [];
      if (seat === state.selfSeat) {
        const incoming = extractSkillIds(skills);
        if (type === 'MsgSetCharacterSpell') state.selfSkillIds = incoming;
        if (type === 'MsgAddCharacterSpell') state.selfSkillIds = Array.from(new Set(state.selfSkillIds.concat(incoming)));
        if (type === 'MsgRemoveCharacterSpell') {
          const removed = new Set(incoming);
          state.selfSkillIds = state.selfSkillIds.filter((id) => !removed.has(id));
        }
        state.selfIsLinglie = state.selfSkillIds.includes(CONFIG.shouhuSkillId)
          || state.selfSkillIds.includes(CONFIG.yizhunSkillId);
      }
    }
    if (type === 'MsgGameTurnNtf') {
      const nextSeat = toNumber(payload.currentSeat ?? payload.turnSeat ?? payload.seat ?? payload.srcSeat, null);
      if (nextSeat !== state.currentTurnSeat) state.currentPhase = '';
      state.currentTurnSeat = isRealSeat(nextSeat) ? nextSeat : null;
    }
    if (type === 'MsgSetGamePhaseNtf') {
      state.currentPhase = normalizePhase(payload.phase);
      const seat = toNumber(payload.currentSeat ?? payload.turnSeat ?? payload.seat ?? payload.srcSeat, null);
      if (seat != null) state.currentTurnSeat = seat;
      if (state.currentPhase === 'play' && state.currentTurnSeat === state.selfSeat) {
        state.shouhuStatus = 'ready';
        state.lastStatusAt = new Date().toISOString();
      }
    }
    if (type === 'MsgUseSpell') {
      const ownerSeat = toNumber(payload.ownerSeat ?? payload.srcSeat ?? payload.userSeat ?? payload.seat, null);
      const characterId = toNumber(payload.ownerCharacterId ?? payload.characterId ?? payload.generalId, null);
      const skillId = toNumber(payload.spellId ?? payload.skillId ?? payload.id, null);
      if (ownerSeat === state.selfSeat && skillId === CONFIG.shouhuSkillId
        && (state.selfIsLinglie || characterId === CONFIG.characterId)) {
        if (characterId === CONFIG.characterId) state.selfIsLinglie = true;
        state.shouhuStatus = 'used';
        state.lastStatusAt = new Date().toISOString();
      }
    }
    if (type === 'MsgUpdateRoleDataExNtf') {
      const seat = toNumber(payload.seat ?? payload.ownerSeat ?? payload.srcSeat, null);
      const id = toNumber(payload.id, null);
      const data = Array.isArray(payload.data) ? payload.data.map(Number) : [];
      if (seat === state.selfSeat && id === CONFIG.shouhuSkillId && data[0] === 0 && data[1] === 0) {
        state.selfIsLinglie = true;
        state.shouhuStatus = 'ready';
        state.lastStatusAt = new Date().toISOString();
      }
    }
    render();
  }

  function receiveMessage(source, type, payload = {}) {
    const normalizedType = normalizeMessageType(type, payload);
    if (!normalizedType) return;
    const signature = messageSignature(normalizedType, payload);
    const now = Date.now();
    const previousAt = recentSignatures.get(signature) || 0;
    if (now - previousAt < 120) return;
    recentSignatures.set(signature, now);
    if (recentSignatures.size > 80) {
      for (const [key, at] of recentSignatures) {
        if (now - at > 2000) recentSignatures.delete(key);
      }
    }
    onMessage(normalizedType, payload, source);
  }

  function extractMessage(args) {
    if (typeof args[0] === 'string') return { type: args[0], payload: args[1] || {} };
    const object = args.find((item) => item && typeof item === 'object');
    if (!object) return { type: '', payload: {} };
    return {
      type: object.type || object.rawType || object.msgName || object.name || object.__ctor || object.constructor?.name || '',
      payload: object.payload || object.data || object,
    };
  }

  function attachJndBus() {
    const jnd = window.__JND;
    if (!jnd || typeof jnd !== 'object') return false;
    state.hookStatus.jndSeen = true;
    if (jnd.__sgs91LinglieShouhuHooked) {
      state.hookStatus.jndHooked = true;
      return true;
    }
    if (typeof jnd.onMsg !== 'function') return false;
    jnd.onMsg((type, payload) => receiveMessage('jnd', type, payload || {}));
    try { Object.defineProperty(jnd, '__sgs91LinglieShouhuHooked', { value: true }); }
    catch { jnd.__sgs91LinglieShouhuHooked = true; }
    state.hookStatus.jndHooked = true;
    return true;
  }

  function attachSgsModule() {
    const bus = window.SGSMODULE;
    if (!Array.isArray(bus)) return false;
    state.hookStatus.sgsModuleSeen = true;
    if (bus.__sgs91LinglieShouhuHooked) {
      state.hookStatus.sgsModuleHooked = true;
      return true;
    }
    bus.push(function (...args) {
      const message = extractMessage(args);
      receiveMessage('sgsmodule', message.type, message.payload);
    });
    try { Object.defineProperty(bus, '__sgs91LinglieShouhuHooked', { value: true }); }
    catch { bus.__sgs91LinglieShouhuHooked = true; }
    state.hookStatus.sgsModuleHooked = true;
    return true;
  }

  function attachInternalMessageBus() {
    const messages = app.getService('gameMessages');
    if (!messages || typeof messages.subscribe !== 'function' || state.hookStatus.internalMessagesHooked) return false;
    messages.subscribe((type, payload) => receiveMessage('sgs91-core', type, payload || {}));
    state.hookStatus.internalMessagesHooked = true;
    return true;
  }

  function probe() {
    return {
      url: location.href,
      selfSeat: state.selfSeat,
      selfIsLinglie: state.selfIsLinglie,
      currentTurnSeat: state.currentTurnSeat,
      currentPhase: state.currentPhase,
      shouhuStatus: state.shouhuStatus,
      selfSkillIds: state.selfSkillIds.slice(),
      lastStatusAt: state.lastStatusAt,
      lastRenderMode: state.lastRenderMode,
      hookStatus: { ...state.hookStatus },
      recentMessages: state.recentMessages.map((item) => ({ ...item, payload: { ...item.payload } })),
    };
  }

  async function copyDiagnostic() {
    const text = JSON.stringify(probe(), null, 2);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return text;
      } catch {
      }
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body?.appendChild(textarea);
    textarea.select();
    document.execCommand?.('copy');
    textarea.remove();
    return text;
  }

  const api = Object.freeze({
    state,
    onMessage,
    probe,
    copyDiagnostic,
    __test: Object.freeze({ normalizePhase, extractSkillIds }),
  });
  window.LinglieShouhuHelper = api;

  app.registerModule({
    id: 'hero.linglie.shouhu',
    type: 'hero',
    name: '凌烈·狩虎',
    version: '1.0.0',
    description: '在自己使用凌烈的出牌阶段显示狩虎可用、不可用或检测中状态。',
    capabilities: ['game-message-read', 'seat-overlay', 'diagnostic-export'],
    characterIds: [CONFIG.characterId],
    skillIds: [CONFIG.shouhuSkillId, CONFIG.yizhunSkillId],
    api,
  });

  attachInternalMessageBus();
  attachJndBus();
  attachSgsModule();
  const hookTimer = setInterval(() => {
    attachJndBus();
    attachSgsModule();
    attachInternalMessageBus();
    render();
  }, 500);
  setTimeout(() => clearInterval(hookTimer), 180000);
})();

// ---- src/heroes/mou-deng-ai-juxi.user.js ----
(function () {
  'use strict';

  const CONFIG = {
    domSeatStripId: 'mda-juxi-dom-seat-strip',
    seatStripKey: 'mou-deng-ai-juxi-x',
    invalidStripPrefix: 'mou-deng-ai-juxi-invalid-',
    renderIntervalMs: 16,
    hintFontName: 'FZBW',
    seatStripFontSize: 16,
    cardBadgeFontSize: 20,
    cardBadgeXRatio: 0.4,
    cardBadgeYRatio: 1,
    defaultAttackRange: 1,
    slashLimit: 1,
    enableStageTextSlashCounter: false,
    characterIds: {
      mouDengAi: 1740,
    },
    skillIds: {
      juxi: 3716,
    },
    characterNames: ['谋邓艾'],
    skillNames: ['骤袭'],
  };

  const EQUIPMENT_NAMES = new Set([
    '诸葛连弩', '雌雄双股剑', '青釭剑', '青龙偃月刀', '丈八蛇矛', '贯石斧', '方天画戟',
    '麒麟弓', '寒冰剑', '古锭刀', '朱雀羽扇', '白银狮子', '八卦阵', '仁王盾',
    '藤甲', '护心镜', '的卢', '绝影', '爪黄飞电', '赤兔', '大宛', '紫骍',
    '骅骝', '木牛流马'
  ]);
  const WEAPON_NAMES = new Set([
    '诸葛连弩', '雌雄双股剑', '青釭剑', '青龙偃月刀', '丈八蛇矛', '贯石斧',
    '方天画戟', '麒麟弓', '寒冰剑', '古锭刀', '朱雀羽扇'
  ]);
  const SELF_ONLY_OR_RESPONSE = new Set(['闪', '桃', '酒', '无懈可击', '无中生有', '闪电']);
  const DISTANCE_ONE_TRICKS = new Set(['顺手牵羊', '兵粮寸断']);
  const ANY_OTHER_TRICKS = new Set(['过河拆桥', '决斗', '火攻', '乐不思蜀', '铁索连环']);
  const GLOBAL_OTHER_TRICKS = new Set(['南蛮入侵', '万箭齐发', '桃园结义', '五谷丰登']);

  const GAME_SCENES = [
    'TableGameScene', 'HeroBattle1v1GameScene', 'ShenWuZaiShiGameScene',
    'RogueLikeGameScene', 'RogueLike1v1GameScene', 'PointRace2V2GameScene',
    'ZhuGongShaGameScene', 'GuanDuZhiZhanGameScene', 'ShiDianYanLuoGameScene',
    'HuLaoGuanGameScene', 'ChallengeMatchFigureGameScene', 'ChallengeMatch2v2GameScene',
    'GuideFiveFigureGameScene', 'GuideHappyGameScene', 'NewBieForceTrainGameScene',
    'NewBieForceGameScene', 'QMBZGameScene', 'LZHZGameScene', 'ShenZhiShiLianGameScene',
    'QianLiDJGameScene', 'DouDiZhuGameScene', 'GuideGameScene', 'New1v1GameScene',
    'TSGameScene', 'XzcbpGameScene', 'PaiWeiGameScene', 'GuoGameScene',
    'ChallengeMatchDouDiZhuGameScene', 'ChallengeMatchCountryGameScene',
    'OfflineMatch2V2GameScene', 'DouDiZhu2023GameScene', 'ObDDZGameScene',
    'ObGamePractice2v2Scene', 'ObGameScene'
  ];

  const state = {
    enabled: true,
    bodyReady: false,
    selfSeat: null,
    currentPhase: '',
    currentTurnSeat: null,
    slashUsedThisTurn: 0,
    slashRemainingThisTurn: null,
    slashLimit: CONFIG.slashLimit,
    slashCounterSource: 'message-counter',
    hasZhugeCrossbowEquipped: false,
    attackRange: CONFIG.defaultAttackRange,
    inGame: false,
    knownSeats: [],
    deadSeats: [],
    actionSeats: [],
    targetableSeats: [],
    targetSource: '',
    targetModeUntil: 0,
    seatSkills: {},
    skillNamesById: {},
    selfIsMouDengAi: false,
    isOwnPlayPhase: false,
    characterEvidence: '等待识别',
    handCards: [],
    judgedCards: [],
    unavailableCount: 0,
    canUseJuxi: false,
    pendingJuxiBySeat: {},
    juxiInvalidMarks: {},
    slashUsageBySeat: {},
    lastMessage: '',
    lastStatus: '等待游戏加载',
    lastCardBadgeCount: 0,
    lastCardBadgeReason: '',
    recent: [],
    importantRecent: [],
    hookStatus: {
      bootAt: new Date().toISOString(),
      jndSeen: false,
      jndHooked: false,
      internalMessagesHooked: false,
      pageBridgeInjected: false,
      pageBridgeReady: false,
      lastMessageAt: '',
    },
  };

  let layaSeatStrip = null;
  let layaCardBadgeLayer = null;
  let renderTimer = 0;
  let lastJndStripText = '';

  function toNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizePhase(value) {
    if (value === 4 || value === '4' || value === 'play' || value === '出牌阶段') return 'play';
    if (value == null) return '';
    return String(value);
  }

  function normalizeCardName(value) {
    const normalized = String(value || '')
      .replace(/[【】\[\]\s]/g, '')
      .replace(/^普通/, '')
      .trim();
    return normalized === '借刀' ? '借刀杀人' : normalized;
  }

  function isSlashName(name) {
    const normalized = normalizeCardName(name);
    return normalized === '杀' || normalized === '火杀' || normalized === '雷杀' || normalized === '冰杀';
  }

  function isEquipment(card) {
    const name = normalizeCardName(card && card.name);
    const typeText = String(
      (card && (card.typeName || card.cardTypeName || card.category || card.type || card.cardType)) || ''
    ).toLowerCase();
    return EQUIPMENT_NAMES.has(name) || /equip|weapon|armor|horse|treasure|装备|武器|防具|坐骑|宝物/.test(typeText);
  }

  function computeDistanceToOthers(context) {
    const seats = Array.isArray(context.seats) ? context.seats : [];
    const selfSeat = context.selfSeat;
    return seats
      .filter((seat) => seat && seat.seat !== selfSeat && !seat.dead)
      .map((seat) => ({
        seat: seat.seat,
        distance: Number.isFinite(Number(seat.distance)) ? Number(seat.distance) : null,
        targetable: seat.targetable === true,
        targetKnown: seat.targetKnown === true,
        hasWeapon: seat.hasWeapon === true,
      }));
  }

  function hasAnyOther(context) {
    return computeDistanceToOthers(context).length > 0;
  }

  function hasRangeTarget(context) {
    const attackRange = Math.max(1, Number(context.attackRange || 1));
    return computeDistanceToOthers(context).some((seat) => {
      if (seat.targetKnown) return seat.targetable;
      return seat.distance != null && seat.distance <= attackRange;
    });
  }

  function getSlashRemainingUses(context) {
    if (context.hasZhugeCrossbowEquipped === true) return Infinity;
    if (context.slashRemainingThisTurn != null && Number.isFinite(Number(context.slashRemainingThisTurn))) {
      return Math.max(0, Number(context.slashRemainingThisTurn));
    }
    const limit = context.slashLimit != null && context.slashLimit !== '' && Number.isFinite(Number(context.slashLimit))
      ? Math.max(0, Number(context.slashLimit))
      : 1;
    const used = Number.isFinite(Number(context.slashUsedThisTurn)) ? Math.max(0, Number(context.slashUsedThisTurn)) : 0;
    return Math.max(0, limit - used);
  }

  function hasDistanceOneTarget(context) {
    return computeDistanceToOthers(context).some((seat) => {
      if (seat.targetKnown) return seat.targetable;
      return seat.distance != null && seat.distance <= 1;
    });
  }

  function hasOtherWeaponTarget(context) {
    return computeDistanceToOthers(context).some((seat) => seat.hasWeapon);
  }

  function judgeCardTargetability(card, context) {
    const name = normalizeCardName(card && card.name);
    const phase = context.currentPhase || '';

    if (!name) return { ...card, name, canTargetOther: null, countsAsUnavailable: false, reason: '未识别牌名，暂不计入', confidence: 'unknown' };
    if (isEquipment(card)) return { ...card, name, canTargetOther: false, countsAsUnavailable: true, reason: '装备牌通常只能用于自己，不能指定其他角色', confidence: 'high' };
    if (SELF_ONLY_OR_RESPONSE.has(name)) return { ...card, name, canTargetOther: false, countsAsUnavailable: true, reason: `${name}通常不能在出牌阶段主动指定其他角色`, confidence: 'high' };

    if (isSlashName(name)) {
      if (phase !== 'play') return { ...card, name, canTargetOther: false, countsAsUnavailable: true, reason: '当前不是出牌阶段，【杀】不能主动指定其他角色', confidence: 'medium' };
      if (getSlashRemainingUses(context) <= 0) return { ...card, name, canTargetOther: false, countsAsUnavailable: true, reason: '本回合普通【杀】使用次数已用完', confidence: 'high' };
      if (!hasRangeTarget(context)) return { ...card, name, canTargetOther: false, countsAsUnavailable: true, reason: '当前攻击范围内没有可指定的其他角色', confidence: 'medium' };
      return { ...card, name, canTargetOther: true, countsAsUnavailable: false, reason: context.hasZhugeCrossbowEquipped === true ? '已装备【诸葛连弩】，且范围内有目标' : '本回合仍可使用普通【杀】，且范围内有目标', confidence: 'high' };
    }

    if (DISTANCE_ONE_TRICKS.has(name)) {
      const ok = hasDistanceOneTarget(context);
      return { ...card, name, canTargetOther: ok, countsAsUnavailable: !ok, reason: ok ? `${name}有距离 1 内目标` : `${name}当前没有距离 1 内目标`, confidence: 'medium' };
    }

    if (name === '借刀杀人') {
      const ok = hasOtherWeaponTarget(context);
      return { ...card, name, canTargetOther: ok, countsAsUnavailable: !ok, reason: ok ? '场上其他角色有武器，可尝试借刀' : '其他角色都没有武器，借刀杀人不能使用', confidence: 'medium' };
    }

    if (ANY_OTHER_TRICKS.has(name) || GLOBAL_OTHER_TRICKS.has(name)) {
      const ok = hasAnyOther(context);
      return { ...card, name, canTargetOther: ok, countsAsUnavailable: !ok, reason: ok ? `${name}可指定/影响其他角色` : `${name}当前没有其他存活角色`, confidence: 'medium' };
    }

    return { ...card, name, canTargetOther: null, countsAsUnavailable: false, reason: '未知牌规则，暂不计入骤袭数量', confidence: 'unknown' };
  }

  function evaluateJuxi(cards, context) {
    const judgedCards = (Array.isArray(cards) ? cards : []).map((card) => judgeCardTargetability(card, context || {}));
    const unavailableCount = judgedCards.filter((card) => card.countsAsUnavailable).length;
    const isOwnPlayPhase = Boolean(context && context.isOwnTurn && context.currentPhase === 'play');
    return {
      isMouDengAi: Boolean(context && context.isMouDengAi),
      isOwnPlayPhase,
      unavailableCount,
      canUseJuxi: Boolean(context && context.isMouDengAi) && isOwnPlayPhase && unavailableCount >= 3,
      judgedCards,
    };
  }

  function findInScene(target, ...path) {
    if (!target) return null;
    const single = (arr) => Array.isArray(arr) && arr.length === 1 ? arr[0] : arr;

    function getChildren(obj, name) {
      if (!obj || typeof obj !== 'object') return [];
      if (name in obj) return obj[name];
      if (obj._children) {
        const found = obj._children.filter((child) =>
          child && (child.name === name || (child.constructor && child.constructor.name === name))
        );
        return found.length ? single(found) : [];
      }
      return [];
    }

    let cur = target;
    for (const name of path) {
      if (!cur || typeof cur !== 'object') return null;
      cur = Array.isArray(cur)
        ? (cur.length ? cur.flatMap((item) => getChildren(item, name)) : [])
        : getChildren(cur, name);
      if (Array.isArray(cur)) cur = single(cur);
    }
    return cur && (Array.isArray(cur) ? (cur.length ? single(cur) : null) : cur) || null;
  }

  function getCardContainer() {
    const stage = window.Laya && window.Laya.stage;
    if (!stage) return null;
    const sceneLayer = findInScene(stage, 'SceneLayer');
    if (!sceneLayer) return null;
    for (const name of GAME_SCENES) {
      const scene = findInScene(sceneLayer, name);
      if (!scene) continue;
      const selfSeat = findInScene(scene, 'SelfSeatUi');
      if (!selfSeat) continue;
      const container = findInScene(selfSeat, 'cardContainer');
      if (container && container.cardUis && container.cardUis.length) return container;
    }
    return null;
  }

  function findLayaObject(root, predicate, maxObjects = 3200) {
    if (!root || typeof predicate !== 'function') return null;
    const queue = [root];
    const seen = new Set();
    let visited = 0;
    while (queue.length && visited < maxObjects) {
      const item = queue.shift();
      if (!item || seen.has(item)) continue;
      seen.add(item);
      visited += 1;
      try {
        if (predicate(item)) return item;
      } catch {
      }
      const children = Array.isArray(item._children) ? item._children : [];
      children.forEach((child) => {
        if (child && !seen.has(child)) queue.push(child);
      });
    }
    return null;
  }

  function findChildByName(root, name) {
    if (!root || !Array.isArray(root._children)) return null;
    return root._children.find((child) => (child && (child.name || child.constructor?.name)) === name) || null;
  }

  function findGameManager() {
    try {
      const jndManager = window.__JND && window.__JND.findGameManager && window.__JND.findGameManager();
      if (jndManager) return jndManager;
    } catch {
    }
    const stage = window.Laya && window.Laya.stage;
    if (!stage) return null;
    const scene = findLayaObject(stage, (object) => object && object.gameManager && (object.gameManager.Seats || object.gameManager.seats));
    if (scene && scene.gameManager) return scene.gameManager;
    return findLayaObject(stage, (object) => object && (object.Seats || object.seats) && (
      object.selfSeatIndex != null || object.SelfSeatIndex != null || object.selfSeat != null
    ));
  }

  function getSeatContainer() {
    const manager = findGameManager();
    return manager && (manager.Seats || manager.seats) || null;
  }

  function readSeatFromContainer(seats, seat) {
    if (!seats || seat == null) return null;
    try {
      return seats[seat] || (seats.getNumberKey && seats.getNumberKey(seat)) || null;
    } catch {
      return null;
    }
  }

  function getSeatObject(seat) {
    return readSeatFromContainer(getSeatContainer(), seat);
  }

  function isRealSeat(value) {
    const seat = toNumber(value, null);
    return seat != null && seat >= 0 && seat < 12;
  }

  function rememberKnownSeat(value) {
    const seat = toNumber(value, null);
    if (!isRealSeat(seat) || state.knownSeats.includes(seat)) return;
    state.knownSeats.push(seat);
    state.knownSeats.sort((left, right) => left - right);
  }

  function getSelfSeat() {
    try {
      const jndSelf = window.__JND && window.__JND.selfSeatIndex && window.__JND.selfSeatIndex();
      if (isRealSeat(jndSelf)) return jndSelf;
    } catch {
    }
    const manager = findGameManager();
    const direct = toNumber(manager && (manager.selfSeatIndex ?? manager.SelfSeatIndex ?? manager.selfSeat), null);
    if (isRealSeat(direct)) return direct;
    return isRealSeat(state.selfSeat) ? state.selfSeat : null;
  }

  function getCurrentTurnSeat() {
    if (isRealSeat(state.currentTurnSeat)) return state.currentTurnSeat;
    const manager = findGameManager();
    const direct = toNumber(manager && (
      manager.currentSeat
      ?? manager.CurrentSeat
      ?? manager.turnSeat
      ?? manager.TurnSeat
      ?? manager.actionSeat
      ?? manager.ActionSeat
      ?? manager.waitSeat
      ?? manager.WaitSeat
    ), null);
    return isRealSeat(direct) ? direct : null;
  }

  function getSeatOrder() {
    const manager = findGameManager();
    const raw = manager && (manager.actionSeats || manager.ActionSeats || manager.gameUserActionOrderList || manager.GameUserActionOrderList);
    if (Array.isArray(raw)) {
      const seats = Array.from(new Set(raw.map((item) => toNumber(item?.actionSeatId ?? item?.seat ?? item, null)).filter(isRealSeat)));
      if (seats.length >= 2) state.actionSeats = seats;
    }
    const seats = getSeatContainer();
    const managerSeats = [];
    if (seats) {
      for (let seat = 0; seat < 12; seat += 1) {
        const seatObject = readSeatFromContainer(seats, seat);
        if (seatObject && !(seatObject.destroyed || seatObject._destroyed)) managerSeats.push(seat);
      }
    }
    const source = state.actionSeats.length >= 2 ? state.actionSeats : managerSeats.length >= 2 ? managerSeats : state.knownSeats;
    return Array.from(new Set(source)).filter(isRealSeat).sort((left, right) => left - right);
  }

  function computeCircularDistance(fromSeat, toSeat, activeSeats) {
    if (fromSeat == null || toSeat == null || fromSeat === toSeat) return 0;
    const fromIndex = activeSeats.indexOf(fromSeat);
    const toIndex = activeSeats.indexOf(toSeat);
    if (fromIndex < 0 || toIndex < 0 || activeSeats.length <= 1) return null;
    const clockwise = (toIndex - fromIndex + activeSeats.length) % activeSeats.length;
    const counter = (fromIndex - toIndex + activeSeats.length) % activeSeats.length;
    return Math.max(1, Math.min(clockwise, counter));
  }

  function computeAliveSeatDistance(fromSeat, toSeat, seatOrder, deadSeats, directDistance = null) {
    if (fromSeat === toSeat) return 0;
    const dead = new Set(Array.isArray(deadSeats) ? deadSeats : []);
    if (dead.has(toSeat)) return null;
    const allSeats = Array.from(new Set(Array.isArray(seatOrder) ? seatOrder : []));
    const aliveSeats = allSeats.filter((seat) => !dead.has(seat));
    const fullBaseDistance = computeCircularDistance(fromSeat, toSeat, allSeats);
    const aliveBaseDistance = computeCircularDistance(fromSeat, toSeat, aliveSeats);
    if (aliveBaseDistance == null) return null;

    const rawDistance = Number(directDistance);
    if (!Number.isFinite(rawDistance) || fullBaseDistance == null) return aliveBaseDistance;
    const modifier = rawDistance - fullBaseDistance;
    return Math.max(1, aliveBaseDistance + modifier);
  }

  function callDistanceMethod(owner, names, fromSeat, toSeat) {
    if (!owner) return null;
    for (const name of names) {
      const fn = owner[name];
      if (typeof fn !== 'function') continue;
      try {
        const value = fn.call(owner, fromSeat, toSeat);
        const number = toNumber(value, null);
        if (number != null && number >= 0 && number < 20) return number;
      } catch {
      }
      try {
        const value = fn.call(owner, getSeatObject(fromSeat), getSeatObject(toSeat));
        const number = toNumber(value, null);
        if (number != null && number >= 0 && number < 20) return number;
      } catch {
      }
    }
    return null;
  }

  function readDirectDistance(fromSeat, toSeat) {
    const manager = findGameManager();
    return callDistanceMethod(manager, ['getDistance', 'GetDistance', 'calcDistance', 'CalcDistance', 'getSeatDistance', 'GetSeatDistance'], fromSeat, toSeat)
      ?? callDistanceMethod(getSeatObject(fromSeat), ['getDistance', 'GetDistance', 'distanceTo', 'DistanceTo', 'calcDistance', 'CalcDistance'], fromSeat, toSeat);
  }

  function readNamedBoolean(object, names) {
    if (!object) return null;
    for (const name of names) {
      if (object[name] === undefined) continue;
      if (typeof object[name] === 'boolean') return object[name];
      const number = toNumber(object[name], null);
      if (number != null) return number !== 0;
    }
    return null;
  }

  function readSeatTargetState(seat) {
    const seatObject = getSeatObject(seat);
    const seatUi = seatObject && (seatObject.SeatUI || seatObject.seatUI);
    const objects = [seatObject, seatUi, seatUi && seatUi.seatAvatar, seatUi && seatUi.avatar, seatUi && seatUi.generalAvatar].filter(Boolean);
    for (const object of objects) {
      const selectable = readNamedBoolean(object, ['canSelect', 'CanSelect', 'canBeSelected', 'CanBeSelected', 'targetable', 'Targetable', 'isTarget', 'IsTarget']);
      if (selectable != null) return { known: true, targetable: selectable, source: 'seat-selectable-field' };
    }
    if (Date.now() < state.targetModeUntil && state.targetableSeats.includes(seat)) {
      return { known: true, targetable: true, source: state.targetSource || 'recent-target-message' };
    }
    return { known: false, targetable: false, source: '' };
  }

  function readAttackRange(seat) {
    const seatObject = getSeatObject(seat);
    const seatUi = seatObject && (seatObject.SeatUI || seatObject.seatUI);
    const candidates = [
      seatObject && seatObject.attackRange,
      seatObject && seatObject.AttackRange,
      seatObject && seatObject.atkRange,
      seatObject && seatObject.Range,
      seatUi && seatUi.attackRange,
      seatUi && seatUi.AttackRange,
      seatUi && seatUi.range,
    ];
    for (const value of candidates) {
      const number = toNumber(value, null);
      if (number != null && number > 0 && number < 20) return number;
    }
    return CONFIG.defaultAttackRange;
  }

  function normalizeNumberText(value) {
    return String(value ?? '').replace(/[０-９]/g, (digit) => String('０１２３４５６７８９'.indexOf(digit)));
  }

  function parseSlashCounterText(value) {
    const text = normalizeNumberText(value).replace(/\s+/g, '');
    const match = text.match(/(?:出)?杀次数[:：]?([0-9]+)[/／]([0-9]+)/);
    if (!match) return null;
    const remaining = toNumber(match[1], null);
    const limit = toNumber(match[2], null);
    if (remaining == null || limit == null || limit <= 0) return null;
    return {
      remaining: Math.max(0, Math.min(remaining, limit)),
      limit,
      raw: String(value),
    };
  }

  function readTextFromObject(object) {
    if (!object || typeof object !== 'object') return '';
    const keys = ['text', '_text', 'label', '_label', 'value', 'htmlText', '_htmlText'];
    for (const key of keys) {
      try {
        const value = object[key];
        if (typeof value === 'string' && value.trim()) return value;
      } catch {
      }
    }
    return '';
  }

  function findSlashCounterInObject(root, source, maxObjects = 1600) {
    if (!root || typeof root !== 'object') return null;
    const queue = [root];
    const seen = new Set();
    let visited = 0;
    while (queue.length && visited < maxObjects) {
      const item = queue.shift();
      if (!item || typeof item !== 'object' || seen.has(item)) continue;
      seen.add(item);
      visited += 1;
      const parsed = parseSlashCounterText(readTextFromObject(item));
      if (parsed) return { ...parsed, source };
      const children = Array.isArray(item._children) ? item._children : [];
      children.forEach((child) => {
        if (child && typeof child === 'object' && !seen.has(child)) queue.push(child);
      });
      Object.keys(item).slice(0, 80).forEach((key) => {
        if (/parent|stage|graphics|texture|bitmap|skin|url/i.test(key)) return;
        try {
          const value = item[key];
          if (value && typeof value === 'object' && !seen.has(value)) queue.push(value);
        } catch {
        }
      });
    }
    return null;
  }

  function getLayaGlobalPoint(object, x = 0, y = 0) {
    const Laya = window.Laya;
    if (!Laya || !object || typeof object.localToGlobal !== 'function') return null;
    try {
      const point = object.localToGlobal(new Laya.Point(x, y), true);
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
      return { x: Number(point.x), y: Number(point.y) };
    } catch {
      return null;
    }
  }

  function distanceBetween(left, right) {
    if (!left || !right) return Number.POSITIVE_INFINITY;
    const dx = Number(left.x) - Number(right.x);
    const dy = Number(left.y) - Number(right.y);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function collectSlashCounterCandidates(root, source, maxObjects = 4200) {
    if (!root || typeof root !== 'object') return [];
    const output = [];
    const queue = [root];
    const seen = new Set();
    let visited = 0;
    while (queue.length && visited < maxObjects) {
      const item = queue.shift();
      if (!item || typeof item !== 'object' || seen.has(item)) continue;
      seen.add(item);
      visited += 1;
      const parsed = parseSlashCounterText(readTextFromObject(item));
      if (parsed) {
        const center = getLayaGlobalPoint(item, Number(item.width || 0) / 2, Number(item.height || 0) / 2);
        output.push({ ...parsed, source, object: item, center });
      }
      const children = Array.isArray(item._children) ? item._children : [];
      children.forEach((child) => {
        if (child && typeof child === 'object' && !seen.has(child)) queue.push(child);
      });
    }
    return output;
  }

  function normalizeSlashUsage(raw, source) {
    if (!raw || typeof raw !== 'object') return null;
    const unlimited = raw.unlimited === true || raw.remain === Infinity || raw.max === Infinity;
    if (unlimited) {
      return {
        remaining: Infinity,
        limit: Infinity,
        used: toNumber(raw.used, 0) || 0,
        raw: 'Infinity',
        source,
      };
    }
    const limit = toNumber(raw.max ?? raw.limit, null);
    let used = toNumber(raw.used, null);
    let remaining = toNumber(raw.remain ?? raw.remaining, null);
    if (limit == null || limit < 0) return null;
    if (remaining == null && used != null) remaining = Math.max(0, limit - used);
    if (used == null && remaining != null) used = Math.max(0, limit - remaining);
    if (remaining == null || used == null) return null;
    return {
      remaining: Math.max(0, Math.min(remaining, limit)),
      limit,
      used: Math.max(0, used),
      raw: `${Math.max(0, Math.min(remaining, limit))}/${limit}`,
      source,
    };
  }

  function readJndShaUsageState(seat) {
    const jnd = window.__JND;
    if (!jnd || typeof jnd.getShaUsageState !== 'function' || !isRealSeat(seat)) return null;
    try {
      return normalizeSlashUsage(jnd.getShaUsageState(seat), 'jnd:getShaUsageState');
    } catch {
      return null;
    }
  }

  function pushObjectCandidate(list, object, label) {
    if (!object || typeof object !== 'object') return;
    list.push({ object, label });
  }

  function callObjectGetter(owner, name, args = []) {
    if (!owner || typeof owner[name] !== 'function') return null;
    try {
      return owner[name].apply(owner, args);
    } catch {
      return null;
    }
  }

  function getJndObjectCandidates(seat) {
    const jnd = window.__JND;
    const candidates = [];
    if (!jnd || typeof jnd !== 'object') return candidates;

    [
      'getSeatObject', 'seatObject', 'getSeat', 'findSeatObject', 'findSeat',
      'getSeatUi', 'getSeatUI', 'seatUi', 'seatUI',
      'getSeatAvatar', 'seatAvatar',
    ].forEach((name) => pushObjectCandidate(candidates, callObjectGetter(jnd, name, [seat]), `jnd.${name}`));

    const box = jnd._box;
    if (box && typeof box === 'object') {
      [
        'getSeatObject', 'seatObject', 'getSeat', 'findSeatObject', 'findSeat',
        'getSeatUi', 'getSeatUI', 'seatUi', 'seatUI',
        'getSeatAvatar', 'seatAvatar',
      ].forEach((name) => pushObjectCandidate(candidates, callObjectGetter(box, name, [seat]), `jnd._box.${name}`));
      ['comboLayer', 'seatComboLayer', 'seatLayer', 'gameLayer'].forEach((name) => {
        pushObjectCandidate(candidates, callObjectGetter(box, name), `jnd._box.${name}`);
      });
    }

    return candidates;
  }

  function readJndSlashCounter(seat) {
    const jnd = window.__JND;
    if (!jnd || typeof jnd !== 'object') return null;
    const candidates = getJndObjectCandidates(seat);
    for (const candidate of candidates.filter((item) => !/Layer|comboLayer|seatLayer|gameLayer/i.test(item.label))) {
      const found = findSlashCounterInObject(candidate.object, candidate.label);
      if (found) return { ...found, source: `jnd:${found.source}` };
    }

    const avatar = findSeatAvatar(seat);
    const avatarCenter = avatar ? getLayaGlobalPoint(avatar, Number(avatar.width || 0) / 2, Number(avatar.height || 0) / 2) : null;
    if (!avatarCenter) return null;
    const layerCandidates = candidates
      .filter((candidate) => /Layer|comboLayer|seatLayer|gameLayer/i.test(candidate.label))
      .flatMap((candidate) => collectSlashCounterCandidates(candidate.object, `jnd:${candidate.label}`, 2600));
    if (!layerCandidates.length) return null;
    layerCandidates.sort((left, right) => distanceBetween(left.center, avatarCenter) - distanceBetween(right.center, avatarCenter));
    const best = layerCandidates[0];
    const bestDistance = distanceBetween(best.center, avatarCenter);
    if (!Number.isFinite(bestDistance) || bestDistance > 260) return null;
    return {
      remaining: best.remaining,
      limit: best.limit,
      raw: best.raw,
      source: `${best.source}:${Math.round(bestDistance)}`,
    };
  }

  function readSelfSlashCounter(seat) {
    const jndUsage = readJndShaUsageState(seat);
    if (jndUsage) return jndUsage;

    const localUsage = normalizeSlashUsage(state.slashUsageBySeat[seat], 'local:roleData:id=1');
    if (localUsage) return localUsage;

    const jndCounter = readJndSlashCounter(seat);
    if (jndCounter) return jndCounter;

    const seatObject = getSeatObject(seat);
    const seatUi = seatObject && (seatObject.SeatUI || seatObject.seatUI);
    const direct = [
      findSlashCounterInObject(seatObject, 'self-seat-object'),
      findSlashCounterInObject(seatUi, 'self-seat-ui'),
    ].find(Boolean);
    if (direct) return direct;

    if (!CONFIG.enableStageTextSlashCounter) return null;
    const stage = window.Laya && window.Laya.stage;
    const avatar = findSeatAvatar(seat);
    const avatarCenter = avatar ? getLayaGlobalPoint(avatar, Number(avatar.width || 0) / 2, Number(avatar.height || 0) / 2) : null;
    const candidates = collectSlashCounterCandidates(stage, 'nearest-stage-text');
    if (!candidates.length) return null;
    candidates.sort((left, right) => distanceBetween(left.center, avatarCenter) - distanceBetween(right.center, avatarCenter));
    const best = candidates[0];
    return best ? {
      remaining: best.remaining,
      limit: best.limit,
      raw: best.raw,
      source: `${best.source}:${Math.round(distanceBetween(best.center, avatarCenter))}`,
    } : null;
  }

  function objectLooksWeapon(object) {
    if (!object || typeof object !== 'object') return false;
    const name = normalizeCardName(extractCardName(object));
    if (WEAPON_NAMES.has(name)) return true;
    if (name && EQUIPMENT_NAMES.has(name) && !WEAPON_NAMES.has(name)) return false;
    const id = object.id ?? object.cardId ?? object.cardID ?? object.CardId ?? object.cid;
    const hasRealCardIdentity = name || (id != null && String(id) !== '' && String(id) !== '0' && String(id) !== '-1');
    if (!hasRealCardIdentity) return false;
    const typeText = String(
      object.equipType
      ?? object.EquipType
      ?? object.weaponType
      ?? object.WeaponType
      ?? object.typeName
      ?? object.cardTypeName
      ?? object.type
      ?? object.cardType
      ?? ''
    ).toLowerCase();
    return /weapon|武器/.test(typeText) && !/slot|empty|none|空/.test(typeText);
  }

  function describeWeaponCandidate(object) {
    if (!object || typeof object !== 'object') return null;
    const name = normalizeCardName(extractCardName(object));
    const id = object.id ?? object.cardId ?? object.cardID ?? object.CardId ?? object.cid ?? null;
    const type = object.equipType ?? object.EquipType ?? object.weaponType ?? object.WeaponType ?? object.typeName ?? object.cardTypeName ?? object.type ?? object.cardType ?? '';
    return {
      name,
      id,
      type: String(type || ''),
      ctor: getClassName(object),
      weapon: objectLooksWeapon(object),
    };
  }

  function candidateHasCardName(candidate, expectedName) {
    if (!candidate) return false;
    return [candidate, candidate.theCard, candidate.card, candidate.cardData, candidate.data]
      .filter(Boolean)
      .some((item) => normalizeCardName(extractCardName(item)) === expectedName);
  }

  function readSeatHasEquippedCard(seat, expectedName) {
    const seatObject = getSeatObject(seat);
    const seatUi = seatObject && (seatObject.SeatUI || seatObject.seatUI);
    const directCandidates = [
      seatObject && seatObject.weapon,
      seatObject && seatObject.Weapon,
      seatObject && seatObject.weaponCard,
      seatObject && seatObject.WeaponCard,
      seatUi && seatUi.weapon,
      seatUi && seatUi.weaponCard,
    ].filter(Boolean);
    if (directCandidates.some((item) => candidateHasCardName(item, expectedName))) return true;

    const equipLists = [
      seatObject && seatObject.equipCardUIs,
      seatObject && seatObject.equipCards,
      seatObject && seatObject.Equips,
      seatObject && seatObject.equips,
      seatUi && seatUi.equipCardUIs,
      seatUi && seatUi.equipCards,
    ].filter(Array.isArray);
    return equipLists.some((list) => list.some((item) => candidateHasCardName(item, expectedName)));
  }

  function readSeatHasWeapon(seat) {
    const seatObject = getSeatObject(seat);
    const seatUi = seatObject && (seatObject.SeatUI || seatObject.seatUI);
    const directCandidates = [
      seatObject && seatObject.weapon,
      seatObject && seatObject.Weapon,
      seatObject && seatObject.weaponCard,
      seatObject && seatObject.WeaponCard,
      seatUi && seatUi.weapon,
      seatUi && seatUi.weaponCard,
    ].filter(Boolean);
    if (directCandidates.some((item) => objectLooksWeapon(item) || objectLooksWeapon(item.theCard) || objectLooksWeapon(item.card) || objectLooksWeapon(item.data))) return true;

    const equipLists = [
      seatObject && seatObject.equipCardUIs,
      seatObject && seatObject.equipCards,
      seatObject && seatObject.Equips,
      seatObject && seatObject.equips,
      seatUi && seatUi.equipCardUIs,
      seatUi && seatUi.equipCards,
    ].filter(Array.isArray);

    for (const list of equipLists) {
      for (const item of list) {
        if (!item) continue;
        const itemName = normalizeCardName(extractCardName(item));
        if (itemName && EQUIPMENT_NAMES.has(itemName) && !WEAPON_NAMES.has(itemName)) continue;
        if (objectLooksWeapon(item.theCard) || objectLooksWeapon(item.card) || objectLooksWeapon(item.data) || objectLooksWeapon(item)) {
          return true;
        }
      }
    }
    return false;
  }

  function readSeatWeaponDebug(seat) {
    const seatObject = getSeatObject(seat);
    const seatUi = seatObject && (seatObject.SeatUI || seatObject.seatUI);
    const items = [];
    [
      seatObject && seatObject.weapon,
      seatObject && seatObject.Weapon,
      seatObject && seatObject.weaponCard,
      seatObject && seatObject.WeaponCard,
      seatUi && seatUi.weapon,
      seatUi && seatUi.weaponCard,
    ].filter(Boolean).forEach((item) => {
      items.push(describeWeaponCandidate(item));
      items.push(describeWeaponCandidate(item.theCard || item.card || item.data));
    });
    [
      seatObject && seatObject.equipCardUIs,
      seatObject && seatObject.equipCards,
      seatObject && seatObject.Equips,
      seatObject && seatObject.equips,
      seatUi && seatUi.equipCardUIs,
      seatUi && seatUi.equipCards,
    ].filter(Array.isArray).forEach((list) => {
      list.forEach((item) => {
        items.push(describeWeaponCandidate(item));
        items.push(describeWeaponCandidate(item && (item.theCard || item.card || item.data)));
      });
    });
    return items.filter(Boolean).slice(0, 16);
  }

  function buildSeatRows() {
    const selfSeat = getSelfSeat();
    const activeSeats = getSeatOrder();
    return activeSeats.map((seat) => {
      const targetState = readSeatTargetState(seat);
      const dead = state.deadSeats.includes(seat);
      const rawDistance = readDirectDistance(selfSeat, seat);
      const fullBaseDistance = computeCircularDistance(selfSeat, seat, activeSeats);
      const aliveBaseDistance = dead
        ? null
        : computeCircularDistance(selfSeat, seat, activeSeats.filter((item) => !state.deadSeats.includes(item)));
      return {
        seat,
        dead,
        distance: computeAliveSeatDistance(selfSeat, seat, activeSeats, state.deadSeats, rawDistance),
        rawDistance,
        fullBaseDistance,
        aliveBaseDistance,
        distanceModifier: rawDistance == null || fullBaseDistance == null ? 0 : rawDistance - fullBaseDistance,
        targetKnown: targetState.known,
        targetable: targetState.targetable,
        targetSource: targetState.source,
        hasWeapon: readSeatHasWeapon(seat),
        weaponDebug: readSeatWeaponDebug(seat),
      };
    });
  }

  function readStringFields(object, keys) {
    if (!object || typeof object !== 'object') return '';
    for (const key of keys) {
      const value = object[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function extractCardName(raw) {
    if (!raw || typeof raw !== 'object') return '';
    const direct = readStringFields(raw, ['name', 'Name', 'cardName', 'CardName', 'card_name', 'showName', 'ShowName']);
    if (direct) return direct;
    for (const key of ['theCard', 'card', 'data', 'info', 'config', 'cardInfo']) {
      const nested = raw[key];
      const nestedName = readStringFields(nested, ['name', 'Name', 'cardName', 'CardName', 'showName']);
      if (nestedName) return nestedName;
    }
    return '';
  }

  function summarizeCardRaw(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const summary = {};
    [
      'id', 'cardId', 'cardID', 'CardId', 'cid', 'name', 'Name', 'cardName', 'CardName',
      'cardType', 'type', 'typeName', 'cardTypeName', 'cardFlower', 'suit', 'number', 'point'
    ].forEach((key) => {
      if (raw[key] !== undefined && typeof raw[key] !== 'object') summary[key] = raw[key];
    });
    try {
      summary.__ctor = raw.constructor && raw.constructor.name || '';
    } catch {
    }
    return summary;
  }

  function parseCard(raw, ui, index) {
    const card = raw || {};
    return {
      index,
      ui: ui || null,
      raw,
      id: card.id ?? card.cardId ?? card.cardID ?? card.CardId ?? card.cid ?? null,
      name: extractCardName(card) || extractCardName(ui) || '',
      suit: card.cardFlower ?? card.suit ?? card.Suit ?? null,
      number: card.number ?? card.point ?? card.CardPoint ?? null,
      type: card.type ?? card.cardType ?? card.CardType ?? null,
      typeName: card.typeName ?? card.cardTypeName ?? card.TypeName ?? '',
      rawSummary: summarizeCardRaw(card),
    };
  }

  function readVisibleHandCards() {
    const container = getCardContainer();
    const cardUis = container && Array.isArray(container.cardUis) ? container.cardUis : [];
    if (!cardUis.length) return [];
    return cardUis.map((ui, index) => parseCard(ui && (ui.theCard || ui.card || ui.cardData || ui.data), ui, index));
  }

  function parseHandFromPayload(payload) {
    const rawCards = payload && (payload.cards || payload.cardIds || payload.handCards || payload.handcards || payload.cardList);
    if (!Array.isArray(rawCards)) return [];
    return rawCards.map((item, index) => typeof item === 'object' ? parseCard(item, null, index) : {
      index,
      ui: null,
      raw: item,
      id: item,
      name: '',
      suit: null,
      number: null,
      type: null,
      typeName: '',
      rawSummary: { id: item },
    });
  }

  function textContainsAny(value, needles, depth = 0, seen = new Set()) {
    if (depth > 4 || value == null) return false;
    if (typeof value === 'string') return needles.some((needle) => value.includes(needle));
    if (typeof value === 'number' || typeof value === 'boolean') return false;
    if (typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some((item) => textContainsAny(item, needles, depth + 1, seen));
    return Object.keys(value).some((key) => {
      if (needles.some((needle) => key.includes(needle))) return true;
      try {
        return textContainsAny(value[key], needles, depth + 1, seen);
      } catch {
        return false;
      }
    });
  }

  function getSkillIdList(payload) {
    const raw = payload && (payload.spellIds || payload.skillIds || payload.spells || payload.skills || payload.Spells);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => typeof item === 'number' || typeof item === 'string'
        ? toNumber(item, null)
        : toNumber(item && (item.spellId ?? item.skillId ?? item.id), null))
      .filter((item) => item != null);
  }

  function cacheSkillNames(payload) {
    const seen = new Set();
    function walk(value, depth) {
      if (depth > 4 || value == null || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      const id = toNumber(value.spellId ?? value.skillId ?? value.id, null);
      const name = value.Name || value.name || value.skillName || value.spellName;
      if (id != null && typeof name === 'string' && name) {
        state.skillNamesById[id] = name;
        if (CONFIG.skillNames.includes(name) && CONFIG.skillIds.juxi == null) CONFIG.skillIds.juxi = id;
      }
      Object.keys(value).forEach((key) => {
        try {
          walk(value[key], depth + 1);
        } catch {
        }
      });
    }
    walk(payload, 0);
  }

  function handleSkillListMessage(type, payload) {
    if (!['MsgSetCharacterSpell', 'MsgAddCharacterSpell', 'MsgRemoveCharacterSpell'].includes(type)) return;
    const seat = toNumber(payload && (payload.seat ?? payload.ownerSeat ?? payload.srcSeat), null);
    if (!isRealSeat(seat)) return;
    if (!state.seatSkills[seat]) state.seatSkills[seat] = [];
    const ids = getSkillIdList(payload);
    if (type === 'MsgRemoveCharacterSpell') {
      state.seatSkills[seat] = state.seatSkills[seat].filter((id) => !ids.includes(id));
    } else {
      state.seatSkills[seat] = Array.from(new Set([...state.seatSkills[seat], ...ids]));
    }
  }

  function readSelfCharacterEvidence() {
    const selfSeat = getSelfSeat();
    const seatObject = getSeatObject(selfSeat);
    const id = toNumber(seatObject && (seatObject.GeneralId ?? seatObject.generalId ?? seatObject.characterId ?? seatObject.CharacterId), null);
    if (CONFIG.characterIds.mouDengAi != null && id === Number(CONFIG.characterIds.mouDengAi)) {
      return { ok: true, reason: `角色ID=${id}` };
    }

    const skillIds = state.seatSkills[selfSeat] || [];
    const skillNames = skillIds.map((skillId) => state.skillNamesById[skillId] || '').filter(Boolean);
    if (skillIds.includes(Number(CONFIG.skillIds.juxi)) || skillNames.some((name) => CONFIG.skillNames.includes(name))) {
      return { ok: true, reason: `技能=${skillNames.join('/') || CONFIG.skillIds.juxi}` };
    }

    if (textContainsAny(seatObject, CONFIG.characterNames)) return { ok: true, reason: '座位角色名包含谋邓艾' };
    if (textContainsAny(seatObject, CONFIG.skillNames)) return { ok: true, reason: '座位技能名包含骤袭' };
    return { ok: false, reason: selfSeat == null ? '未识别自己座位' : '未识别谋邓艾/骤袭' };
  }

  function extractSeatList(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => toNumber((item && (item.seat ?? item.seatId ?? item.SeatId)) ?? item, null))
      .filter(isRealSeat);
  }

  function updateTargetableSeatsFromPayload(type, payload) {
    if (!payload || typeof payload !== 'object') return;
    if (type === 'MsgRoleOptNtf') {
      state.targetableSeats = [];
      state.targetSource = '';
      state.targetModeUntil = 0;
      return;
    }
    if (type !== 'MsgRoleOptTargetNtf') return;
    const targetSeats = [
      ...extractSeatList(payload.targets),
      ...extractSeatList(payload.target),
      toNumber(payload.targetSeat ?? payload.targetSeatID, null),
    ].filter(isRealSeat);
    if (targetSeats.length) {
      state.targetableSeats = Array.from(new Set(targetSeats));
      state.targetSource = `MsgRoleOptTargetNtf:${payload.spellId ?? ''}:${payload.optType ?? ''}`;
      state.targetModeUntil = Date.now() + 4500;
    }
  }

  function markDeadSeat(value) {
    const seat = toNumber(value, null);
    if (isRealSeat(seat) && !state.deadSeats.includes(seat)) {
      state.deadSeats.push(seat);
      state.deadSeats.sort((left, right) => left - right);
    }
  }

  function collectSeatsFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return;
    ['seat', 'srcSeat', 'ownerSeat', 'userSeat', 'waitSeat', 'optSeat', 'targetSeat', 'targetSeatID', 'currentSeat', 'turnSeat', 'actionSeatId'].forEach((key) => {
      if (payload[key] !== undefined) rememberKnownSeat(payload[key]);
    });
    if (Array.isArray(payload.gameUserActionOrderList)) {
      state.actionSeats = Array.from(new Set(payload.gameUserActionOrderList.map((item) => toNumber(item?.actionSeatId ?? item?.seat ?? item, null)).filter(isRealSeat)));
      state.actionSeats.forEach(rememberKnownSeat);
    }
  }

  function resetTurnState() {
    state.slashUsedThisTurn = 0;
  }

  function setSlashUsageFromRoleData(payload) {
    if (!payload || toNumber(payload.id, null) !== 1 || !Array.isArray(payload.data)) return false;
    const seat = toNumber(payload.seat, null);
    if (!isRealSeat(seat)) return false;
    const used = toNumber(payload.data[1], null);
    const limit = toNumber(payload.data[2], null);
    if (used == null || limit == null || limit < 0) return false;
    const remaining = Math.max(0, limit - used);
    state.slashUsageBySeat[seat] = {
      seat,
      used: Math.max(0, used),
      limit,
      remaining,
      updatedAt: Date.now(),
      source: 'MsgUpdateRoleDataExNtf:id=1',
    };
    return true;
  }

  function payloadBelongsToSelf(payload) {
    const selfSeat = getSelfSeat();
    const seat = toNumber(payload && (payload.srcSeat ?? payload.userSeat ?? payload.ownerSeat ?? payload.seat), null);
    return selfSeat != null && seat === selfSeat;
  }

  function payloadCardName(payload) {
    return normalizeCardName(payload && (
      payload.cardName || payload.name || payload.Name || payload.card?.name || payload.card?.cardName
    ));
  }

  function payloadHasJuxiSource(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const juxiId = Number(CONFIG.skillIds.juxi);
    return [
      payload.sourceSpellId,
      payload.sourceSkillId,
      payload.reasonSpellId,
      payload.reasonSkillId,
      payload.parentSpellId,
      payload.parentSkillId,
      payload.fromSpellId,
      payload.fromSkillId,
      payload.triggerSpellId,
      payload.triggerSkillId,
    ].some((value) => toNumber(value, null) === juxiId);
  }

  function payloadLooksLikeSlashUse(type, payload) {
    if (type !== 'MsgUseCard') return false;
    if (!payloadBelongsToSelf(payload)) return false;
    if (payloadLooksLikeJuxiSkill(payload) || payloadHasJuxiSource(payload)) return false;
    if (isSlashName(payloadCardName(payload))) return true;
    const spellId = toNumber(payload && (payload.spellId ?? payload.SpellId), null);
    if (spellId !== 1) return false;
    return true;
  }

  function applySlashUseFromMessage(type, payload) {
    if (!payloadLooksLikeSlashUse(type, payload)) return false;
    const seat = payloadSeat(payload);
    const usage = state.slashUsageBySeat[seat];
    if (usage && Number.isFinite(Number(usage.remaining))) {
      usage.used = Math.max(0, Number(usage.used || 0) + 1);
      usage.remaining = Math.max(0, Number(usage.remaining || 0) - 1);
      usage.updatedAt = Date.now();
      usage.source = 'MsgUseCard:spellId=1';
    } else {
      state.slashUsageBySeat[seat] = {
        seat,
        used: 1,
        limit: CONFIG.slashLimit,
        remaining: Math.max(0, CONFIG.slashLimit - 1),
        updatedAt: Date.now(),
        source: 'MsgUseCard:spellId=1:fallback',
      };
    }
    return true;
  }

  function payloadSeat(payload) {
    return toNumber(payload && (
      payload.srcSeat
      ?? payload.userSeat
      ?? payload.ownerSeat
      ?? payload.optSeat
      ?? payload.spellCasterSeat
      ?? payload.seat
      ?? payload.fromSeat
      ?? payload.currentSeat
    ), null);
  }

  function payloadSkillId(payload) {
    return toNumber(payload && (
      payload.spellId
      ?? payload.skillId
      ?? payload.id
      ?? payload.SpellId
      ?? payload.SkillId
    ), null);
  }

  function payloadLooksLikeJuxiSkill(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const id = payloadSkillId(payload);
    if (CONFIG.skillIds.juxi != null && id === Number(CONFIG.skillIds.juxi)) return true;
    const name = String(payload.skillName || payload.spellName || payload.name || payload.Name || payload.skill?.name || payload.spell?.name || '');
    if (CONFIG.skillNames.some((skillName) => name.includes(skillName))) return true;
    return textContainsAny(payload, CONFIG.skillNames, 0, new Set());
  }

  function countCardArrayField(payload, keys) {
    if (!payload || typeof payload !== 'object') return null;
    for (const key of keys) {
      const value = payload[key];
      if (Array.isArray(value)) return value.length;
    }
    return null;
  }

  function extractJuxiDiscardCount(type, payload) {
    const skillId = payloadSkillId(payload);
    const optType = toNumber(payload && payload.optType, null);
    if (
      /(?:^|\.)MsgRoleOptTargetNtf$/.test(String(type || ''))
      && skillId === Number(CONFIG.skillIds.juxi)
      && optType === 28
    ) {
      const count = toNumber(payload && payload.param, null);
      if (count != null) return Math.max(0, Math.min(3, count));
    }

    const direct = countCardArrayField(payload, [
      'discardCards', 'discardCardIds', 'discardCardIDs', 'discardIds',
      'dropCards', 'dropCardIds', 'dropIds',
      'throwCards', 'throwCardIds',
    ]);
    if (direct != null) return direct;

    const directCount = toNumber(payload && (
      payload.discardCount
      ?? payload.dropCount
      ?? payload.throwCount
    ), null);
    if (directCount != null) return Math.max(0, directCount);

    if (typeLooksDiscard(type, payload)) {
      const moved = countCardArrayField(payload, ['cards', 'cardIds', 'cardIDs', 'datas']);
      if (moved != null) return moved;
      const cardCount = toNumber(payload.cardCnt ?? payload.cardCount, null);
      if (cardCount != null) return Math.max(0, cardCount);
      const singleCard = payload.cardId ?? payload.cardID ?? payload.card ?? payload.theCard;
      if (singleCard != null) return 1;
    }
    return null;
  }

  function typeLooksDiscard(type, payload) {
    const text = `${type || ''} ${payload && (payload.reason || payload.action || payload.name || payload.Name || '') || ''}`;
    return /discard|drop|throw|弃|棄/i.test(text);
  }

  function seatLooksMouDengAiOrJuxi(seat) {
    if (!isRealSeat(seat)) return false;
    const skillIds = state.seatSkills[seat] || [];
    const skillNames = skillIds.map((skillId) => state.skillNamesById[skillId] || '').filter(Boolean);
    if (CONFIG.skillIds.juxi != null && skillIds.includes(Number(CONFIG.skillIds.juxi))) return true;
    if (skillNames.some((name) => CONFIG.skillNames.includes(name))) return true;
    const seatObject = getSeatObject(seat);
    return textContainsAny(seatObject, CONFIG.characterNames) || textContainsAny(seatObject, CONFIG.skillNames);
  }

  function markJuxiInvalid(seat, count, source) {
    if (!isRealSeat(seat)) return;
    state.juxiInvalidMarks[seat] = {
      seat,
      count: Number(count) || 0,
      source: source || '',
      at: Date.now(),
      turnSeat: seat,
    };
    state.lastStatus = `座位${seat} 骤袭已失效`;
  }

  function clearJuxiInvalid(seat) {
    if (!isRealSeat(seat)) return;
    delete state.pendingJuxiBySeat[seat];
    delete state.juxiInvalidMarks[seat];
    try {
      window.SGS91Assistant?.getService?.('seatOverlay')?.clear?.(`${CONFIG.invalidStripPrefix}${seat}`);
    } catch {
    }
    try {
      if (window.__JND && typeof window.__JND.clearSeatSkillStrip === 'function') {
        window.__JND.clearSeatSkillStrip(`${CONFIG.invalidStripPrefix}${seat}`);
      }
    } catch {
    }
  }

  function clearJuxiInvalidAtTurnEnd(previousTurnSeat, nextTurnSeat) {
    if (!isRealSeat(previousTurnSeat) || !isRealSeat(nextTurnSeat) || previousTurnSeat === nextTurnSeat) return;
    clearJuxiInvalid(previousTurnSeat);
  }

  function clearAllJuxiInvalid() {
    const seats = new Set([
      ...Object.keys(state.pendingJuxiBySeat),
      ...Object.keys(state.juxiInvalidMarks),
    ]);
    seats.forEach((seat) => clearJuxiInvalid(toNumber(seat, null)));
  }

  function handleJuxiInvalidTracking(type, payload) {
    const seat = payloadSeat(payload);
    if (!isRealSeat(seat)) return;
    const now = Date.now();
    Object.keys(state.pendingJuxiBySeat).forEach((key) => {
      const pending = state.pendingJuxiBySeat[key];
      if (!pending || pending.until < now) delete state.pendingJuxiBySeat[key];
    });

    if (payloadLooksLikeJuxiSkill(payload)) {
      const count = extractJuxiDiscardCount(type, payload);
      if (count != null) {
        if (count < 3) markJuxiInvalid(seat, count, `${type}:skill-payload`);
        else clearJuxiInvalid(seat);
        return;
      }
      state.pendingJuxiBySeat[seat] = {
        seat,
        at: now,
        until: now + 3500,
        source: type || '',
      };
      return;
    }

    const pending = state.pendingJuxiBySeat[seat];
    if (!pending || pending.until < now || !typeLooksDiscard(type, payload)) return;
    const count = extractJuxiDiscardCount(type, payload);
    if (count == null) return;
    if (count < 3) markJuxiInvalid(seat, count, `${type}:after-juxi`);
    else clearJuxiInvalid(seat);
    delete state.pendingJuxiBySeat[seat];
  }

  function remember(type, payload) {
    state.lastMessage = type || 'unknown';
    state.hookStatus.lastMessageAt = new Date().toISOString();
    const entry = {
      at: state.hookStatus.lastMessageAt,
      type,
      summary: shallowSummary(payload),
    };
    state.recent.push(entry);
    if (state.recent.length > 200) state.recent.shift();
    if (
      ['MsgUseCard', 'MsgGameHandCardNtf', 'MsgGamePlayCardNtf', 'MsgSetGamePhaseNtf', 'MsgGameTurnNtf', 'MsgRoleOptTargetNtf', 'MsgSetCharacterSpell', 'MsgAddCharacterSpell'].includes(type)
      || payloadLooksLikeJuxiSkill(payload)
      || typeLooksDiscard(type, payload)
    ) {
      state.importantRecent.push({ ...entry, detail: cloneDiagnostic(payload) });
      if (state.importantRecent.length > 80) state.importantRecent.shift();
    }
  }

  function shallowSummary(payload) {
    const summary = {};
    [
      'seat', 'srcSeat', 'ownerSeat', 'userSeat', 'currentSeat', 'turnSeat', 'phase',
      'optSeat', 'spellCasterSeat', 'optType', 'param',
      'spellId', 'skillId', 'cardId', 'cardID', 'cardName', 'name', 'targets', 'target',
      'targetSeat', 'targetSeatID', 'cards', 'cardIds', 'discardCards', 'discardCardIds', 'reason', 'action'
    ].forEach((key) => {
      if (payload && payload[key] !== undefined) summary[key] = payload[key];
    });
    return summary;
  }

  function cloneDiagnostic(value, depth = 0, seen = new Set()) {
    if (depth > 3 || value == null) return value == null ? value : String(value);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => cloneDiagnostic(item, depth + 1, seen));
    const output = {};
    try {
      output.__ctor = value.constructor && value.constructor.name || '';
    } catch {
    }
    Object.keys(value).slice(0, 80).forEach((key) => {
      try {
        output[key] = cloneDiagnostic(value[key], depth + 1, seen);
      } catch {
        output[key] = '[Unreadable]';
      }
    });
    return output;
  }

  function onMessage(type, payload) {
    if (!type) return;
    payload = payload || {};
    remember(type, payload);
    cacheSkillNames(payload);
    handleSkillListMessage(type, payload);
    collectSeatsFromPayload(payload);
    updateTargetableSeatsFromPayload(type, payload);
    handleJuxiInvalidTracking(type, payload);
    if (type === 'MsgUpdateRoleDataExNtf') setSlashUsageFromRoleData(payload);

    if (type === 'MsgDealCharacters') {
      clearAllJuxiInvalid();
      state.deadSeats = [];
      resetTurnState();
    }
    if (type === 'MsgGameTurnNtf') {
      const nextTurnSeat = toNumber(payload.currentSeat ?? payload.turnSeat ?? payload.seat ?? payload.srcSeat, state.currentTurnSeat);
      clearJuxiInvalidAtTurnEnd(state.currentTurnSeat, nextTurnSeat);
      state.currentTurnSeat = nextTurnSeat;
      resetTurnState();
    }
    if (type === 'MsgSetGamePhaseNtf') {
      state.currentPhase = normalizePhase(payload.phase);
      const phaseSeat = toNumber(payload.currentSeat ?? payload.turnSeat ?? payload.seat ?? payload.srcSeat ?? payload.userSeat, null);
      if (isRealSeat(phaseSeat)) state.currentTurnSeat = phaseSeat;
      if (state.currentPhase === 'play') resetTurnState();
    }
    if (type === 'MsgGamePlayerDead') markDeadSeat(payload.srcSeat ?? payload.seat);
    if ((type === 'MsgGameHandCardNtf' || type === 'MsgGamePlayCardNtf') && state.selfSeat == null) {
      const seat = toNumber(payload.seat ?? payload.userSeat, null);
      if (isRealSeat(seat)) state.selfSeat = seat;
    }
    if (applySlashUseFromMessage(type, payload)) {
      state.slashUsedThisTurn = Math.max(state.slashUsedThisTurn, 0) + 1;
    }
    updateStateFromGame();
    renderAll();
  }

  function updateStateFromGame() {
    state.selfSeat = getSelfSeat();
    const managerTurnSeat = getCurrentTurnSeat();
    if (isRealSeat(managerTurnSeat)) state.currentTurnSeat = managerTurnSeat;
    state.attackRange = readAttackRange(state.selfSeat);
    state.hasZhugeCrossbowEquipped = readSeatHasEquippedCard(state.selfSeat, '诸葛连弩');
    const slashCounter = readSelfSlashCounter(state.selfSeat);
    if (slashCounter) {
      state.slashRemainingThisTurn = slashCounter.remaining;
      state.slashLimit = slashCounter.limit;
      state.slashUsedThisTurn = Number.isFinite(Number(slashCounter.limit)) && Number.isFinite(Number(slashCounter.remaining))
        ? Math.max(0, slashCounter.limit - slashCounter.remaining)
        : Math.max(0, Number(slashCounter.used || 0));
      state.slashCounterSource = slashCounter.source;
    } else {
      state.slashRemainingThisTurn = null;
      state.slashCounterSource = 'message-counter';
    }
    const evidence = readSelfCharacterEvidence();
    state.selfIsMouDengAi = evidence.ok;
    state.characterEvidence = evidence.reason;

    const visibleCards = readVisibleHandCards();
    if (visibleCards.length) state.handCards = visibleCards;

    const rows = buildSeatRows();
    const isOwnTurn = state.selfSeat != null && state.currentTurnSeat === state.selfSeat;
    const result = evaluateJuxi(state.handCards, {
      isMouDengAi: state.selfIsMouDengAi,
      isOwnTurn,
      currentPhase: state.currentPhase,
      selfSeat: state.selfSeat,
      attackRange: state.attackRange,
      slashUsedThisTurn: state.slashUsedThisTurn,
      slashRemainingThisTurn: state.slashRemainingThisTurn,
      slashLimit: state.slashLimit,
      hasZhugeCrossbowEquipped: state.hasZhugeCrossbowEquipped,
      seats: rows,
    });
    state.judgedCards = result.judgedCards;
    state.unavailableCount = result.unavailableCount;
    state.isOwnPlayPhase = result.isOwnPlayPhase;
    state.canUseJuxi = result.canUseJuxi;
    state.lastStatus = state.selfIsMouDengAi
      ? !result.isOwnPlayPhase ? '非自己出牌阶段' : result.canUseJuxi ? '骤袭可用' : '继续观察'
      : '未识别谋邓艾';
  }

  function injectStyle() {
    if (document.getElementById('mda-juxi-style')) return;
    const style = document.createElement('style');
    style.id = 'mda-juxi-style';
    style.textContent = `
      #${CONFIG.domSeatStripId} {
        position: fixed;
        z-index: 99998;
        height: 24px;
        min-width: 96px;
        padding: 0 6px;
        box-sizing: border-box;
        background: rgba(43, 43, 43, 0.94);
        border: 1px solid #d8b45f;
        color: #f4d17b;
        font-family: "FZBW", sans-serif;
        font-size: ${CONFIG.seatStripFontSize}px;
        font-weight: 700;
        line-height: 22px;
        text-align: center;
        pointer-events: none;
        text-shadow: 0 1px 2px #000;
      }
    `;
    document.head.appendChild(style);
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function getLayaClientPoint(object, x = 0, y = 0) {
    const Laya = window.Laya;
    if (!Laya || !object || typeof object.localToGlobal !== 'function') return null;
    try {
      const point = getLayaGlobalPoint(object, x, y);
      if (!point) return null;
      const canvas = Laya.stage && (Laya.stage.canvas || Laya.stage._canvas);
      const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const stageWidth = Number(Laya.stage && Laya.stage.width) || rect.width || window.innerWidth;
      const stageHeight = Number(Laya.stage && Laya.stage.height) || rect.height || window.innerHeight;
      return {
        x: rect.left + point.x * (rect.width / stageWidth),
        y: rect.top + point.y * (rect.height / stageHeight),
      };
    } catch {
      return null;
    }
  }

  function clearCardBadges() {
    if (layaCardBadgeLayer) {
      try {
        layaCardBadgeLayer.removeSelf();
      } catch {
      }
      layaCardBadgeLayer = null;
    }
    const container = getCardContainer();
    const cardUis = container && Array.isArray(container.cardUis) ? container.cardUis : [];
    cardUis.forEach((ui) => {
      if (!ui || !Array.isArray(ui._children)) return;
      ui._children.slice().forEach((child) => {
        if (child && child.name === 'mda-juxi-card-badge-laya') {
          try {
            child.removeSelf();
          } catch {
          }
        }
      });
    });
  }

  function drawRoundRect(graphics, width, height, radius, fillStyle) {
    if (!graphics) return false;
    const safeWidth = Math.max(0, Number(width) || 0);
    const safeHeight = Math.max(0, Number(height) || 0);
    const safeRadius = Math.max(0, Math.min(Number(radius) || 0, Math.min(safeWidth, safeHeight) / 2));
    if (!safeRadius || typeof graphics.drawPath !== 'function') {
      graphics.drawRect?.(0, 0, safeWidth, safeHeight, fillStyle);
      return true;
    }
    try {
      graphics.drawPath(0, 0, [
        ['moveTo', safeRadius, 0],
        ['lineTo', safeWidth - safeRadius, 0],
        ['arcTo', safeWidth, 0, safeWidth, safeRadius, safeRadius],
        ['lineTo', safeWidth, safeHeight - safeRadius],
        ['arcTo', safeWidth, safeHeight, safeWidth - safeRadius, safeHeight, safeRadius],
        ['lineTo', safeRadius, safeHeight],
        ['arcTo', 0, safeHeight, 0, safeHeight - safeRadius, safeRadius],
        ['lineTo', 0, safeRadius],
        ['arcTo', 0, 0, safeRadius, 0, safeRadius],
        ['closePath'],
      ], { fillStyle });
      return true;
    } catch {
      graphics.drawRect?.(0, 0, safeWidth, safeHeight, fillStyle);
      return true;
    }
  }

  function createLayaCardBadgeSprite(cardWidth = 72) {
    const Laya = window.Laya;
    if (!Laya || !Laya.Sprite || !Laya.Text) return null;
    try {
      const width = Math.max(48, Math.round(Number(cardWidth) || 72));
      const fontSize = Math.max(12, Number(CONFIG.cardBadgeFontSize) || 16);
      const labelWidth = Math.min(Math.max(74, width - 4), Math.max(62, Math.round(width * 0.76)));
      const labelHeight = Math.max(24, fontSize + 8);
      const badge = new Laya.Sprite();
      badge.name = 'mda-juxi-card-badge-laya';
      badge.zOrder = 99999;
      badge.size(labelWidth, labelHeight);
      badge.pos(5, 4);
      badge.alpha = 0.98;
      badge.mouseEnabled = false;
      drawRoundRect(badge.graphics, labelWidth, labelHeight, 4, 'rgba(43,33,25,0.9)');
      const label = new Laya.Text();
      label.text = '不可对敌';
      label.font = CONFIG.hintFontName;
      label.fontSize = fontSize;
      label.bold = true;
      label.color = '#ffe28a';
      label.align = 'center';
      label.valign = 'middle';
      label.width = labelWidth;
      label.height = labelHeight;
      label.pos(0, 0);
      label.mouseEnabled = false;
      badge.addChild(label);
      return badge;
    } catch {
      return null;
    }
  }

  function getLayaLocalPoint(fromObject, toObject, x = 0, y = 0) {
    const Laya = window.Laya;
    if (!Laya || !fromObject || !toObject || typeof fromObject.localToGlobal !== 'function' || typeof toObject.globalToLocal !== 'function') return null;
    try {
      const global = fromObject.localToGlobal(new Laya.Point(x, y), true);
      const local = toObject.globalToLocal(new Laya.Point(global.x, global.y), true);
      if (!local || !Number.isFinite(Number(local.x)) || !Number.isFinite(Number(local.y))) return null;
      return { x: Number(local.x), y: Number(local.y) };
    } catch {
      return null;
    }
  }

  function ensureLayaCardBadgeLayer() {
    const Laya = window.Laya;
    const stage = Laya && Laya.stage;
    if (!Laya || !Laya.Sprite || !stage || typeof stage.addChild !== 'function') return null;
    if (layaCardBadgeLayer && !layaCardBadgeLayer.destroyed && !layaCardBadgeLayer._destroyed && layaCardBadgeLayer.parent === stage) {
      try {
        layaCardBadgeLayer.removeChildren();
      } catch {
      }
      return layaCardBadgeLayer;
    }
    if (layaCardBadgeLayer) {
      try {
        layaCardBadgeLayer.removeSelf();
      } catch {
      }
      layaCardBadgeLayer = null;
    }
    try {
      const layer = new Laya.Sprite();
      layer.name = 'mda-juxi-card-badge-layer';
      layer.zOrder = 2147483000;
      layer.mouseEnabled = false;
      layer.size(stage.width || 0, stage.height || 0);
      layer.pos(0, 0);
      stage.addChild(layer);
      if (typeof stage.updateZOrder === 'function') stage.updateZOrder();
      layaCardBadgeLayer = layer;
      return layer;
    } catch {
      return null;
    }
  }

  function renderLayaCardBadge(card, layer, container) {
    const ui = card && card.ui;
    if (!ui || !layer || typeof layer.addChild !== 'function') return false;
    try {
      const badge = createLayaCardBadgeSprite(ui.width || 72);
      if (!badge) return false;
      const cardX = Number(ui.x || 0);
      const cardY = Number(ui.y || 0);
      const point = getLayaLocalPoint(container, layer, cardX, cardY);
      if (!point) return false;
      const width = Math.max(48, Number(ui.width || 72));
      const height = Math.max(68, Number(ui.height || 102));
      const offsetX = Math.round(width * CONFIG.cardBadgeXRatio);
      const offsetY = Math.round(height * CONFIG.cardBadgeYRatio);
      badge.pos(Math.round(point.x + offsetX), Math.round(point.y + offsetY));
      layer.addChild(badge);
      if (typeof layer.updateZOrder === 'function') layer.updateZOrder();
      return true;
    } catch {
      return false;
    }
  }

  function renderCardBadges() {
    clearCardBadges();
    state.lastCardBadgeCount = 0;
    state.lastCardBadgeReason = '';
    if (!document.body) {
      state.lastCardBadgeReason = '无 body';
      return;
    }
    if (!state.selfIsMouDengAi || !state.isOwnPlayPhase) {
      state.lastCardBadgeReason = '非谋邓艾或非己方出牌阶段';
      return;
    }
    const container = getCardContainer();
    const layer = ensureLayaCardBadgeLayer();
    if (!layer) {
      state.lastCardBadgeReason = '未找到可绘制的 Laya 顶层';
      return;
    }
    const unavailableCards = state.judgedCards.filter((card) => card.countsAsUnavailable);
    if (!unavailableCards.length) {
      state.lastCardBadgeReason = '没有不可对敌牌';
      return;
    }
    unavailableCards.forEach((card) => {
      if (!card.ui) {
        state.lastCardBadgeReason = '部分手牌缺少 UI';
        return;
      }
      let drawn = false;
      drawn = renderLayaCardBadge(card, layer, container) || drawn;
      if (drawn) state.lastCardBadgeCount += 1;
    });
    if (!state.lastCardBadgeReason) state.lastCardBadgeReason = `stage 顶层/容器坐标标记 ${state.lastCardBadgeCount}/${unavailableCards.length}`;
  }

  function getClassName(object) {
    try {
      return object && (object.constructor && object.constructor.name || object.name) || '';
    } catch {
      return '';
    }
  }

  function findSeatAvatar(seat) {
    const seatObject = getSeatObject(seat);
    const seatUi = seatObject && (seatObject.SeatUI || seatObject.seatUI);
    const directAvatar = seatUi && (seatUi.seatAvatar || seatUi.avatar || seatUi.generalAvatar);
    if (directAvatar && typeof directAvatar.localToGlobal === 'function') return directAvatar;
    const stage = window.Laya && window.Laya.stage;
    if (!stage) return null;
    const avatarLayer = findLayaObject(stage, (object) => (object.name || getClassName(object)) === 'seatAvatarSprite');
    const avatars = (avatarLayer && avatarLayer._children || []).filter((child) => /Avatar/i.test(child.name || getClassName(child)));
    const activeSeats = getSeatOrder();
    const index = activeSeats.indexOf(seat);
    return avatars[index] || null;
  }

  function findSeatComboLayer() {
    try {
      const jndLayer = window.__JND && window.__JND._box && window.__JND._box.comboLayer && window.__JND._box.comboLayer();
      if (jndLayer) return jndLayer;
    } catch {
    }
    const stage = window.Laya && window.Laya.stage;
    return findLayaObject(stage, (object) => (object.name || getClassName(object)) === 'seatComboSprite') || stage || null;
  }

  function clearLayaSeatStrip() {
    if (layaSeatStrip) {
      try {
        layaSeatStrip.removeSelf();
      } catch {
      }
      layaSeatStrip = null;
    }
  }

  function clearSeatStrip() {
    try {
      window.SGS91Assistant?.getService?.('seatOverlay')?.clear?.(CONFIG.seatStripKey);
    } catch {
    }
    try {
      if (window.__JND && typeof window.__JND.clearSeatSkillStrip === 'function') {
        window.__JND.clearSeatSkillStrip(CONFIG.seatStripKey);
      }
    } catch {
    }
    lastJndStripText = '';
    clearLayaSeatStrip();
    const dom = document.getElementById(CONFIG.domSeatStripId);
    if (dom) dom.remove();
  }

  function renderSharedSeatStrip(text) {
    const selfSeat = state.selfSeat;
    const overlay = window.SGS91Assistant?.getService?.('seatOverlay');
    if (!overlay?.show || !isRealSeat(selfSeat)) return false;
    try {
      const ok = overlay.show(CONFIG.seatStripKey, selfSeat, text, {
        font: CONFIG.hintFontName,
        fontSize: CONFIG.seatStripFontSize,
        minFontSize: 10,
        fitText: true,
        textPaddingX: 4,
        color: state.canUseJuxi ? '#a9f0af' : '#f4d17b',
        zOrder: 99999,
      });
      if (ok) {
        clearLayaSeatStrip();
        document.getElementById(CONFIG.domSeatStripId)?.remove();
        return true;
      }
    } catch {
    }
    return false;
  }

  function renderJndSeatStrip(text) {
    const selfSeat = state.selfSeat;
    const jnd = window.__JND;
    if (!jnd || typeof jnd.showSeatSkillStrip !== 'function' || typeof jnd.clearSeatSkillStrip !== 'function' || !isRealSeat(selfSeat)) return false;
    try {
      if (lastJndStripText && lastJndStripText !== text) jnd.clearSeatSkillStrip(CONFIG.seatStripKey);
      const ok = jnd.showSeatSkillStrip(CONFIG.seatStripKey, selfSeat, text, {
        font: CONFIG.hintFontName,
        fontSize: CONFIG.seatStripFontSize,
        minFontSize: 10,
        fitText: true,
        textPaddingX: 4,
        color: state.canUseJuxi ? '#a9f0af' : '#f4d17b',
        zOrder: 99999,
      });
      if (ok) {
        lastJndStripText = text;
        clearLayaSeatStrip();
        const dom = document.getElementById(CONFIG.domSeatStripId);
        if (dom) dom.remove();
        return true;
      }
    } catch {
    }
    return false;
  }

  function renderLayaSeatStrip(text) {
    const Laya = window.Laya;
    const selfSeat = state.selfSeat;
    const avatar = findSeatAvatar(selfSeat);
    const comboLayer = findSeatComboLayer();
    if (!Laya || !Laya.Sprite || !Laya.Text || !Laya.Point || !avatar || !comboLayer || typeof comboLayer.globalToLocal !== 'function') return false;
    clearLayaSeatStrip();
    try {
      const width = state.canUseJuxi ? 108 : 88;
      const height = 24;
      const center = avatar.localToGlobal(new Laya.Point((avatar.width || 0) / 2, (avatar.height || 0) / 2), true);
      const local = comboLayer.globalToLocal(new Laya.Point(center.x, center.y), true);
      const strip = new Laya.Sprite();
      strip.name = 'mou-deng-ai-juxi-strip';
      strip.zOrder = 99999;
      strip.size(width, height);
      strip.pos(Math.round(local.x - width / 2), Math.round(local.y - (avatar.height || 82) / 2 - height - 4));
      strip.alpha = 0.94;
      strip.graphics.drawRect(0, 0, width, height, '#2b2b2b', state.canUseJuxi ? '#75b979' : '#d8b45f', 1);
      const label = new Laya.Text();
      label.text = text;
      label.font = CONFIG.hintFontName;
      label.fontSize = CONFIG.seatStripFontSize;
      label.bold = true;
      label.color = state.canUseJuxi ? '#a9f0af' : '#f4d17b';
      label.align = 'center';
      label.valign = 'middle';
      label.width = width;
      label.height = height;
      strip.addChild(label);
      comboLayer.addChild(strip);
      layaSeatStrip = strip;
      const dom = document.getElementById(CONFIG.domSeatStripId);
      if (dom) dom.remove();
      return true;
    } catch {
      clearLayaSeatStrip();
      return false;
    }
  }

  function renderDomSeatStrip(text) {
    if (!document.body) return;
    let dom = document.getElementById(CONFIG.domSeatStripId);
    if (!dom) {
      dom = document.createElement('div');
      dom.id = CONFIG.domSeatStripId;
      document.body.appendChild(dom);
    }
    dom.textContent = text;
    dom.style.color = state.canUseJuxi ? '#a9f0af' : '#f4d17b';
    const avatar = findSeatAvatar(state.selfSeat);
    const point = avatar ? getLayaClientPoint(avatar, (avatar.width || 0) / 2, 0) : null;
    dom.style.left = `${Math.round((point ? point.x : window.innerWidth / 2) - 43)}px`;
    dom.style.top = `${Math.round((point ? point.y : window.innerHeight - 180) - 26)}px`;
  }

  function renderSeatStrip() {
    if (!state.selfIsMouDengAi || !state.isOwnPlayPhase) {
      clearSeatStrip();
      return;
    }
    const xText = formatStripNumber(state.unavailableCount);
    const text = `骤袭 X＝${xText}${state.canUseJuxi ? ' 可用' : ''}`;
    if (renderSharedSeatStrip(text)) return;
    if (renderJndSeatStrip(text)) return;
    if (renderLayaSeatStrip(text)) return;
    renderDomSeatStrip(text);
  }

  function renderInvalidJuxiMarks() {
    const jnd = window.__JND;
    const overlay = window.SGS91Assistant?.getService?.('seatOverlay');
    Object.keys(state.juxiInvalidMarks).forEach((key) => {
      const mark = state.juxiInvalidMarks[key];
      const seat = toNumber(key, null);
      if (!mark || !isRealSeat(seat)) {
        clearJuxiInvalid(seat);
        return;
      }
      if (overlay?.show) {
        try {
          overlay.show(`${CONFIG.invalidStripPrefix}${seat}`, seat, '骤袭已失效', {
            font: CONFIG.hintFontName,
            fontSize: CONFIG.seatStripFontSize,
            minFontSize: 10,
            fitText: true,
            textPaddingX: 4,
            color: '#ffb1a1',
            zOrder: 99999,
          });
          return;
        } catch {
        }
      }
      if (!jnd || typeof jnd.showSeatSkillStrip !== 'function') return;
      try {
        jnd.showSeatSkillStrip(`${CONFIG.invalidStripPrefix}${seat}`, seat, '骤袭已失效', {
          fontSize: 13,
          minFontSize: 10,
          fitText: true,
          textPaddingX: 4,
          color: '#ffb1a1',
          zOrder: 99999,
        });
      } catch {
      }
    });
  }

  function formatStripNumber(value) {
    return String(Math.max(0, Number(value) || 0)).replace(/[0-9]/g, (digit) => '０１２３４５６７８９'[Number(digit)]);
  }

  function renderAll() {
    if (!state.bodyReady) return;
    renderCardBadges();
    renderSeatStrip();
    renderInvalidJuxiMarks();
  }

  function bootWhenReady() {
    if (state.bodyReady) return;
    if (document.body) {
      state.bodyReady = true;
      injectStyle();
      startRenderTimer();
      return;
    }
    setTimeout(bootWhenReady, 300);
  }

  function startRenderTimer() {
    if (renderTimer) return;
    renderTimer = setInterval(() => {
      try {
        updateStateFromGame();
        renderAll();
      } catch {
      }
    }, Math.max(16, Number(CONFIG.renderIntervalMs) || 100));
  }

  function restartRenderTimer() {
    if (renderTimer) {
      clearInterval(renderTimer);
      renderTimer = 0;
    }
    startRenderTimer();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      state.lastStatus = '诊断已复制';
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      state.lastStatus = '诊断已复制';
    }
  }

  function createDiagnosticExport() {
    updateStateFromGame();
    return {
      script: 'sgs-mou-deng-ai-juxi-helper',
      version: '1.0.4',
      exportedAt: new Date().toISOString(),
      url: location.href,
      config: {
        characterIds: CONFIG.characterIds,
        skillIds: CONFIG.skillIds,
        enableStageTextSlashCounter: CONFIG.enableStageTextSlashCounter,
        renderIntervalMs: CONFIG.renderIntervalMs,
        cardBadgeFontSize: CONFIG.cardBadgeFontSize,
        cardBadgeXRatio: CONFIG.cardBadgeXRatio,
        cardBadgeYRatio: CONFIG.cardBadgeYRatio,
      },
      state: {
        selfSeat: state.selfSeat,
        currentPhase: state.currentPhase,
        currentTurnSeat: state.currentTurnSeat,
        isOwnPlayPhase: state.isOwnPlayPhase,
        slashUsedThisTurn: state.slashUsedThisTurn,
        slashRemainingThisTurn: state.slashRemainingThisTurn,
        slashLimit: state.slashLimit,
        slashCounterSource: state.slashCounterSource,
        hasZhugeCrossbowEquipped: state.hasZhugeCrossbowEquipped,
        slashUsageBySeat: cloneDiagnostic(state.slashUsageBySeat),
        attackRange: state.attackRange,
        selfIsMouDengAi: state.selfIsMouDengAi,
        characterEvidence: state.characterEvidence,
        unavailableCount: state.unavailableCount,
        canUseJuxi: state.canUseJuxi,
        knownSeats: state.knownSeats.slice(),
        deadSeats: state.deadSeats.slice(),
        actionSeats: state.actionSeats.slice(),
        targetableSeats: state.targetableSeats.slice(),
        pendingJuxiBySeat: cloneDiagnostic(state.pendingJuxiBySeat),
        juxiInvalidMarks: cloneDiagnostic(state.juxiInvalidMarks),
        lastCardBadgeCount: state.lastCardBadgeCount,
        lastCardBadgeReason: state.lastCardBadgeReason,
      },
      seatRows: buildSeatRows(),
      handCards: state.judgedCards.map((card) => ({
        index: card.index,
        id: card.id,
        name: card.name,
        suit: card.suit,
        number: card.number,
        type: card.type,
        typeName: card.typeName,
        canTargetOther: card.canTargetOther,
        countsAsUnavailable: card.countsAsUnavailable,
        reason: card.reason,
        confidence: card.confidence,
        rawSummary: card.rawSummary,
      })),
      hookStatus: state.hookStatus,
      recent: state.recent.slice(-40),
      importantRecent: state.importantRecent.slice(-40),
    };
  }

  function copyDiagnostic() {
    return copyText(JSON.stringify(createDiagnosticExport(), null, 2));
  }

  function hookJndBus() {
    function attach() {
      const jnd = window.__JND;
      if (!jnd || typeof jnd !== 'object') return false;
      state.hookStatus.jndSeen = true;
      if (jnd.__mouDengAiJuxiHooked) {
        state.hookStatus.jndHooked = true;
        return true;
      }
      if (typeof jnd.onMsg !== 'function') return false;
      jnd.onMsg((type, payload) => onMessage(type, payload || {}));
      try {
        Object.defineProperty(jnd, '__mouDengAiJuxiHooked', { value: true });
      } catch {
        jnd.__mouDengAiJuxiHooked = true;
      }
      state.hookStatus.jndHooked = true;
      return true;
    }
    attach();
    const timer = setInterval(attach, 500);
    setTimeout(() => clearInterval(timer), 180000);
  }

  function hookInternalMessageBus() {
    const getService = window.SGS91Assistant?.getService;
    if (typeof getService !== 'function') return false;
    const messages = getService.call(window.SGS91Assistant, 'gameMessages');
    if (!messages || typeof messages.subscribe !== 'function' || state.hookStatus.internalMessagesHooked) return false;
    messages.subscribe((type, payload) => onMessage(type, payload || {}));
    state.hookStatus.internalMessagesHooked = true;
    return true;
  }

  function injectPageBridge() {
    if (document.getElementById('mda-juxi-page-bridge')) return;
    const script = document.createElement('script');
    script.id = 'mda-juxi-page-bridge';
    script.textContent = `
      (function () {
        if (window.__mdaJuxiPageBridge) return;
        window.__mdaJuxiPageBridge = true;
        window.dispatchEvent(new CustomEvent('__MDA_JUXI_BRIDGE_READY__', { detail: { at: new Date().toISOString() } }));
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
    state.hookStatus.pageBridgeInjected = true;
  }

  window.addEventListener('__MDA_JUXI_BRIDGE_READY__', () => {
    state.hookStatus.pageBridgeReady = true;
  });

  window.MouDengAiJuxiHelper = {
    state,
    config: CONFIG,
    probe() {
      updateStateFromGame();
      return {
        state: {
          selfSeat: state.selfSeat,
          currentPhase: state.currentPhase,
          currentTurnSeat: state.currentTurnSeat,
          isOwnPlayPhase: state.isOwnPlayPhase,
          slashUsedThisTurn: state.slashUsedThisTurn,
          slashRemainingThisTurn: state.slashRemainingThisTurn,
          slashLimit: state.slashLimit,
          hasZhugeCrossbowEquipped: state.hasZhugeCrossbowEquipped,
          attackRange: state.attackRange,
          selfIsMouDengAi: state.selfIsMouDengAi,
          characterEvidence: state.characterEvidence,
          unavailableCount: state.unavailableCount,
          canUseJuxi: state.canUseJuxi,
        },
        seatRows: buildSeatRows(),
        handCards: state.judgedCards.map((card) => ({
          index: card.index,
          id: card.id,
          name: card.name,
          canTargetOther: card.canTargetOther,
          countsAsUnavailable: card.countsAsUnavailable,
          reason: card.reason,
          confidence: card.confidence,
        })),
        hookStatus: state.hookStatus,
      };
    },
    exportDiagnostic: createDiagnosticExport,
    copyDiagnostic,
    setConfig(nextConfig) {
      if (!nextConfig || typeof nextConfig !== 'object') return;
      if (nextConfig.characterId !== undefined) CONFIG.characterIds.mouDengAi = nextConfig.characterId;
      if (nextConfig.skillIds && typeof nextConfig.skillIds === 'object') Object.assign(CONFIG.skillIds, nextConfig.skillIds);
      if (nextConfig.enableStageTextSlashCounter !== undefined) CONFIG.enableStageTextSlashCounter = Boolean(nextConfig.enableStageTextSlashCounter);
      if (nextConfig.renderIntervalMs !== undefined) {
        CONFIG.renderIntervalMs = clampNumber(nextConfig.renderIntervalMs, 16, 500, CONFIG.renderIntervalMs);
        restartRenderTimer();
      }
      if (nextConfig.cardBadgeFontSize !== undefined) CONFIG.cardBadgeFontSize = clampNumber(nextConfig.cardBadgeFontSize, 12, 36, CONFIG.cardBadgeFontSize);
      if (nextConfig.cardBadgeXRatio !== undefined) CONFIG.cardBadgeXRatio = clampNumber(nextConfig.cardBadgeXRatio, -0.5, 1, CONFIG.cardBadgeXRatio);
      if (nextConfig.cardBadgeYRatio !== undefined) CONFIG.cardBadgeYRatio = clampNumber(nextConfig.cardBadgeYRatio, -0.2, 1.2, CONFIG.cardBadgeYRatio);
      if (nextConfig.cardRules && typeof nextConfig.cardRules === 'object') {
        (nextConfig.cardRules.equipment || []).forEach((name) => EQUIPMENT_NAMES.add(name));
        (nextConfig.cardRules.selfOnly || []).forEach((name) => SELF_ONLY_OR_RESPONSE.add(name));
        (nextConfig.cardRules.distanceOne || []).forEach((name) => DISTANCE_ONE_TRICKS.add(name));
        (nextConfig.cardRules.anyOther || []).forEach((name) => ANY_OTHER_TRICKS.add(name));
        (nextConfig.cardRules.globalOther || []).forEach((name) => GLOBAL_OTHER_TRICKS.add(name));
      }
      updateStateFromGame();
      renderAll();
    },
    onMessage,
    __test: Object.freeze({ drawRoundRect }),
  };

  window.SGS91Assistant.registerModule({
    id: 'hero.mou-deng-ai.juxi',
    type: 'hero',
    name: '谋邓艾·骤袭',
    version: '1.0.4',
    description: '计算骤袭 X、标记可计入手牌，并跟踪骤袭失效状态。',
    capabilities: ['game-message-read', 'hand-read', 'card-overlay', 'seat-overlay', 'diagnostic-export'],
    characterIds: [1740],
    skillIds: [3716],
    api: window.MouDengAiJuxiHelper,
  });

  injectPageBridge();
  hookInternalMessageBus();
  hookJndBus();
  bootWhenReady();
})();

// ---- src/heroes/zhang-yu-xiangchen.user.js ----
(function () {
  'use strict';

  const app = window.SGS91Assistant;
  if (!app) throw new Error('SGS91 core must load before Zhang Yu Xiangchen module.');
  if (app.getModule('hero.zhang-yu.xiangchen')) return;

  const CONFIG = {
    version: '1.0.0',
    characterId: 1912,
    skillId: 3800,
    skillNames: ['相谶'],
    stripKeyPrefix: 'sgs91-zhang-yu-xiangchen-',
    stripColor: '#f4d17b',
    hookRetryMs: 500,
    hookMaxAttempts: 360,
    refreshDebounceMs: 40,
  };
  const RESET_MESSAGE = /(?:MsgDealCharacters|MsgGameStart|MsgStartGame|MsgGameOver|MsgGameEnd|MsgLeaveGame)$/i;
  const BOARD_MESSAGE = /(?:Turn|PlayerDead|DealCharacters|GameStart|GameOver|GameEnd|Seat)/i;
  const CONFIRMED_XIANGCHEN_MESSAGE = /(?:MsgRoleOptNtf$|(?:Use|Cast|Play).*(?:Skill|Spell)|(?:Skill|Spell).*(?:Effect|Result|Finish|Done)|Opt.*(?:Result|Finish|Done))/i;
  const FORBIDDEN_TARGET_PROMPT = /(?:MsgRoleOptTargetNtf$|(?:Target|Choose|Select).*(?:Prompt|Candidates?|List|Req|Ntf)$)/i;

  function toNumber(value, fallback = null) {
    if (value === '' || value == null) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function isRealSeat(value) {
    const seat = toNumber(value, null);
    return seat != null && seat >= 0 && seat < 12;
  }

  function payloadSkillId(payload) {
    return toNumber(payload && (
      payload.spellId ?? payload.skillId ?? payload.SpellId ?? payload.SkillId
      ?? payload.spell?.id ?? payload.skill?.id
    ), null);
  }

  function payloadSkillName(payload) {
    return String(payload && (
      payload.skillName ?? payload.spellName ?? payload.SkillName ?? payload.SpellName
      ?? payload.skill?.name ?? payload.spell?.name ?? payload.name ?? payload.Name
    ) || '');
  }

  function payloadCasterSeat(payload) {
    return toNumber(payload && (
      payload.spellCasterSeat ?? payload.casterSeat ?? payload.srcSeat ?? payload.userSeat
      ?? payload.ownerSeat ?? payload.optSeat ?? payload.fromSeat ?? payload.seat
    ), null);
  }

  function extractSeatList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => toNumber(
      item && typeof item === 'object' ? (item.seat ?? item.seatId ?? item.SeatId ?? item.targetSeat) : item,
      null,
    )).filter(isRealSeat);
  }

  function confirmedTargetSeat(type, payload) {
    if (!payload || typeof payload !== 'object') return null;
    const directKeys = ['selectedTargetSeat', 'chosenTargetSeat', 'dstSeat', 'destSeat', 'toSeat'];
    if (/MsgRoleOptNtf$/i.test(String(type || ''))) directKeys.push('targetSeat', 'targetSeatID');
    for (const key of directKeys) {
      const seat = toNumber(payload[key], null);
      if (isRealSeat(seat)) return seat;
    }
    for (const key of ['selectedTargets', 'chosenTargets', 'resultTargets', 'targets', 'target']) {
      const seats = extractSeatList(Array.isArray(payload[key]) ? payload[key] : [payload[key]]);
      if (seats.length === 1) return seats[0];
    }
    return null;
  }

  function payloadLooksLikeXiangchen(payload, model, config = CONFIG) {
    if (!payload || typeof payload !== 'object') return false;
    const id = payloadSkillId(payload);
    const configuredId = toNumber(config.skillId, null);
    const discoveredId = toNumber(model?.discoveredSkillId, null);
    if (id != null && (id === configuredId || id === discoveredId)) return true;
    const name = payloadSkillName(payload);
    if (config.skillNames.some((item) => name.includes(item))) return true;
    const cachedName = model?.skillNamesById?.[id];
    return typeof cachedName === 'string' && config.skillNames.some((item) => cachedName.includes(item));
  }

  function extractConfirmedSelection(type, payload, model, config = CONFIG) {
    const typeText = String(type || '');
    if (!payload || typeof payload !== 'object') return null;
    if (FORBIDDEN_TARGET_PROMPT.test(typeText)) return null;
    if (!CONFIRMED_XIANGCHEN_MESSAGE.test(typeText)) return null;
    if (!payloadLooksLikeXiangchen(payload, model, config)) return null;
    const caster = payloadCasterSeat(payload);
    const target = confirmedTargetSeat(typeText, payload);
    if (!isRealSeat(caster) || !isRealSeat(target) || caster === target) return null;
    return { caster, target, type: typeText, spellId: payloadSkillId(payload) };
  }

  function createModel() {
    return {
      deadSeats: [],
      knownSeats: [],
      skillNamesById: {},
      discoveredSkillId: null,
      targets: {},
    };
  }

  function rememberSeat(model, value) {
    const seat = toNumber(value, null);
    if (!isRealSeat(seat) || model.knownSeats.includes(seat)) return false;
    model.knownSeats.push(seat);
    model.knownSeats.sort((left, right) => left - right);
    return true;
  }

  function cacheSkillEvidence(model, payload, config = CONFIG) {
    if (!payload || typeof payload !== 'object') return false;
    let changed = false;
    const queue = [{ value: payload, depth: 0 }];
    const seen = new Set();
    while (queue.length) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 3) continue;
      seen.add(value);
      const id = payloadSkillId(value);
      const name = payloadSkillName(value);
      if (id != null && name) {
        if (model.skillNamesById[id] !== name) {
          model.skillNamesById[id] = name;
          changed = true;
        }
        if (config.skillNames.some((item) => name.includes(item)) && model.discoveredSkillId !== id) {
          model.discoveredSkillId = id;
          changed = true;
        }
      }
      Object.keys(value).slice(0, 50).forEach((key) => {
        let nested;
        try { nested = value[key]; } catch { return; }
        if (nested && typeof nested === 'object') queue.push({ value: nested, depth: depth + 1 });
      });
    }
    return changed;
  }

  function resetMatchModel(model) {
    model.deadSeats = [];
    model.knownSeats = [];
    model.targets = {};
  }

  function reduceMessage(model, type, payload, config = CONFIG) {
    const safePayload = payload || {};
    const typeText = String(type || '');
    let changed = false;
    if (RESET_MESSAGE.test(typeText)) {
      resetMatchModel(model);
      changed = true;
    }
    if (/(?:Skill|Spell|RoleOpt|Character)/i.test(typeText)
      || safePayload.spellId != null || safePayload.skillId != null
      || safePayload.spellName != null || safePayload.skillName != null) {
      if (cacheSkillEvidence(model, safePayload, config)) changed = true;
    }
    ['seat', 'srcSeat', 'ownerSeat', 'userSeat', 'optSeat', 'spellCasterSeat', 'targetSeat', 'targetSeatID'].forEach((key) => {
      if (safePayload[key] !== undefined && rememberSeat(model, safePayload[key])) changed = true;
    });
    for (const key of ['targets', 'target', 'selectedTargets', 'chosenTargets']) {
      extractSeatList(Array.isArray(safePayload[key]) ? safePayload[key] : [safePayload[key]]).forEach((seat) => {
        if (rememberSeat(model, seat)) changed = true;
      });
    }
    if (/MsgGamePlayerDead$/i.test(typeText)) {
      const deadSeat = toNumber(safePayload.srcSeat ?? safePayload.seat ?? safePayload.userSeat, null);
      if (isRealSeat(deadSeat) && !model.deadSeats.includes(deadSeat)) {
        model.deadSeats.push(deadSeat);
        model.deadSeats.sort((left, right) => left - right);
        changed = true;
      }
      Object.keys(model.targets).forEach((casterKey) => {
        if (Number(casterKey) === deadSeat || Number(model.targets[casterKey]) === deadSeat) {
          delete model.targets[casterKey];
          changed = true;
        }
      });
    }
    const selection = extractConfirmedSelection(typeText, safePayload, model, config);
    if (selection && Number(model.targets[selection.caster]) !== selection.target) {
      model.targets[selection.caster] = selection.target;
      changed = true;
    }
    return { changed, selection };
  }

  function evaluateHints(targets, aliveSeats = []) {
    const alive = new Set((Array.isArray(aliveSeats) ? aliveSeats : []).map(Number).filter(isRealSeat));
    const hints = {};
    Object.entries(targets || {}).forEach(([casterValue, targetValue]) => {
      const caster = toNumber(casterValue, null);
      const target = toNumber(targetValue, null);
      if (!isRealSeat(caster) || !isRealSeat(target) || caster === target) return;
      if (alive.size && (!alive.has(caster) || !alive.has(target))) return;
      hints[String(target)] = { text: '相谶目标', color: CONFIG.stripColor };
    });
    return hints;
  }

  function createSeatStripRenderer(getOverlay = () => app.getService('seatOverlay')) {
    const displayed = new Map();
    const stats = { showCalls: 0, clearCalls: 0, skippedSameText: 0, lastError: '' };
    const keyForSeat = (seat) => `${CONFIG.stripKeyPrefix}${seat}`;

    function clearSeat(seat) {
      if (!displayed.has(String(seat))) return;
      const overlay = getOverlay();
      if (overlay && typeof overlay.clear === 'function') {
        try {
          overlay.clear(keyForSeat(seat));
          stats.clearCalls += 1;
        } catch (error) {
          stats.lastError = String(error?.message || error);
        }
      }
      displayed.delete(String(seat));
    }

    function render(hints) {
      const next = hints || {};
      const allSeats = new Set([...displayed.keys(), ...Object.keys(next)]);
      for (const seat of allSeats) {
        const hint = next[seat];
        const previous = displayed.get(String(seat));
        if (!hint) {
          clearSeat(seat);
          continue;
        }
        if (previous && previous.text === hint.text && previous.color === hint.color) {
          stats.skippedSameText += 1;
          continue;
        }
        if (previous) clearSeat(seat);
        const overlay = getOverlay();
        if (!overlay || typeof overlay.show !== 'function' || typeof overlay.clear !== 'function') {
          stats.lastError = '三国杀91助手座位文字服务不可用';
          continue;
        }
        try {
          const ok = overlay.show(keyForSeat(seat), Number(seat), hint.text, {
            font: 'FZBW',
            fontSize: 16,
            minFontSize: 10,
            fitText: true,
            textPaddingX: 4,
            color: hint.color,
            zOrder: 99999,
          });
          stats.showCalls += 1;
          if (ok !== false) displayed.set(String(seat), { text: hint.text, color: hint.color });
        } catch (error) {
          stats.lastError = String(error?.message || error);
        }
      }
    }

    function clearAll() {
      Array.from(displayed.keys()).forEach(clearSeat);
    }

    return { render, clearAll, displayed, stats };
  }

  function findGameManager() {
    return app.getService('seatOverlay')?.findGameManager?.() || null;
  }

  function seatObject(manager, seat) {
    const fromService = app.getService('seatOverlay')?.readSeatObject?.(manager, seat);
    if (fromService) return fromService;
    const seats = manager?.Seats || manager?.seats;
    if (!seats || !isRealSeat(seat)) return null;
    try { return seats[seat] || seats.getNumberKey?.(seat) || null; }
    catch { return null; }
  }

  function readDeadFlag(object) {
    if (!object || typeof object !== 'object') return false;
    return Boolean(object.dead ?? object.isDead ?? object.Dead ?? object.IsDead ?? false);
  }

  function readAliveSeats(model) {
    const manager = findGameManager();
    const seats = [];
    const container = manager?.Seats || manager?.seats;
    if (container) {
      for (let seat = 0; seat < 12; seat += 1) {
        const object = seatObject(manager, seat);
        if (object && !(object.destroyed || object._destroyed) && !readDeadFlag(object)) seats.push(seat);
      }
    }
    if (seats.length) return seats;
    return model.knownSeats.filter((seat) => !model.deadSeats.includes(seat));
  }

  const model = createModel();
  const renderer = createSeatStripRenderer();
  const runtime = {
    hints: {},
    aliveSeats: [],
    recentImportant: [],
    lastRefreshReason: '',
    refreshCount: 0,
    refreshTimer: 0,
    hookStatus: {
      attached: false,
      attempts: 0,
      attachedAt: '',
      lastMessageAt: '',
      lastMessageType: '',
      failure: '',
    },
  };

  function refreshNow(reason = 'manual') {
    runtime.aliveSeats = readAliveSeats(model);
    runtime.hints = evaluateHints(model.targets, runtime.aliveSeats);
    runtime.lastRefreshReason = reason;
    runtime.refreshCount += 1;
    renderer.render(runtime.hints);
    return runtime.hints;
  }

  function scheduleRefresh(reason) {
    if (runtime.refreshTimer) clearTimeout(runtime.refreshTimer);
    runtime.refreshTimer = setTimeout(() => {
      runtime.refreshTimer = 0;
      refreshNow(reason);
    }, CONFIG.refreshDebounceMs);
  }

  function cloneDiagnostic(value, depth = 0, seen = new Set()) {
    if (depth > 4 || value == null) return value == null ? value : String(value);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => cloneDiagnostic(item, depth + 1, seen));
    const output = {};
    Object.keys(value).slice(0, 80).forEach((key) => {
      try { output[key] = cloneDiagnostic(value[key], depth + 1, seen); }
      catch { output[key] = '[Unreadable]'; }
    });
    return output;
  }

  function onMessage(type, payload = {}) {
    if (!type) return;
    runtime.hookStatus.lastMessageAt = new Date().toISOString();
    runtime.hookStatus.lastMessageType = String(type);
    const result = reduceMessage(model, type, payload, CONFIG);
    if (result.changed || BOARD_MESSAGE.test(String(type))) {
      runtime.recentImportant.push({
        at: runtime.hookStatus.lastMessageAt,
        type: String(type),
        selection: result.selection ? { ...result.selection } : null,
      });
      if (runtime.recentImportant.length > 80) runtime.recentImportant.shift();
      scheduleRefresh(`message:${type}`);
    }
  }

  function createDiagnostic() {
    refreshNow('diagnostic');
    return {
      module: 'hero.zhang-yu.xiangchen',
      version: CONFIG.version,
      exportedAt: new Date().toISOString(),
      url: location.href,
      config: {
        characterId: CONFIG.characterId,
        skillId: CONFIG.skillId,
        discoveredSkillId: model.discoveredSkillId,
        skillNames: CONFIG.skillNames.slice(),
      },
      hookStatus: { ...runtime.hookStatus },
      state: cloneDiagnostic(model),
      aliveSeats: runtime.aliveSeats.slice(),
      hints: cloneDiagnostic(runtime.hints),
      renderStats: cloneDiagnostic(renderer.stats),
      lastRefreshReason: runtime.lastRefreshReason,
      refreshCount: runtime.refreshCount,
      recentImportant: runtime.recentImportant.slice(-80),
    };
  }

  async function copyDiagnostic() {
    const text = JSON.stringify(createDiagnostic(), null, 2);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return text;
      } catch {
      }
    }
    if (!document.body) return text;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand?.('copy');
    textarea.remove();
    return text;
  }

  function clearMarks() {
    model.targets = {};
    runtime.hints = {};
    renderer.clearAll();
    return true;
  }

  function attachMessageBus() {
    runtime.hookStatus.attempts += 1;
    const messages = app.getService('gameMessages');
    if (!messages || typeof messages.subscribe !== 'function') return false;
    if (runtime.hookStatus.attached) return true;
    try {
      messages.subscribe((type, payload) => onMessage(type, payload || {}));
      runtime.hookStatus.attached = true;
      runtime.hookStatus.attachedAt = new Date().toISOString();
      scheduleRefresh('hook-attached');
      return true;
    } catch (error) {
      runtime.hookStatus.failure = String(error?.message || error);
      return false;
    }
  }

  const api = Object.freeze({
    version: CONFIG.version,
    probe: createDiagnostic,
    exportDiagnostic: createDiagnostic,
    copyDiagnostic,
    clearMarks,
    onMessage,
    __test: Object.freeze({
      evaluateHints,
      createModel,
      reduceMessage,
      extractConfirmedSelection,
      createSeatStripRenderer,
    }),
  });
  window.ZhangYuXiangchenHelper = api;

  app.registerModule({
    id: 'hero.zhang-yu.xiangchen',
    type: 'hero',
    name: '张裕·相谶',
    version: CONFIG.version,
    description: '张裕确认发动相谶后，在最近一次选择的目标武将位置显示提示。',
    capabilities: ['game-message-read', 'seat-overlay', 'diagnostic-export'],
    characterIds: [CONFIG.characterId],
    skillIds: [CONFIG.skillId],
    api,
  });

  if (!attachMessageBus()) runtime.hookStatus.failure = '三国杀91助手内置消息服务不可用';
})();

// ---- src/features/suit-sorter.user.js ----
(function() {
  'use strict';

  const FLOATING_ENABLED_KEY = 'sgs91-floating-window-enabled';
  const MENU_COMMAND_ID = 'sgs91-floating-window-toggle';
  let floatingEnabled = readFloatingEnabled();
  let floatingBall = null;
  let floatingStyle = null;
  let cleanupFloatingListeners = null;
  let initTimer = null;
  let menuCommandId = null;

  function readFloatingEnabled() {
    if (typeof GM_getValue === 'function') {
      try { return GM_getValue(FLOATING_ENABLED_KEY, false) === true; } catch {}
    }
    return false;
  }

  function saveFloatingEnabled(enabled) {
    if (typeof GM_setValue === 'function') {
      try { GM_setValue(FLOATING_ENABLED_KEY, Boolean(enabled)); } catch {}
    }
  }

  function getCardContainer() {
    const gameScene = window.SGS91Assistant && window.SGS91Assistant.getService('gameScene');
    return gameScene ? gameScene.getCardContainer() : null;
  }

  function redrawCards(container) {
    const arr = container.cardUis;
    const len = arr ? arr.length : 0;
    for (let i = 0; i < len; i++) {
      arr[i].ClearDraw(false);
      arr[i].Draw(container);
    }
    container.invalidateLayoutHandCard();
    container.isCardCateGorizeShow = arr && arr.length >= 20;
    container.refreshCardCateGorize();
  }

  function sortBySuit() {
    const container = getCardContainer();
    if (!container) return false;
    container.cardUis.sort((a, b) => a.theCard.cardFlower - b.theCard.cardFlower);
    redrawCards(container);
    return true;
  }

  // =====================================================
  // 可拖拽悬浮球
  // =====================================================
  function createFloatingBall() {
    if (!floatingEnabled || !document.body || !document.head) return null;
    const existing = document.getElementById('sgs91-suit-sorter');
    if (existing) {
      floatingBall = existing;
      return existing;
    }

    const style = document.createElement('style');
    style.id = 'sgs91-suit-sorter-style';
    style.textContent = `
      #sgs91-suit-sorter {
        position: fixed;
        z-index: 99999;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: linear-gradient(145deg, rgba(63,42,29,0.96), rgba(25,23,21,0.96));
        border: 2px solid #b9904a;
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: "Microsoft YaHei", sans-serif;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: -1px;
        color: #f2de9c;
        user-select: none;
        -webkit-user-select: none;
        box-shadow: 0 2px 12px rgba(0,0,0,0.5);
        transition: box-shadow 0.15s, border-color 0.15s, background 0.15s;
        left: calc(100vw - 206px);
        top: calc(100vh - 206px);
      }
      #sgs91-suit-sorter:hover {
        border-color: #f2de9c;
        box-shadow: 0 4px 18px rgba(0,0,0,0.7);
        background: rgba(35,32,29,0.95);
      }
      #sgs91-suit-sorter.dragging {
        cursor: grabbing;
        border-color: #e94560;
        transition: none;
      }
    `;
    document.head.appendChild(style);
    floatingStyle = style;

    const ball = document.createElement('div');
    ball.id = 'sgs91-suit-sorter';
    ball.title = '三国杀91助手 · 按花色排序';
    ball.textContent = '91';
    document.body.appendChild(ball);
    floatingBall = ball;

    // 拖拽状态
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, startLeft, startTop;

    function onStart(e) {
      e.preventDefault();
      isDragging = true;
      hasMoved = false;
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX;
      startY = pt.clientY;
      startLeft = ball.offsetLeft;
      startTop = ball.offsetTop;
      ball.classList.add('dragging');
    }

    function onMove(e) {
      if (!isDragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      ball.style.left = Math.max(0, Math.min(window.innerWidth - 46, startLeft + dx)) + 'px';
      ball.style.top = Math.max(0, Math.min(window.innerHeight - 46, startTop + dy)) + 'px';
    }

    function onEnd(e) {
      if (!isDragging) return;
      isDragging = false;
      ball.classList.remove('dragging');
      if (!hasMoved) sortBySuit();
    }

    ball.addEventListener('mousedown', onStart);
    ball.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);

    // 窗口大小变化时修正位置
    const onResize = () => {
      const l = ball.offsetLeft;
      const t = ball.offsetTop;
      if (l > window.innerWidth - 46) ball.style.left = (window.innerWidth - 56) + 'px';
      if (t > window.innerHeight - 46) ball.style.top = (window.innerHeight - 56) + 'px';
    };
    window.addEventListener('resize', onResize);

    cleanupFloatingListeners = () => {
      ball.removeEventListener('mousedown', onStart);
      ball.removeEventListener('touchstart', onStart);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchend', onEnd);
      window.removeEventListener('resize', onResize);
    };

    console.log('[三国杀91助手] 花色排序已就绪');
    return ball;
  }

  function destroyFloatingBall() {
    if (cleanupFloatingListeners) {
      cleanupFloatingListeners();
      cleanupFloatingListeners = null;
    }
    floatingBall?.remove();
    floatingStyle?.remove();
    document.getElementById('sgs91-suit-sorter')?.remove();
    document.getElementById('sgs91-suit-sorter-style')?.remove();
    floatingBall = null;
    floatingStyle = null;
  }

  // =====================================================
  // 初始化
  // =====================================================
  function tryInit() {
    if (!floatingEnabled) {
      destroyFloatingBall();
      return true;
    }
    if (document.body && window.Laya && window.Laya.stage) {
      createFloatingBall();
      return true;
    }
    return false;
  }

  function scheduleInit() {
    if (!floatingEnabled || tryInit() || initTimer) return;
    let tries = 0;
    initTimer = setInterval(() => {
      if (tryInit() || ++tries > 60) {
        clearInterval(initTimer);
        initTimer = null;
      }
    }, 500);
  }

  function refreshMenuCommand() {
    if (typeof GM_registerMenuCommand !== 'function') return false;
    if (menuCommandId != null && typeof GM_unregisterMenuCommand === 'function') {
      try { GM_unregisterMenuCommand(menuCommandId); } catch {}
    }
    const label = floatingEnabled ? '✅ 关闭 91 悬浮窗' : '⭕ 开启 91 悬浮窗';
    try {
      menuCommandId = GM_registerMenuCommand(label, toggleFloatingBall, {
        id: MENU_COMMAND_ID,
        autoClose: false,
      });
      return true;
    } catch {
      menuCommandId = GM_registerMenuCommand(label, toggleFloatingBall);
      return true;
    }
  }

  function setFloatingBallEnabled(enabled) {
    floatingEnabled = Boolean(enabled);
    saveFloatingEnabled(floatingEnabled);
    if (floatingEnabled) scheduleInit();
    else {
      if (initTimer) {
        clearInterval(initTimer);
        initTimer = null;
      }
      destroyFloatingBall();
    }
    refreshMenuCommand();
    return floatingEnabled;
  }

  function toggleFloatingBall() {
    return setFloatingBallEnabled(!floatingEnabled);
  }

  function isFloatingBallEnabled() {
    return floatingEnabled;
  }

  window.SGS91CardSorter = Object.freeze({
    sortBySuit,
    getCardContainer,
    isFloatingBallEnabled,
    setFloatingBallEnabled,
    toggleFloatingBall,
  });

  window.SGS91Assistant.registerModule({
    id: 'feature.hand-suit-sorter',
    type: 'feature',
    name: '手牌花色排序',
    version: '3.0.0',
    description: '通过油猴菜单开关默认关闭的 91 悬浮按钮，点击后按花色整理手牌显示顺序。',
    capabilities: ['hand-read', 'hand-display-sort', 'persistent-preference'],
    api: window.SGS91CardSorter,
  });

  refreshMenuCommand();
  if (floatingEnabled) scheduleInit();

})();
})(typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window);
