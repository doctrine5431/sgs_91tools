// ==UserScript==
// @name         三国杀手牌花色排序
// @namespace    sgs-card-sorter
// @version      3.0
// @description  通过油猴菜单开关可拖拽的花色排序悬浮按钮
// @author       FAWEI
// @license      MIT
// @match        https://web.sanguosha.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @sandbox      raw
// @inject-into  page
// @run-at       document-idle
// ==/UserScript==

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
