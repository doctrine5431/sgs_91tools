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
