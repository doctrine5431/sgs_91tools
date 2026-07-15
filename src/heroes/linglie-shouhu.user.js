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
