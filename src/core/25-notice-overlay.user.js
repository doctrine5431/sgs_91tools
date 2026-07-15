(function () {
  'use strict';

  const app = window.SGS91Assistant;
  if (!app) throw new Error('SGS91 core must load before notice-overlay service.');
  if (app.getService('noticeOverlay')) return;

  const rendered = new Map();
  const STYLE = Object.freeze({
    resourceKey: 'gameActionBg',
    fallbackWidth: 640,
    fallbackHeight: 50,
    privateWidthFactor: 1.3,
    publicWidthFactor: 1.1,
    maxWidthFactor: 1.5,
    privateAutoWidthPaddingRatio: 0.05,
    publicAutoWidthPaddingRatio: 0.1,
    gradientColor: '#0d0d0d',
    gradientStripCount: 128,
    gradientStops: Object.freeze([
      Object.freeze({ pos: 0, alpha: 0 }),
      Object.freeze({ pos: 0.16, alpha: 0.56 }),
      Object.freeze({ pos: 0.84, alpha: 0.56 }),
      Object.freeze({ pos: 1, alpha: 0 }),
    ]),
    noticeBaseY: 314,
    groupOffsetY: -6,
    privateOffsetY: 35,
    privateDefaultDy: 200,
    actionPromptGap: 36,
    font: 'FZBW',
    fontSize: 24,
    fzbwOffsetY: 1.5,
    textColor: '#f6de9c',
    zOrder: 99999,
  });
  let feed = null;
  let feedParent = null;

  function findLayaObject(root, predicate, maxObjects = 5000) {
    if (!root || typeof predicate !== 'function') return null;
    const queue = [root];
    const seen = new Set();
    while (queue.length && seen.size < maxObjects) {
      const object = queue.shift();
      if (!object || typeof object !== 'object' || seen.has(object)) continue;
      seen.add(object);
      try { if (predicate(object)) return object; } catch {}
      if (Array.isArray(object._children)) queue.push(...object._children);
    }
    return null;
  }

  function findSurface() {
    const stage = window.Laya?.stage;
    const scene = findLayaObject(stage, (object) => Boolean(
      object?.gameActionTipContainer && typeof object.gameActionTipContainer.addChild === 'function'
    ));
    return scene ? { scene, layer: scene.gameActionTipContainer } : null;
  }

  function readNodeText(node) {
    try {
      return String(node?.text ?? node?._text ?? node?.htmlText ?? '').replace(/\s+/g, '');
    } catch {
      return '';
    }
  }

  function isVisibleWithin(node, ancestor) {
    let current = node;
    while (current && current !== ancestor) {
      if (current.visible === false || Number(current.alpha) === 0) return false;
      current = current.parent;
    }
    return current === ancestor;
  }

  function nodeTopWithin(node, ancestor) {
    try {
      if (typeof node?.localToGlobal === 'function' && typeof ancestor?.globalToLocal === 'function') {
        const Point = window.Laya?.Point;
        const origin = Point ? new Point(0, 0) : { x: 0, y: 0 };
        const globalPoint = node.localToGlobal(origin);
        const localPoint = ancestor.globalToLocal(globalPoint);
        if (Number.isFinite(Number(localPoint?.y))) return Number(localPoint.y);
      }
    } catch {}

    let y = 0;
    let current = node;
    while (current && current !== ancestor) {
      const scaleY = Number.isFinite(Number(current.scaleY)) ? Number(current.scaleY) : 1;
      y = (Number(current.y) || 0) + y * scaleY;
      current = current.parent;
    }
    return current === ancestor && Number.isFinite(y) ? y : null;
  }

  function findActionPromptY(layer) {
    const candidates = [];
    const queue = [...(layer?._children || [])];
    const seen = new Set();
    while (queue.length && seen.size < 2000) {
      const node = queue.shift();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      if (node.name === 'sgs91-notice-feed') continue;
      const text = readNodeText(node);
      if ((text.includes('请选择') && text.includes('卡牌'))
        || (text.includes('出牌阶段') && text.includes('选择'))) {
        const y = isVisibleWithin(node, layer) ? nodeTopWithin(node, layer) : null;
        if (Number.isFinite(y)) candidates.push(y);
      }
      if (Array.isArray(node._children)) queue.push(...node._children);
    }
    return candidates.length ? Math.min(...candidates) : null;
  }

  function getBannerResource() {
    try {
      return window.RES?.GetRes?.(STYLE.resourceKey)
        || window.Laya?.loader?.getRes?.(STYLE.resourceKey)
        || window.Laya?.Loader?.getRes?.(STYLE.resourceKey)
        || null;
    } catch {
      return null;
    }
  }

  function ensureFeed(layer) {
    const Laya = window.Laya;
    if (!layer || !Laya?.Sprite || typeof layer.addChild !== 'function') return null;
    if (feed && feedParent === layer && feed.parent === layer) return feed;
    try { feed?.removeSelf?.(); } catch {}
    feed = new Laya.Sprite();
    feed.name = 'sgs91-notice-feed';
    feed.zOrder = STYLE.zOrder;
    feed.mouseEnabled = false;
    layer.addChild(feed);
    feedParent = layer;
    return feed;
  }

  function normalizeParts(options) {
    if (Array.isArray(options?.parts) && options.parts.length) return options.parts.map((part) => ({
      text: String(part?.text ?? ''),
      font: part?.font || STYLE.font,
      size: Number(part?.size) || STYLE.fontSize,
      color: part?.color || STYLE.textColor,
      offsetY: Number.isFinite(Number(part?.offsetY)) ? Number(part.offsetY) : STYLE.fzbwOffsetY,
    }));
    return [{
      text: String(options?.text || ''),
      font: STYLE.font,
      size: STYLE.fontSize,
      color: STYLE.textColor,
      offsetY: STYLE.fzbwOffsetY,
    }];
  }

  function createText(part) {
    const label = new window.Laya.Text();
    label.text = part.text;
    label.font = part.font;
    label.fontSize = part.size;
    label.color = part.color;
    label.valign = 'middle';
    label.mouseEnabled = false;
    return label;
  }

  function measuredWidth(label) {
    const direct = Math.ceil(Number(label?.textWidth) || 0);
    if (direct > 0) return direct;
    return Math.ceil(Array.from(String(label?.text || '')).reduce((sum, character) => (
      sum + (/^[\x00-\xff]$/.test(character) ? Number(label.fontSize) * 0.58 : Number(label.fontSize))
    ), 0));
  }

  function gradientAlpha(position) {
    const stops = STYLE.gradientStops;
    if (position <= stops[0].pos) return stops[0].alpha;
    for (let index = 1; index < stops.length; index += 1) {
      const right = stops[index];
      if (position > right.pos) continue;
      const left = stops[index - 1];
      let ratio = right.pos > left.pos ? (position - left.pos) / (right.pos - left.pos) : 0;
      ratio = ratio * ratio * (3 - 2 * ratio);
      return left.alpha + (right.alpha - left.alpha) * ratio;
    }
    return stops[stops.length - 1].alpha;
  }

  function drawGradient(row, width, height) {
    const Sprite = window.Laya.Sprite;
    for (let index = 0; index < STYLE.gradientStripCount; index += 1) {
      const left = Math.round(index * width / STYLE.gradientStripCount);
      const right = Math.round((index + 1) * width / STYLE.gradientStripCount);
      if (right <= left) continue;
      const strip = new Sprite();
      strip.name = 'sgs91-notice-gradient-strip';
      strip.size(right - left, height);
      strip.pos(left, 0);
      strip.graphics.drawRect(0, 0, right - left, height, STYLE.gradientColor);
      strip.alpha = Math.max(0, Math.min(1, gradientAlpha((index + 0.5) / STYLE.gradientStripCount)));
      strip.mouseEnabled = false;
      row.addChild(strip);
    }
  }

  function clear(key) {
    const id = String(key || '');
    const item = rendered.get(id);
    try { item?.row?.removeSelf?.(); } catch {}
    try { item?.row?.destroy?.(true); } catch {}
    rendered.delete(id);
    return true;
  }

  function show(key, options = {}) {
    if (!key || !options?.text) return false;
    const Laya = window.Laya;
    const surface = findSurface();
    if (!Laya?.Sprite || !Laya?.Text || !surface) return false;
    clear(key);

    const lane = options.lane === 'private' ? 'private' : 'public';
    const resource = getBannerResource();
    const baseWidth = Math.round(Number(resource?.width) || STYLE.fallbackWidth);
    const height = Math.round(Number(resource?.height) || STYLE.fallbackHeight);
    const parts = normalizeParts(options);
    const labels = parts.map(createText);
    const widths = labels.map(measuredWidth);
    const textWidth = widths.reduce((sum, width) => sum + width, 0);
    const widthFactor = lane === 'private' ? STYLE.privateWidthFactor : STYLE.publicWidthFactor;
    const paddingRatio = lane === 'private'
      ? STYLE.privateAutoWidthPaddingRatio : STYLE.publicAutoWidthPaddingRatio;
    const width = Math.min(
      Math.round(baseWidth * STYLE.maxWidthFactor),
      Math.max(Math.round(baseWidth * widthFactor), Math.ceil(textWidth * (1 + paddingRatio * 2))),
    );
    const sceneWidth = Number(surface.scene?.width) || Number(Laya.stage?.width) || 1600;
    const dx = Number(options.dx) || 0;
    const dy = lane === 'private'
      ? (Number.isFinite(Number(options.dy)) ? Number(options.dy) : STYLE.privateDefaultDy)
      : (Number(options.dy) || 0);
    const noticeBaseY = (Number.isFinite(Number(options.noticeBaseY))
      ? Number(options.noticeBaseY)
      : STYLE.noticeBaseY);
    const normalBaseY = noticeBaseY + dy + (lane === 'private' ? STYLE.privateOffsetY : 0);
    const promptY = options.anchor === 'before-action-prompt'
      ? findActionPromptY(surface.layer)
      : null;
    const promptGap = Number.isFinite(Number(options.anchorGap))
      ? Number(options.anchorGap)
      : STYLE.actionPromptGap;
    const baseY = Number.isFinite(promptY)
      ? Math.round(promptY - height - promptGap)
      : options.anchor === 'notice-base' ? noticeBaseY : normalBaseY;

    const row = new Laya.Sprite();
    row.name = `sgs91-notice-overlay-${String(key).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    row.zOrder = STYLE.zOrder;
    row.mouseEnabled = false;
    row.size(width, height);
    row.pos(Math.round((sceneWidth - width) / 2) + dx, baseY);
    drawGradient(row, width, height);

    const content = new Laya.Sprite();
    content.name = 'sgs91-notice-content';
    content.size(width, height);
    content.mouseEnabled = false;
    let x = Math.round((width - textWidth) / 2);
    labels.forEach((label, index) => {
      label.pos(x, Math.round((height - label.fontSize) / 2) + parts[index].offsetY);
      content.addChild(label);
      x += widths[index];
    });
    row.addChild(content);
    const parent = ensureFeed(surface.layer);
    if (!parent) return false;
    parent.addChild(row);
    rendered.set(String(key), { row, lane, text: String(options.text), width, height });
    return true;
  }

  app.registerService('noticeOverlay', Object.freeze({
    show,
    clear,
    findSurface,
    style: STYLE,
    probe() {
      return Array.from(rendered.entries()).map(([key, value]) => ({
        key,
        lane: value.lane,
        text: value.text,
        width: value.width,
        height: value.height,
        x: value.row?.x,
        y: value.row?.y,
      }));
    },
  }));
})();
