var net = require('net');

var Encryption = require('./encryption');
var PacketBuffer = require('./packetBuffer');

function Connection(socket, dispatch) {
  var self = this;
  self.socket = socket;
  self.dispatch = dispatch;

  self.state = -1;
  self.session1 = new Encryption;
  self.session2 = new Encryption;
  self.clientBuffer = new PacketBuffer;
  self.serverBuffer = new PacketBuffer;

  self.socket.setNoDelay(true);

  self.socket.on('data', function onData(data) {
    switch (self.state) {
      case 0:
        if (data.length === 128) {
          data.copy(self.session1.clientKeys[0]);
          data.copy(self.session2.clientKeys[0]);
          self.client.write(data);
        }
        break;

      case 1:
        if (data.length === 128) {
          data.copy(self.session1.clientKeys[1]);
          data.copy(self.session2.clientKeys[1]);
          self.client.write(data);
        }
        break;

      case 2:
        self.session1.decrypt(data);
        self.clientBuffer.write(data);

        while (data = self.clientBuffer.read()) {
          if (self.dispatch != null) {
            var opcode = data.readUInt16LE(2);
            data = self.dispatch.handle(opcode, data, false);
          }
          if (data && self.client != null) {
            self.session2.decrypt(data);
            self.client.write(data);
          }
        }

        break;
    }
  });

  self.socket.on('error', function onError(err) {
    console.warn(err);
  });

  self.socket.on('close', function onClose() {
    self.socket = null;
    self.close();
  });
}

Connection.prototype.connect = function connect(opt) {
  var self = this;
  self.client = net.connect(opt);
  self.client.setNoDelay(true);

  self.client.on('connect', function onConnect() {
    self.remote = self.socket.remoteAddress + ':' + self.socket.remotePort;
    console.log('[connection] routing %s to %s:%d', self.remote, self.client.remoteAddress, self.client.remotePort);
    self.state = -1;
  });

  self.client.on('data', function onData(data) {
    switch (self.state) {
      case -1:
        if (data.readUInt32LE(0) === 1) {
          self.state = 0;
          self.socket.write(data);
        }
        break;

      case 0:
        if (data.length === 128) {
          data.copy(self.session1.serverKeys[0]);
          data.copy(self.session2.serverKeys[0]);
          self.state = 1;
          self.socket.write(data);
        }
        break;

      case 1:
        if (data.length === 128) {
          data.copy(self.session1.serverKeys[1]);
          data.copy(self.session2.serverKeys[1]);
          self.session1.init();
          self.session2.init();
          self.state = 2;
          self.socket.write(data);
        }
        break;

      case 2:
        self.session2.encrypt(data);
        self.serverBuffer.write(data);

        while (data = self.serverBuffer.read()) {
          if (self.dispatch != null) {
            var opcode = data.readUInt16LE(2);
            data = self.dispatch.handle(opcode, data, true);
          }
          if (data && self.socket != null) {
            self.session1.encrypt(data);
            self.socket.write(data);
          }
        }

        break;
    }
  });

  self.client.on('error', function onError(err) {
    console.warn(err);
  });

  self.client.on('close', function onClose() {
    console.log('[connection] %s disconnected', self.remote);
    self.client = null;
    self.close();
  });
};

Connection.prototype.sendClient = function sendClient(data) {
  if (this.socket != null) {
    if (this.state === 2) this.session1.encrypt(data);
    this.socket.write(data);
  }
};

Connection.prototype.sendServer = function sendServer(data) {
  if (this.client != null) {
    if (this.state === 2) this.session2.decrypt(data);
    this.client.write(data);
  }
};

Connection.prototype.close = function close() {
  if (this.client != null) {
    this.client.end();
    this.client.unref();
    this.client = null;
  }

  if (this.socket != null) {
    this.socket.end();
    this.socket.unref();
    this.socket = null;
  }

  if (this.dispatch != null) {
    this.dispatch.close();
    this.dispatch = null;
  }
};

module.exports = Connection;
