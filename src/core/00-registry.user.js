(function () {
  'use strict';

  if (window.SGS91Assistant) return;

  const modules = new Map();
  const services = new Map();
  const listeners = new Map();
  const allowedModuleTypes = new Set(['hero', 'feature', 'integration']);

  function requiredText(value, field) {
    const text = String(value || '').trim();
    if (!text) throw new TypeError(`Module ${field} is required.`);
    return text;
  }

  function toFrozenArray(value) {
    return Object.freeze(Array.isArray(value) ? value.slice() : []);
  }

  function registerModule(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new TypeError('Module definition must be an object.');
    }
    const id = requiredText(definition.id, 'id');
    const type = requiredText(definition.type, 'type');
    if (!allowedModuleTypes.has(type)) throw new TypeError(`Unsupported module type: ${type}`);
    if (modules.has(id)) throw new Error(`Duplicate module id: ${id}`);

    const record = Object.freeze({
      id,
      type,
      name: requiredText(definition.name, 'name'),
      version: requiredText(definition.version, 'version'),
      description: String(definition.description || '').trim(),
      capabilities: toFrozenArray(definition.capabilities),
      characterIds: toFrozenArray(definition.characterIds),
      skillIds: toFrozenArray(definition.skillIds),
      api: definition.api || Object.freeze({}),
    });
    modules.set(id, record);
    emit('module:registered', record);
    return record;
  }

  function getModule(id) {
    return modules.get(String(id)) || null;
  }

  function listModules(type) {
    const items = Array.from(modules.values());
    return type ? items.filter((item) => item.type === type) : items;
  }

  function registerService(name, service) {
    const id = requiredText(name, 'service name');
    if (!service || (typeof service !== 'object' && typeof service !== 'function')) {
      throw new TypeError(`Service ${id} must be an object or function.`);
    }
    if (services.has(id)) throw new Error(`Duplicate service: ${id}`);
    services.set(id, service);
    return service;
  }

  function getService(name) {
    return services.get(String(name)) || null;
  }

  function on(eventName, listener) {
    const name = requiredText(eventName, 'event name');
    if (typeof listener !== 'function') throw new TypeError('Event listener must be a function.');
    const group = listeners.get(name) || new Set();
    group.add(listener);
    listeners.set(name, group);
    return () => group.delete(listener);
  }

  function emit(eventName, payload) {
    const group = listeners.get(String(eventName));
    if (!group) return;
    for (const listener of Array.from(group)) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[三国杀91助手] 事件处理失败：${eventName}`, error);
      }
    }
  }

  window.SGS91Assistant = Object.freeze({
    name: '三国杀91助手',
    version: '__SGS91_VERSION__',
    registerModule,
    getModule,
    listModules,
    registerService,
    getService,
    on,
    emit,
  });
})();
