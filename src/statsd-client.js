var dgram = require("dgram");

// Client for talking to a statsd server over UDP (https://github.com/statsd/statsd).
class StatsdClient {

  constructor(hostname, port, prefix) {
    this.hostname = hostname;
    this.port = port;
    this.prefix = prefix;
    this.socket = dgram.createSocket("udp4");
    this.socket.on("error", (err) => {
      console.error("Statsd socket error: ", err);
    });
  }

  // Sends a single packet to statsd with a new value for some metric.
  send(metric, value, type) {
    const msg = Buffer.from(`${this.prefix}${metric}:${value}|${type}`);
    return new Promise((resolve, reject) => {
      this.socket.send(msg, 0, msg.length, this.port, this.hostname, (err) => {
        if (err == null) {
          resolve(msg.length);
        } else {
          console.error("Error sending to statsd: ", err);
          reject(err);
        }
      });
    });
  }

}

module.exports = { StatsdClient };
