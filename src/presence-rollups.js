const EventEmitter = require('events');

// Data structure for tracking the series of arrivals/departures in a hub and rolling it up
// into a useful stream of Discord notifications.
class PresenceRollups extends EventEmitter {

  constructor(options) {
    super();
    this.entries = []; // { kind, users: [{ id, name }], timestamp }
    this.pendingDepartures = {}; // { id: timeout }
    this.options = Object.assign({
      // The duration for which we wait to roll up multiple people's arrivals.
      arrive_rollup_leeway_ms: 60 * 1000,
      // The duration for which we wait to roll up multiple people's departures.
      depart_rollup_leeway_ms: 60 * 1000,
      // The duration for which we wait for someone to rejoin before we announce their departure.
      depart_rejoin_patience_ms: 15 * 1000,
    }, options);
  }

  latest() {
    return this.entries.length ? this.entries[this.entries.length - 1] : null;
  }

  arrive(id, name, timestamp) {
    const pending = this.pendingDepartures[id];
    if (pending) {
      // don't bother reporting leave/rejoins
      clearTimeout(pending);
      delete this.pendingDepartures[id];
      return;
    }

    const prev = this.latest();
    if (prev != null && prev.kind === "arrive") {
      const elapsed = timestamp - prev.timestamp;
      if (elapsed <= this.options.arrive_rollup_leeway_ms ) {
        // roll it up into the last arrival notification
        prev.users.push({ id, name });
        prev.timestamp = timestamp;
        this.emit("update", prev);
        return;
      }
    }
    // create a new arrival notification
    const curr = { kind: "arrive", users: [{ id, name }], timestamp };
    this.entries.push(curr);
    this.emit("new", curr);
  }

  depart(id, name, timestamp) {
    // we don't know yet whether this person might quickly rejoin, so wait and see
    const delay = this.options.depart_rejoin_patience_ms;
    this.pendingDepartures[id] = setTimeout(() => { this.finalizeDeparture(id, name, timestamp + delay); }, delay);
  }

  finalizeDeparture(id, name, timestamp) {
    delete this.pendingDepartures[id];
    const prev = this.latest();
    if (prev != null && prev.kind === "depart") {
      const elapsed = timestamp - prev.timestamp;
      if (elapsed <= this.options.depart_rollup_leeway_ms) {
        // roll it up into the last departure notification
        prev.users.push({ id, name });
        prev.timestamp = timestamp;
        this.emit("update", prev);
        return;
      }
    }
    // create a new departure notification
    const curr = { kind: "depart", users: [{ id, name }], timestamp };
    this.entries.push(curr);
    this.emit("new", curr);
  }

}

module.exports = { PresenceRollups };
