// ==UserScript==
// @name         三国杀 谋邓艾骤袭提示助手
// @namespace    sgs-mou-deng-ai-juxi-helper
// @version      1.0.4
// @description  只读提示谋邓艾骤袭：计算不能对其他角色使用的手牌数量，标记手牌，并在自己身上显示 X。
// @author       FAWEI
// @license      MIT
// @match        https://web.sanguosha.com/*
// @match        https://*.sanguosha.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

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
