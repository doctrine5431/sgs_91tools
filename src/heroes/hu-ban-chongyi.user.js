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
