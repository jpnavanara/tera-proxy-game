const net = require('net');

const PacketBuffer = require('../packetBuffer');

class RealClient {
  constructor(connection, socket) {
    this.connection = connection;
    this.socket = socket;

    this.session = null;
    this.buffer = new PacketBuffer();

    //socket.setNoDelay(true);

    socket.on('data', (data) => {
      switch (this.connection.state) {
        case 0: {
          if (data.length === 128) {
            this.connection.setClientKey(data);
          }
          break;
        }

        case 1: {
          if (data.length === 128) {
            this.connection.setClientKey(data);
          }
          break;
        }

        case 2: {
          this.session.decrypt(data);
          this.buffer.write(data);

          const { dispatch } = this.connection;
          while (data = this.buffer.read()) {
            if (dispatch) {
              const opcode = data.readUInt16LE(2);
              data = dispatch.handle(opcode, data, false);
            }
            if (data) {
              this.connection.sendServer(data);
            }
          }

          break;
        }
      }
    });

    this.socket.on('close', () => {
      this.socket = null;
      this.close();
    });
  }

  onConnect(serverConnection) {
  }

  onData(data) {
    if (this.connection.state === 2) {
      if (!this.session) {
        this.session = this.connection.session.cloneKeys();
      } else {
        this.session.encrypt(data);
      }
    }
    this.socket.write(data);
  }

  close() {
    if (this.socket) {
      this.socket.end();
      this.socket.unref();
      this.socket = null;
    }

    this.connection = null; // do not close
    this.session = null;
    this.buffer = null;
  }
}

module.exports = RealClient;
