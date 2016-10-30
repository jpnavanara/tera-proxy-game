// original C# source:
// https://github.com/P5yl0/TeraEmulator_2117a/tree/master/Tera_Emulator_Source_2117/GameServer/Crypt

const Sha1 = require('./sha1');

/**************
 * CryptorKey *
 **************/
function CryptorKey(size, pos2) {
  this.size = size;
  this.sum = 0;
  this.key = 0;
  this.pos1 = 0;
  this.pos2 = pos2;
  this.buffer = new Uint32Array(this.size);
}

/***********
 * Cryptor *
 ***********/
class Cryptor {
  constructor() {
    this.changeData = 0;
    this.changeLen = 0;
    this.keys = [
      new CryptorKey(55, 31),
      new CryptorKey(57, 50),
      new CryptorKey(58, 39),
    ];
  }

  static fill(key) {
    const result = Buffer.allocUnsafe(680);
    result[0] = 128;
    for (let i = 1; i < 680; i++) {
      result[i] = key[i % 128];
    }
    return result;
  }

  generate(key) {
    const buffer = Cryptor.fill(key);
    for (let i = 0; i < 680; i += 20) {
      const sha = new Sha1();
      sha.update(buffer);
      const hash = sha.hash();
      for (let j = 0; j < 20; j += 4) {
        hash.copy(buffer, i + j, j, j + 4);
      }
    }
    for (let i = 0; i < 55; i++) {
      this.keys[0].buffer[i] = buffer.readUInt32LE(i * 4);
    }
    for (let i = 0; i < 57; i++) {
      this.keys[1].buffer[i] = buffer.readUInt32LE(i * 4 + 220);
    }
    for (let i = 0; i < 58; i++) {
      this.keys[2].buffer[i] = buffer.readUInt32LE(i * 4 + 448);
    }
  }

  apply(buf) {
    const { keys } = this;
    const size = buf.length;

    const pre = (size < this.changeLen) ? size : this.changeLen;
    if (pre !== 0) {
      for (let i = 0; i < pre; i++) {
        buf[i] ^= this.changeData >>> (8 * (4 - this.changeLen + i));
      }
      this.changeLen -= pre;
    }

    function doRound() {
      const result = keys[0].key & keys[1].key | keys[2].key & (keys[0].key | keys[1].key);
      for (const k of keys) {
        if (result === k.key) {
          const t1 = k.buffer[k.pos1];
          const t2 = k.buffer[k.pos2];
          const t3 = (t1 <= t2 ? t1 : t2);
          k.sum = ((t1 + t2) & 0xFFFFFFFF) >>> 0;
          k.key = +(t3 > k.sum);
          k.pos1 = (k.pos1 + 1) % k.size;
          k.pos2 = (k.pos2 + 1) % k.size;
        }
      }
    }

    for (let i = pre; i < size - 3; i += 4) {
      doRound();
      for (const k of keys) {
        buf[i] ^= k.sum;
        buf[i + 1] ^= k.sum >>> 8;
        buf[i + 2] ^= k.sum >>> 16;
        buf[i + 3] ^= k.sum >>> 24;
      }
    }

    const remain = (size - pre) & 3;
    if (remain !== 0) {
      doRound();

      this.changeData = 0;
      for (const k of keys) {
        this.changeData ^= k.sum;
      }

      for (let i = 0; i < remain; i++) {
        buf[size - remain + i] ^= this.changeData >>> (i * 8);
      }

      this.changeLen = 4 - remain;
    }
  }
}

/***********
 * Session *
 ***********/
// helpers
function shiftKey(tgt, src, n) {
  const len = src.length;
  if (n > 0) {
    src.copy(tgt, 0, n);
    src.copy(tgt, len - n);
  } else {
    src.copy(tgt, 0, len + n);
    src.copy(tgt, -n);
  }
  return tgt;
}

function xorKey(tgt, key1, key2) {
  const len = Math.min(key1.length, key2.length);
  for (let i = 0; i < len; i++) {
    tgt[i] = key1[i] ^ key2[i];
  }
}

class Session {
  constructor() {
    this.encryptor = new Cryptor();
    this.decryptor = new Cryptor();
    this.clientKeys = [Buffer.alloc(128), Buffer.alloc(128)];
    this.serverKeys = [Buffer.alloc(128), Buffer.alloc(128)];
  }

  init() {
    const [c1, c2] = this.clientKeys;
    const [s1, s2] = this.serverKeys;
    const t1 = Buffer.allocUnsafe(128);
    const t2 = Buffer.allocUnsafe(128);
    shiftKey(t1, s1, -67);
    xorKey(t2, t1, c1);
    shiftKey(t1, c2, 29);
    xorKey(t2, t1, t2);
    this.decryptor.generate(t2);
    shiftKey(t1, s2, -41);
    this.decryptor.apply(t1);
    this.encryptor.generate(t1.slice(0, 128));
  }

  encrypt(data) {
    return this.encryptor.apply(data);
  }

  decrypt(data) {
    return this.decryptor.apply(data);
  }

  cloneKeys() {
    const session = new Session();
    this.clientKeys[0].copy(session.clientKeys[0]);
    this.clientKeys[1].copy(session.clientKeys[1]);
    this.serverKeys[0].copy(session.serverKeys[0]);
    this.serverKeys[1].copy(session.serverKeys[1]);
    session.init();
    return session;
  }
}

/***********
 * exports *
 ***********/
module.exports = Session;
