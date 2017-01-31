const protocol = require('tera-data').protocol;
const Wrapper = require('./dispatchWrapper');

const moduleNameSymbol = Symbol('moduleName');

class Dispatch {
  constructor(connection) {
    this.connection = connection;
    this.modules = new Map();
    this.hooks = { raw: {}, pre: {} };
  }

  reset() {
    for (const name of this.modules.keys()) {
      this.unload(name);
    }

    // ensure empty objects
    this.modules.clear();
    this.hooks = { raw: {}, pre: {} };
  }

  load(name, from = module, ...args) {
    const mod = this.modules.get(name);
    if (mod) return mod;

    if (typeof from.require !== 'function' && typeof from === 'function') {
      // `from` is a function, so use itself the module constructor
      from = { require: (ModuleConstructor => () => ModuleConstructor)(from) };
    }

    try {
      const ModuleConstructor = from.require(name);
      const wrapper = new Wrapper(this, name);
      const mod = new ModuleConstructor(wrapper, ...args);
      this.modules.set(name, mod);

      console.log('[dispatch] loaded "%s"', name);
      return mod;
    } catch (e) {
      console.error('[dispatch] load: error initializing module "%s"', name);
      console.error(e.stack);
    }
  }

  unload(name) {
    const mod = this.modules.get(name);

    if (!mod) {
      console.warn('[dispatch] unload: cannot unload non-loaded module "%s"', name);
      return false;
    }

    for (const type in this.hooks) {
      if (!{}.hasOwnProperty.call(this.hooks, type)) continue; // for..in guard

      const hooks = this.hooks[type];
      for (const code in hooks) {
        if (!{}.hasOwnProperty.call(hooks, code)) continue;

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

    this.modules.delete(name);
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
      code = protocol.map.name.get(name);
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

  hook(...args) {
    const { hooks, code, cb } = this._resolveHook(...args);

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

  unhook(...args) {
    const { hooks, code, cb } = this._resolveHook(...args);

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
    for (const type of ['*', code]) {
      const hooks = this.hooks.raw[type];
      if (!hooks) continue;

      for (const hook of hooks) {
        try {
          const result = hook(code, data, fromServer);
          if (Buffer.isBuffer(result)) {
            data = result;
          } else if (result === false) {
            return false;
          }
        } catch (e) {
          const name = protocol.map.code.get(code) || `opcode ${code}`;
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

      for (const hook of hooks) {
        try {
          const result = hook(event);
          if (result === true) {
            changed = true;
          } else if (result === false) {
            return false;
          }
        } catch (e) {
          const name = protocol.map.code.get(code) || `opcode ${code}`;
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
