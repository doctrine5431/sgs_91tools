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
