'use strict';

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

const SELF_ONLY_OR_RESPONSE = new Set([
  '闪', '桃', '酒', '无懈可击', '无中生有', '闪电'
]);

const DISTANCE_ONE_TRICKS = new Set([
  '顺手牵羊', '兵粮寸断'
]);

const ANY_OTHER_TRICKS = new Set([
  '过河拆桥', '决斗', '火攻', '乐不思蜀', '铁索连环'
]);

const GLOBAL_OTHER_TRICKS = new Set([
  '南蛮入侵', '万箭齐发', '桃园结义', '五谷丰登'
]);

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

function computeCircularSeatDistance(fromSeat, toSeat, seatOrder) {
  const seats = Array.from(new Set(Array.isArray(seatOrder) ? seatOrder : []));
  if (fromSeat == null || toSeat == null) return null;
  if (fromSeat === toSeat) return 0;
  const fromIndex = seats.indexOf(fromSeat);
  const toIndex = seats.indexOf(toSeat);
  if (fromIndex < 0 || toIndex < 0 || seats.length <= 1) return null;
  const clockwise = (toIndex - fromIndex + seats.length) % seats.length;
  const counter = (fromIndex - toIndex + seats.length) % seats.length;
  return Math.max(1, Math.min(clockwise, counter));
}

function computeAliveSeatDistance(fromSeat, toSeat, seatOrder, deadSeats, directDistance = null) {
  if (fromSeat === toSeat) return 0;
  const dead = new Set(Array.isArray(deadSeats) ? deadSeats : []);
  if (dead.has(toSeat)) return null;
  const allSeats = Array.from(new Set(Array.isArray(seatOrder) ? seatOrder : []));
  const aliveSeats = allSeats.filter((seat) => !dead.has(seat));
  const fullBaseDistance = computeCircularSeatDistance(fromSeat, toSeat, allSeats);
  const aliveBaseDistance = computeCircularSeatDistance(fromSeat, toSeat, aliveSeats);
  if (aliveBaseDistance == null) return null;

  const rawDistance = Number(directDistance);
  if (!Number.isFinite(rawDistance) || fullBaseDistance == null) return aliveBaseDistance;
  const modifier = rawDistance - fullBaseDistance;
  return Math.max(1, aliveBaseDistance + modifier);
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
  const slashUsed = Number(context.slashUsedThisTurn || 0);
  const rawSlashLimit = context.slashLimit == null ? 1 : Number(context.slashLimit);
  const slashLimit = Number.isFinite(rawSlashLimit) ? Math.max(0, rawSlashLimit) : Infinity;

  if (!name) {
    return {
      ...card,
      name,
      canTargetOther: null,
      countsAsUnavailable: false,
      reason: '未识别牌名，暂不计入',
      confidence: 'unknown',
    };
  }

  if (isEquipment(card)) {
    return {
      ...card,
      name,
      canTargetOther: false,
      countsAsUnavailable: true,
      reason: '装备牌通常只能用于自己，不能指定其他角色',
      confidence: 'high',
    };
  }

  if (SELF_ONLY_OR_RESPONSE.has(name)) {
    return {
      ...card,
      name,
      canTargetOther: false,
      countsAsUnavailable: true,
      reason: `${name}通常不能在出牌阶段主动指定其他角色`,
      confidence: 'high',
    };
  }

  if (isSlashName(name)) {
    if (phase !== 'play') {
      return {
        ...card,
        name,
        canTargetOther: false,
        countsAsUnavailable: true,
        reason: '当前不是出牌阶段，【杀】不能主动指定其他角色',
        confidence: 'medium',
      };
    }
    if (slashLimit <= 0) {
      return {
        ...card,
        name,
        canTargetOther: false,
        countsAsUnavailable: true,
        reason: '本回合被限制为不能使用【杀】（0/0）',
        confidence: 'high',
      };
    }
    if (slashUsed >= slashLimit) {
      return {
        ...card,
        name,
        canTargetOther: false,
        countsAsUnavailable: true,
        reason: `本回合【杀】次数已用完（${slashUsed}/${slashLimit}）`,
        confidence: 'medium',
      };
    }
    if (!hasRangeTarget(context)) {
      return {
        ...card,
        name,
        canTargetOther: false,
        countsAsUnavailable: true,
        reason: '当前攻击范围内没有可指定的其他角色',
        confidence: 'medium',
      };
    }
    return {
      ...card,
      name,
      canTargetOther: true,
      countsAsUnavailable: false,
      reason: '【杀】次数未用完且范围内有目标',
      confidence: 'medium',
    };
  }

  if (DISTANCE_ONE_TRICKS.has(name)) {
    const ok = hasDistanceOneTarget(context);
    return {
      ...card,
      name,
      canTargetOther: ok,
      countsAsUnavailable: !ok,
      reason: ok ? `${name}有距离 1 内目标` : `${name}当前没有距离 1 内目标`,
      confidence: 'medium',
    };
  }

  if (name === '借刀杀人') {
    const ok = hasOtherWeaponTarget(context);
    return {
      ...card,
      name,
      canTargetOther: ok,
      countsAsUnavailable: !ok,
      reason: ok ? '场上其他角色有武器，可尝试借刀' : '其他角色都没有武器，借刀杀人不能使用',
      confidence: 'medium',
    };
  }

  if (ANY_OTHER_TRICKS.has(name) || GLOBAL_OTHER_TRICKS.has(name)) {
    const ok = hasAnyOther(context);
    return {
      ...card,
      name,
      canTargetOther: ok,
      countsAsUnavailable: !ok,
      reason: ok ? `${name}可指定/影响其他角色` : `${name}当前没有其他存活角色`,
      confidence: 'medium',
    };
  }

  return {
    ...card,
    name,
    canTargetOther: null,
    countsAsUnavailable: false,
    reason: '未知牌规则，暂不计入骤袭数量',
    confidence: 'unknown',
  };
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

module.exports = {
  normalizeCardName,
  isSlashName,
  computeAliveSeatDistance,
  judgeCardTargetability,
  evaluateJuxi,
};
