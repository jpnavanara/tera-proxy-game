const protocol = require('tera-data').protocol;
const Wrapper = require('./dispatchWrapper');

const moduleNameSymbol = Symbol('moduleName');

class Dispatch {
  constructor() {
    this.connection = null;
    this.modules = {};
    this.hooks = { raw: {}, pre: {} };
  }

  reset() {
    for (let name in this.modules) {
      this.unload(name);
    }

    // ensure empty objects
    this.modules = {};
    this.hooks = { raw: {}, pre: {} };
  }

  load(name, from = module) {
    if (this.modules[name]) return this.modules[name];

    try {
      const mod = from.require(name);
      const wrapper = new Wrapper(this, name);
      this.modules[name] = new mod(wrapper);

      console.log('[dispatch] loaded "%s"', name);
      return this.modules[name];
    } catch (e) {
      console.error('[dispatch] load: error initializing module "%s"', name);
      console.error(e.stack);
    }
  }

  unload(name) {
    const mod = this.modules[name];

    if (!mod) {
      console.warn('[dispatch] unload: cannot unload non-loaded module "%s"', name);
      return false;
    }

    for (let type in this.hooks) {
      const hooks = this.hooks[type];
      for (let code in hooks) {
        hooks[code] = hooks[code].filter(cb => cb[moduleNameSymbol] !== name);
      }
    }

    if (typeof mod.destructor === 'function') {
      try {
        mod.destructor();
      } catch (e) {
        console.warn('[dispatch] unload: error running destructor for module "%s"', name);
        console.warn(e.stack);
      }
    }

    delete this.modules[name];
    return true;
  }

  _resolveHook(name, type, cb) {
    // optional arg `type` defaults 'pre'
    if (!cb) {
      cb = type;
      type = 'pre';
    }

    let code;
    if (name === '*') {
      type = 'raw';
      code = name;
    } else {
      code = protocol.map.name[name];
      if (code == null) {
        console.warn('[dispatch] (un)hook: unrecognized name "%s"', name);
        code = '_unknown';
      }
    }

    let hooks = this.hooks[type];
    if (!hooks) {
      console.warn('[dispatch] (un)hook: unexpected hook type "%s"', type);
      hooks = this.hooks.pre;
    }

    if (typeof cb !== 'function') {
      console.warn('[dispatch] (un)hook: last argument is not a callback (given %s)', typeof cb);
      cb = () => {};
    }

    return { hooks, code, cb };
  }

  hook() {
    const { hooks, code, cb } = this._resolveHook(...arguments);

    if (!hooks[code]) {
      hooks[code] = [];
    }

    hooks[code].push(cb);
  }

  hookFromModule(name, ...args) {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      cb[moduleNameSymbol] = name;
    }
    this.hook(...args);
  }

  unhook() {
    const { hooks, code, cb } = this._resolveHook(...arguments);

    const index = hooks[code].indexOf(cb);
    if (index === -1) {
      console.error('[dispatch] unhook: could not find cb');
      return;
    }

    return hooks[code].splice(index, 1);
  }

  write(outgoing, name, data) {
    if (!this.connection) return false;
    if (Buffer.isBuffer(name)) {
      data = name;
    } else {
      try {
        data = protocol.write(name, data);
      } catch (e) {
        console.error('[dispatch] write: failed to generate message: %s', name);
        console.error('error: %s', e.message);
        console.error('data:');
        console.error(data);
        console.error('stack:');
        console.error(e.stack);
        return false;
      }
    }
    this.connection[outgoing ? 'sendServer' : 'sendClient'](data);
    return true;
  }

  handle(code, data, fromServer) {
    // raw hooks
    for (let type of ['*', code]) {
      const hooks = this.hooks.raw[type];
      if (!hooks) continue;

      for (let hook of hooks) {
        try {
          const result = hook(code, data, fromServer);
          if (Buffer.isBuffer(result)) {
            data = result;
          } else if (result === false) {
            return false;
          }
        } catch (e) {
          const name = protocol.map.code[code] || `opcode ${code}`;
          console.error(`[dispatch] handle: error running raw hook for ${name}`);
          if (hook[moduleNameSymbol]) console.error(`module: ${hook[moduleNameSymbol]}`);
          console.error('error: %s', e.message);
          console.error('data:');
          console.error(data.toString('hex'));
          console.error('stack:');
          console.error(e.stack);
        }
      }
    }

    // pre hooks
    const hooks = this.hooks.pre[code];
    if (hooks) {
      const event = protocol.parse(code, data);
      let changed = false;

      for (let hook of hooks) {
        try {
          const result = hook(event);
          if (result === true) {
            changed = true;
          } else if (result === false) {
            return false;
          }
        } catch (e) {
          const name = protocol.map.code[code] || `opcode ${code}`;
          console.error(`[dispatch] handle: error running pre hook for ${name}`);
          if (hook[moduleNameSymbol]) console.error(`module: ${hook[moduleNameSymbol]}`);
          console.error('error: %s', e.message);
          console.error('data:');
          console.error(event);
          console.error('stack:');
          console.error(e.stack);
        }
      }

      if (changed) {
        data = protocol.write(code, event);
      }
    }

    // return value
    return data;
  }
}

module.exports = Dispatch;
