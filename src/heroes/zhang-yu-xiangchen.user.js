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
