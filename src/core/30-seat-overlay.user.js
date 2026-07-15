(function () {
  'use strict';

  const app = window.SGS91Assistant;
  if (!app) throw new Error('SGS91 core must load before seat-overlay service.');
  if (app.getService('seatOverlay')) return;

  const rendered = new Map();
  const STRIP_STYLE = Object.freeze({
    imageUrl: 'https://web.sanguosha.com/10/pc/res/assets/game/yjcmSeat.webp?v=ca8060a813',
    frame: Object.freeze({ x: 972, y: 825, width: 175, height: 23 }),
    x: 7,
    y: 28,
    textDy: 2,
    font: 'FZBW',
    fontSize: 16,
    color: 'rgb(242, 217, 87)',
  });
  let stripTexture = null;
  let textureLoadStarted = false;

  function isRealSeat(value) {
    const seat = Number(value);
    return Number.isFinite(seat) && seat >= 0 && seat < 12;
  }

  function findLayaObject(root, predicate, maxObjects = 3200) {
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

  function findGameManager() {
    const stage = window.Laya?.stage;
    if (!stage) return null;
    return findLayaObject(stage, (object) => {
      if (object.gameManager?.Seats || object.gameManager?.seats) return true;
      return Boolean((object.Seats || object.seats) && (
        object.selfSeatIndex != null || object.SelfSeatIndex != null || object.selfSeat != null
      ));
    })?.gameManager || findLayaObject(stage, (object) => Boolean(
      (object.Seats || object.seats) && (
        object.selfSeatIndex != null || object.SelfSeatIndex != null || object.selfSeat != null
      )
    ));
  }

  function readSeatObject(manager, seat) {
    const seats = manager?.Seats || manager?.seats;
    if (!seats || !isRealSeat(seat)) return null;
    try { return seats[seat] || seats.getNumberKey?.(Number(seat)) || null; }
    catch { return null; }
  }

  function findSeatAvatar(seat) {
    const object = readSeatObject(findGameManager(), seat);
    const direct = object?.SeatUI?.seatAvatar || object?.seatUI?.seatAvatar
      || object?.SeatUI?.avatar || object?.seatUI?.avatar
      || object?.seatAvatar || object?.avatar;
    if (direct && typeof direct.localToGlobal === 'function') return direct;
    const stage = window.Laya?.stage;
    return findLayaObject(stage, (candidate) => {
      const candidateSeat = Number(candidate?.seat ?? candidate?.seatId ?? candidate?.SeatId ?? candidate?.userSeat);
      const name = String(candidate?.name || candidate?.constructor?.name || '');
      return candidateSeat === Number(seat)
        && /avatar|seat/i.test(name)
        && typeof candidate.localToGlobal === 'function';
    }, 1800);
  }

  function findSeatLayer() {
    const stage = window.Laya?.stage;
    return findLayaObject(stage, (object) => {
      const name = String(object?.name || object?.constructor?.name || '');
      return /seatComboSprite|seatComboLayer|seatLayer/i.test(name)
        && typeof object.globalToLocal === 'function'
        && typeof object.addChild === 'function';
    }, 1800) || stage;
  }

  function safeDomId(key) {
    return `sgs91-seat-overlay-${String(key).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  function textureSource(resource) {
    return resource?.bitmap || resource?._bitmap || resource?.source || resource || null;
  }

  function getCachedResource() {
    const Laya = window.Laya;
    const plainUrl = STRIP_STYLE.imageUrl.split('?')[0];
    for (const url of [STRIP_STYLE.imageUrl, plainUrl]) {
      try {
        const resource = Laya?.loader?.getRes?.(url) || Laya?.Loader?.getRes?.(url);
        if (resource) return resource;
      } catch {}
    }
    return null;
  }

  function createStripTexture() {
    if (stripTexture) return stripTexture;
    const Laya = window.Laya;
    const source = textureSource(getCachedResource());
    if (!source || !Laya?.Texture?.create) return null;
    const frame = STRIP_STYLE.frame;
    try {
      stripTexture = Laya.Texture.create(
        source,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        0,
        0,
        frame.width,
        frame.height,
      ) || null;
    } catch {
      stripTexture = null;
    }
    return stripTexture;
  }

  function redrawAfterTextureLoad() {
    stripTexture = null;
    const rows = Array.from(rendered.entries()).map(([key, value]) => ({
      key,
      seat: value.seat,
      text: value.text,
      options: value.options || {},
    }));
    rows.forEach((row) => show(row.key, row.seat, row.text, row.options));
  }

  function preloadStripTexture() {
    if (createStripTexture() || textureLoadStarted) return;
    const Laya = window.Laya;
    if (!Laya?.loader?.load) return;
    textureLoadStarted = true;
    try {
      const complete = Laya.Handler?.create
        ? Laya.Handler.create(null, redrawAfterTextureLoad)
        : redrawAfterTextureLoad;
      Laya.loader.load(STRIP_STYLE.imageUrl, complete, null, Laya.Loader?.IMAGE);
    } catch {
      textureLoadStarted = false;
    }
  }

  function fittedFontSize(text, requested, options, width) {
    let size = Math.max(10, Number(requested) || STRIP_STYLE.fontSize);
    if (options.fitText !== true) return size;
    const minimum = Math.max(8, Number(options.minFontSize) || 12);
    const padding = Math.max(0, Number(options.textPaddingX) || 0);
    const available = Math.max(1, width - padding * 2 - 2);
    const estimatedUnits = Array.from(String(text)).reduce((sum, character) => (
      sum + (/\s/.test(character) ? 0.35 : /[\x00-\xff]/.test(character) ? 0.62 : 1)
    ), 0);
    while (size > minimum && estimatedUnits * size > available) size -= 1;
    return size;
  }

  function clear(key) {
    const id = String(key);
    const item = rendered.get(id);
    if (item?.node) {
      try { item.node.removeSelf?.(); } catch {}
      try { item.node.remove?.(); } catch {}
    }
    document.getElementById(safeDomId(id))?.remove();
    rendered.delete(id);
    return true;
  }

  function renderLaya(key, seat, text, options) {
    const Laya = window.Laya;
    const avatar = findSeatAvatar(seat);
    const layer = findSeatLayer();
    if (!Laya?.Sprite || !Laya?.Text || !Laya?.Point || !avatar || !layer
      || typeof avatar.localToGlobal !== 'function' || typeof layer.globalToLocal !== 'function'
      || typeof layer.addChild !== 'function') return false;
    try {
      const texture = createStripTexture();
      if (!texture) preloadStripTexture();
      const width = Number(texture?.width) || STRIP_STYLE.frame.width;
      const height = Number(texture?.height) || STRIP_STYLE.frame.height;
      const fontSize = fittedFontSize(text, options.fontSize, options, width);
      const center = avatar.localToGlobal(new Laya.Point(
        (avatar.width || 0) / 2,
        (avatar.height || 0) / 2,
      ), true);
      const local = layer.globalToLocal(new Laya.Point(center.x, center.y), true);
      const strip = new Laya.Sprite();
      strip.name = `sgs91-seat-overlay-${key}`;
      strip.zOrder = Number(options.zOrder) || 99999;
      strip.size(width, height);
      strip.pos(
        Math.round(local.x - width / 2 + (Number(options.x) || STRIP_STYLE.x)),
        Math.round(local.y - height / 2 + (Number(options.y) || STRIP_STYLE.y)),
      );
      if (texture && typeof strip.graphics.drawTexture === 'function') {
        strip.graphics.drawTexture(texture, 0, 0, width, height);
      } else {
        try { strip.graphics.drawRect(0, 0, width, height, options.background || '#2b2b2b', options.borderColor || '#a78649', 1); }
        catch { strip.graphics.drawRect(0, 0, width, height, options.background || '#2b2b2b'); }
      }
      const label = new Laya.Text();
      label.text = String(text);
      label.font = options.font || STRIP_STYLE.font;
      label.fontSize = fontSize;
      label.bold = options.bold !== false;
      label.color = options.color || STRIP_STYLE.color;
      label.align = 'center';
      label.valign = 'middle';
      const padding = Math.max(0, Number(options.textPaddingX) || 0);
      label.width = Math.max(1, width - padding * 2);
      label.height = height;
      label.pos?.(padding, Number(options.textDy) || STRIP_STYLE.textDy);
      strip.addChild(label);
      layer.addChild(strip);
      rendered.set(String(key), {
        mode: 'laya', node: strip, seat: Number(seat), text: String(text), options: { ...options },
      });
      return true;
    } catch {
      return false;
    }
  }

  function avatarClientPoint(avatar) {
    const Laya = window.Laya;
    if (!Laya?.Point || !avatar || typeof avatar.localToGlobal !== 'function') return null;
    try {
      const point = avatar.localToGlobal(new Laya.Point(
        (avatar.width || 0) / 2,
        (avatar.height || 0) / 2,
      ), true);
      const canvas = Laya.stage?.canvas || Laya.stage?._canvas;
      const rect = canvas?.getBoundingClientRect?.();
      if (rect && Laya.stage?.width && Laya.stage?.height) {
        return {
          x: rect.left + point.x * rect.width / Laya.stage.width,
          y: rect.top + point.y * rect.height / Laya.stage.height,
        };
      }
      return { x: point.x, y: point.y };
    } catch {
      return null;
    }
  }

  function renderDom(key, seat, text, options) {
    if (!document.body) return false;
    const point = avatarClientPoint(findSeatAvatar(seat));
    if (!point) return false;
    const element = document.createElement('div');
    element.id = safeDomId(key);
    element.textContent = String(text);
    const width = STRIP_STYLE.frame.width;
    const height = STRIP_STYLE.frame.height;
    const fontSize = fittedFontSize(text, options.fontSize, options, width);
    Object.assign(element.style, {
      position: 'fixed',
      left: `${Math.round(point.x - width / 2 + (Number(options.x) || STRIP_STYLE.x))}px`,
      top: `${Math.round(point.y - height / 2 + (Number(options.y) || STRIP_STYLE.y))}px`,
      zIndex: String(options.zOrder || 99999),
      width: `${width}px`,
      height: `${height}px`,
      boxSizing: 'border-box',
      padding: `${Number(options.textDy) || STRIP_STYLE.textDy}px ${Math.max(0, Number(options.textPaddingX) || 0)}px 0`,
      border: '0',
      borderRadius: '0',
      background: options.background || 'rgba(43, 43, 43, .94)',
      backgroundImage: `url("${STRIP_STYLE.imageUrl}")`,
      backgroundPosition: `-${STRIP_STYLE.frame.x}px -${STRIP_STYLE.frame.y}px`,
      backgroundRepeat: 'no-repeat',
      color: options.color || STRIP_STYLE.color,
      font: `${options.bold === false ? '400' : '700'} ${fontSize}px/${height}px ${options.font || STRIP_STYLE.font}, sans-serif`,
      textAlign: 'center',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      overflow: 'hidden',
    });
    document.body.appendChild(element);
    rendered.set(String(key), {
      mode: 'dom', node: element, seat: Number(seat), text: String(text), options: { ...options },
    });
    return true;
  }

  function show(key, seat, text, options = {}) {
    if (!key || !isRealSeat(seat) || !text) return false;
    clear(key);
    return renderLaya(String(key), Number(seat), String(text), options)
      || renderDom(String(key), Number(seat), String(text), options);
  }

  function clearPrefix(prefix) {
    for (const key of Array.from(rendered.keys())) {
      if (key.startsWith(String(prefix))) clear(key);
    }
  }

  app.registerService('seatOverlay', Object.freeze({
    show,
    clear,
    clearPrefix,
    findGameManager,
    readSeatObject,
    findSeatAvatar,
    style: STRIP_STYLE,
    probe() {
      return Array.from(rendered.entries()).map(([key, value]) => ({
        key,
        mode: value.mode,
        seat: value.seat,
        text: value.text,
      }));
    },
  }));
})();
