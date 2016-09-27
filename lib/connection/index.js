const net = require('net');

const Encryption = require('./encryption');
const PacketBuffer = require('./packetBuffer');

class Connection {
  constructor(socket, dispatch) {
    this.socket = socket;
    this.dispatch = dispatch;

    this.state = -1;
    this.session1 = new Encryption;
    this.session2 = new Encryption;
    this.clientBuffer = new PacketBuffer;
    this.serverBuffer = new PacketBuffer;

    this.socket.setNoDelay(true);

    this.socket.on('data', (data) => {
      switch (this.state) {
        case 0: {
          if (data.length === 128) {
            data.copy(this.session1.clientKeys[0]);
            data.copy(this.session2.clientKeys[0]);
            this.client.write(data);
          }
          break;
        }

        case 1: {
          if (data.length === 128) {
            data.copy(this.session1.clientKeys[1]);
            data.copy(this.session2.clientKeys[1]);
            this.client.write(data);
          }
          break;
        }

        case 2: {
          this.session1.decrypt(data);
          this.clientBuffer.write(data);

          while (data = this.clientBuffer.read()) {
            if (this.dispatch != null) {
              const opcode = data.readUInt16LE(2);
              data = this.dispatch.handle(opcode, data, false);
            }
            if (data && this.client != null) {
              this.session2.decrypt(data);
              this.client.write(data);
            }
          }

          break;
        }
      }
    });

    this.socket.on('error', (err) => {
      console.warn(err);
    });

    this.socket.on('close', () => {
      this.socket = null;
      this.close();
    });
  }

  connect(opt) {
    this.client = net.connect(opt);
    this.client.setNoDelay(true);

    this.client.on('connect', () => {
      this.remote = this.socket.remoteAddress + ':' + this.socket.remotePort;
      console.log('[connection] routing %s to %s:%d', this.remote, this.client.remoteAddress, this.client.remotePort);
      this.state = -1;
    });

    this.client.on('data', (data) => {
      switch (this.state) {
        case -1: {
          if (data.readUInt32LE(0) === 1) {
            this.state = 0;
            this.socket.write(data);
          }
          break;
        }

        case 0: {
          if (data.length === 128) {
            data.copy(this.session1.serverKeys[0]);
            data.copy(this.session2.serverKeys[0]);
            this.state = 1;
            this.socket.write(data);
          }
          break;
        }

        case 1: {
          if (data.length === 128) {
            data.copy(this.session1.serverKeys[1]);
            data.copy(this.session2.serverKeys[1]);
            this.session1.init();
            this.session2.init();
            this.state = 2;
            this.socket.write(data);
          }
          break;
        }

        case 2: {
          this.session2.encrypt(data);
          this.serverBuffer.write(data);

          while (data = this.serverBuffer.read()) {
            if (this.dispatch != null) {
              const opcode = data.readUInt16LE(2);
              data = this.dispatch.handle(opcode, data, true);
            }
            if (data && this.socket != null) {
              this.session1.encrypt(data);
              this.socket.write(data);
            }
          }

          break;
        }
      }
    });

    this.client.on('error', (err) => {
      console.warn(err);
    });

    this.client.on('close', () => {
      console.log('[connection] %s disconnected', this.remote);
      this.client = null;
      this.close();
    });
  }

  sendClient(data) {
    if (this.socket != null) {
      if (this.state === 2) this.session1.encrypt(data);
      this.socket.write(data);
    }
  }

  sendServer(data) {
    if (this.client != null) {
      if (this.state === 2) this.session2.decrypt(data);
      this.client.write(data);
    }
  }

  close() {
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
  }
}

module.exports = Connection;
