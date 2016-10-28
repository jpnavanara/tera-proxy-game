class DispatchWrapper {
  constructor(base, moduleName) {
    this.base = base;
    this.moduleName = moduleName;
  }

  load(name, from, required = true) {
    const mod = this.base.load(...arguments);
    if (required && !mod) {
      throw new Error(`Cannot find module '${name}'`);
    }
    return mod;
  }

  unload() {
    return this.base.unload(...arguments);
  }

  hook() {
    return this.base.hookFromModule(this.moduleName, ...arguments);
  }

  unhook() {
    return this.base.unhook(...arguments);
  }

  toClient() {
    return this.base.write(false, ...arguments);
  }

  toServer() {
    return this.base.write(true, ...arguments);
  }
}

module.exports = DispatchWrapper;
