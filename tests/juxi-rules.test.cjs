'use strict';

const assert = require('node:assert/strict');
const { evaluateJuxi, computeAliveSeatDistance, normalizeCardName } = require('./juxi-rules.cjs');

function baseContext(overrides = {}) {
  return {
    isMouDengAi: true,
    isOwnTurn: true,
    currentPhase: 'play',
    selfSeat: 0,
    attackRange: 1,
    slashUsedThisTurn: 0,
    slashLimit: 1,
    seats: [
      { seat: 0, distance: 0 },
      { seat: 1, distance: 1, dead: false },
      { seat: 2, distance: 2, dead: false },
    ],
    ...overrides,
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('非谋邓艾不提示可用，但仍计算 X 数量', () => {
  const result = evaluateJuxi([
    { name: '闪' },
    { name: '桃' },
    { name: '诸葛连弩' },
  ], baseContext({ isMouDengAi: false }));
  assert.equal(result.unavailableCount, 3);
  assert.equal(result.canUseJuxi, false);
});

test('谋邓艾有三张不可对敌牌时提示可发动', () => {
  const result = evaluateJuxi([
    { name: '闪' },
    { name: '桃' },
    { name: '八卦阵' },
  ], baseContext());
  assert.equal(result.unavailableCount, 3);
  assert.equal(result.canUseJuxi, true);
});

test('不是自己的回合时不提示可发动', () => {
  const result = evaluateJuxi([
    { name: '闪' },
    { name: '桃' },
    { name: '八卦阵' },
  ], baseContext({ isOwnTurn: false }));
  assert.equal(result.unavailableCount, 3);
  assert.equal(result.isOwnPlayPhase, false);
  assert.equal(result.canUseJuxi, false);
});

test('杀未使用且范围内有目标时不计入不可对敌', () => {
  const result = evaluateJuxi([
    { name: '杀' },
    { name: '闪' },
    { name: '桃' },
  ], baseContext());
  assert.equal(result.unavailableCount, 2);
  assert.equal(result.judgedCards[0].countsAsUnavailable, false);
});

test('残局距离跳过阵亡座位，两张杀都不计入 X', () => {
  const seatOrder = [0, 1, 2, 3, 4, 5, 6, 7];
  const deadSeats = [1, 2, 6, 7];
  const seats = seatOrder.map((seat) => ({
    seat,
    dead: deadSeats.includes(seat),
    distance: computeAliveSeatDistance(0, seat, seatOrder, deadSeats, Math.min(seat, 8 - seat)),
  }));
  assert.equal(seats.find((seat) => seat.seat === 3).distance, 1);
  assert.equal(seats.find((seat) => seat.seat === 5).distance, 1);

  const result = evaluateJuxi([
    { name: '杀' },
    { name: '杀' },
  ], baseContext({
    slashUsedThisTurn: 0,
    slashLimit: 1,
    seats,
  }));
  assert.equal(result.unavailableCount, 0);
  assert.equal(result.judgedCards.every((card) => card.countsAsUnavailable === false), true);
});

test('杀已用完时计入不可对敌', () => {
  const result = evaluateJuxi([
    { name: '杀' },
    { name: '闪' },
    { name: '桃' },
  ], baseContext({ slashUsedThisTurn: 1 }));
  assert.equal(result.unavailableCount, 3);
  assert.equal(result.judgedCards[0].countsAsUnavailable, true);
});

test('剩余杀次数为 0 时，多张杀都计入不可对敌', () => {
  const result = evaluateJuxi([
    { name: '杀' },
    { name: '杀' },
  ], baseContext({ slashUsedThisTurn: 1, slashLimit: 1 }));
  assert.equal(result.unavailableCount, 2);
  assert.equal(result.judgedCards[0].countsAsUnavailable, true);
  assert.equal(result.judgedCards[1].countsAsUnavailable, true);
});

test('杀上限为 0 时，所有杀都计入不可对敌', () => {
  const result = evaluateJuxi([
    { name: '杀' },
    { name: '雷杀' },
    { name: '火杀' },
  ], baseContext({ slashUsedThisTurn: 0, slashLimit: 0 }));
  assert.equal(result.unavailableCount, 3);
  assert.equal(result.judgedCards.every((card) => card.countsAsUnavailable), true);
});

test('剩余杀次数还有时，多张杀都按可对敌处理', () => {
  const result = evaluateJuxi([
    { name: '杀' },
    { name: '闪' },
    { name: '闪' },
    { name: '酒' },
    { name: '杀' },
    { name: '借刀杀人' },
  ], baseContext({
    slashUsedThisTurn: 0,
    slashLimit: 1,
    seats: [
      { seat: 0, distance: 0 },
      { seat: 1, distance: 1, dead: false, hasWeapon: false },
      { seat: 2, distance: 2, dead: false, hasWeapon: false },
    ],
  }));
  assert.equal(result.unavailableCount, 4);
  assert.equal(result.judgedCards[0].countsAsUnavailable, false);
  assert.equal(result.judgedCards[4].countsAsUnavailable, false);
  assert.equal(result.judgedCards[5].countsAsUnavailable, true);
});

test('杀无范围内目标时计入不可对敌', () => {
  const result = evaluateJuxi([
    { name: '杀' },
    { name: '闪' },
    { name: '桃' },
  ], baseContext({
    seats: [
      { seat: 0, distance: 0 },
      { seat: 1, distance: 2, dead: false },
    ],
  }));
  assert.equal(result.unavailableCount, 3);
  assert.equal(result.judgedCards[0].countsAsUnavailable, true);
});

test('未知牌不计入三张，并出现在诊断原因里', () => {
  const result = evaluateJuxi([
    { name: '奇怪牌' },
    { name: '闪' },
    { name: '桃' },
  ], baseContext());
  assert.equal(result.unavailableCount, 2);
  assert.equal(result.judgedCards[0].confidence, 'unknown');
});

test('截图手牌桃杀无中顺手至少把桃和无中计入', () => {
  const result = evaluateJuxi([
    { name: '桃' },
    { name: '杀' },
    { name: '无中生有' },
    { name: '顺手牵羊' },
  ], baseContext());
  assert.equal(result.unavailableCount, 2);
  assert.equal(result.judgedCards[0].countsAsUnavailable, true);
  assert.equal(result.judgedCards[2].countsAsUnavailable, true);
});

test('借刀杀人在其他角色都没有武器时计入不可对敌', () => {
  const result = evaluateJuxi([
    { name: '借刀杀人' },
    { name: '闪' },
    { name: '桃' },
  ], baseContext({
    seats: [
      { seat: 0, distance: 0, hasWeapon: true },
      { seat: 1, distance: 1, dead: false, hasWeapon: false },
      { seat: 2, distance: 2, dead: false, hasWeapon: false },
    ],
  }));
  assert.equal(result.judgedCards[0].countsAsUnavailable, true);
  assert.equal(result.unavailableCount, 3);
});

test('游戏短牌名借刀按借刀杀人处理', () => {
  assert.equal(normalizeCardName('借刀'), '借刀杀人');
  const result = evaluateJuxi([
    { name: '借刀', rawSummary: { __ctor: 'JieDaoShaRenNCard' } },
  ], baseContext({
    seats: [
      { seat: 0, distance: 0, hasWeapon: true },
      { seat: 1, distance: 1, dead: false, hasWeapon: false },
      { seat: 2, distance: 2, dead: false, hasWeapon: false },
    ],
  }));
  assert.equal(result.unavailableCount, 1);
  assert.equal(result.judgedCards[0].countsAsUnavailable, true);
  assert.equal(result.judgedCards[0].reason, '其他角色都没有武器，借刀杀人不能使用');
});

test('借刀杀人在其他角色有武器时不计入不可对敌', () => {
  const result = evaluateJuxi([
    { name: '借刀杀人' },
    { name: '闪' },
    { name: '桃' },
  ], baseContext({
    seats: [
      { seat: 0, distance: 0 },
      { seat: 1, distance: 1, dead: false, hasWeapon: true },
      { seat: 2, distance: 2, dead: false, hasWeapon: false },
    ],
  }));
  assert.equal(result.judgedCards[0].countsAsUnavailable, false);
  assert.equal(result.unavailableCount, 2);
});

test('铁索连环有其他角色时可指定别人', () => {
  const result = evaluateJuxi([
    { name: '铁索连环' },
    { name: '闪' },
    { name: '桃' },
  ], baseContext());
  assert.equal(result.judgedCards[0].countsAsUnavailable, false);
  assert.equal(result.unavailableCount, 2);
});

test('基础与自用响应牌逐张计入不可对敌', () => {
  const names = ['闪', '桃', '酒', '无懈可击', '无中生有', '闪电'];
  for (const name of names) {
    const result = evaluateJuxi([{ name }], baseContext());
    assert.equal(result.judgedCards[0].countsAsUnavailable, true, name);
    assert.notEqual(result.judgedCards[0].confidence, 'unknown', name);
  }
});

test('距离一锦囊按距离判断', () => {
  for (const name of ['顺手牵羊', '兵粮寸断']) {
    const usable = evaluateJuxi([{ name }], baseContext());
    assert.equal(usable.judgedCards[0].countsAsUnavailable, false, `${name} close`);
    const blocked = evaluateJuxi([{ name }], baseContext({
      seats: [
        { seat: 0, distance: 0 },
        { seat: 1, distance: 2, dead: false },
      ],
    }));
    assert.equal(blocked.judgedCards[0].countsAsUnavailable, true, `${name} far`);
  }
});

test('常见指定锦囊有其他角色时可用，无其他角色时不可用', () => {
  for (const name of ['过河拆桥', '决斗', '火攻', '乐不思蜀', '铁索连环']) {
    const usable = evaluateJuxi([{ name }], baseContext());
    assert.equal(usable.judgedCards[0].countsAsUnavailable, false, `${name} has target`);
    const blocked = evaluateJuxi([{ name }], baseContext({ seats: [{ seat: 0, distance: 0 }] }));
    assert.equal(blocked.judgedCards[0].countsAsUnavailable, true, `${name} no target`);
  }
});

test('全场锦囊有其他角色时视为可影响别人', () => {
  for (const name of ['南蛮入侵', '万箭齐发', '桃园结义', '五谷丰登']) {
    const usable = evaluateJuxi([{ name }], baseContext());
    assert.equal(usable.judgedCards[0].countsAsUnavailable, false, `${name} has others`);
    const blocked = evaluateJuxi([{ name }], baseContext({ seats: [{ seat: 0, distance: 0 }] }));
    assert.equal(blocked.judgedCards[0].countsAsUnavailable, true, `${name} alone`);
  }
});

test('装备牌逐张计入不可对敌', () => {
  for (const name of ['诸葛连弩', '八卦阵', '的卢', '木牛流马']) {
    const result = evaluateJuxi([{ name }], baseContext());
    assert.equal(result.judgedCards[0].countsAsUnavailable, true, name);
    assert.equal(result.judgedCards[0].confidence, 'high', name);
  }
});

test('显示用 X 与不可对敌数量一致', () => {
  const result = evaluateJuxi([
    { name: '杀' },
    { name: '闪' },
    { name: '桃' },
    { name: '酒' },
  ], baseContext());
  const stripText = `骤袭 X=${result.unavailableCount}${result.canUseJuxi ? ' 可用' : ''}`;
  assert.equal(stripText, '骤袭 X=3 可用');
});
