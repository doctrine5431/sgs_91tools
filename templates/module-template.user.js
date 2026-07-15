(function () {
  'use strict';

  const app = window.SGS91Assistant;
  const gameScene = app.getService('gameScene');

  function probe() {
    return {
      gameScene: gameScene.getGameScene(),
      selfSeatUi: gameScene.getSelfSeatUi(),
      cardContainer: gameScene.getCardContainer(),
    };
  }

  const api = Object.freeze({ probe });

  app.registerModule({
    id: 'hero.example.skill',
    type: 'hero',
    name: '示例武将·示例技能',
    version: '0.1.0',
    description: '说明这个模块给玩家提供什么帮助。',
    capabilities: ['game-state-read'],
    characterIds: [],
    skillIds: [],
    api,
  });
})();
