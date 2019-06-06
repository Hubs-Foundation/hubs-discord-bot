const EventEmitter = require('events');

// Data structure for tracking the series of arrivals/departures in a hub and rolling it up
// into a useful stream of notifications. When new arrivals or departures happen, either
// a new notification will be produced, or the most recent notification will be amended. If
// a user renames themselves rapidly after arriving, the arrival will be amended to have their
// new name.
//
// Fires two kinds of events:
// - "new", indicating that a new notification should be produced announcing the arrival or
//   departure of some set of users, or a rename of a user.
// - "update", indicating that the previous notification should be amended and whichever users
//   were announced in it should be replaced with the newly provided set of users.
//
class PresenceRollups extends EventEmitter {

  // note that there is one highly suspicious thing about this implementation; we don't have a consistent
  // way of tracking that a client who leaves and rejoins is "the same guy", so instead, we assume that people
  // with the same name are "the same guy" for purposes of collapsing rejoin notifications. thus why
  // pendingDepartures is keyed on name, not ID, and why it has an array of timeouts, instead of one.

  constructor(options) {
    super();

    // All of the notifications which have ever been produced, first to last.
    this.entries = []; // { kind, users: [{ id, name, prevName }], timestamp }

    // All of the departures which we're waiting on to see whether the guy quickly rejoins.
    this.pendingDepartures = {}; // { name: [timeout] }

    this.options = Object.assign({
      // The duration for which, if a room has no activity, the next activity is considered "fresh".
      // (We broadcast general room information to Discord on fresh activity.)
      freshnessCooldownMs: 60 * 60 * 1000,
      // The duration for which we will edit someone's last activity with a renamed name.
      renameLeewayMs: 60 * 1000,
      // The duration for which we wait to roll up multiple people's arrivals.
      arriveRollupLeewayMs: 60 * 1000,
      // The duration for which we wait to roll up multiple people's departures.
      departRollupLeewayMs: 60 * 1000,
      // The duration for which we wait for someone to rejoin before we announce their departure.
      departRejoinPatienceMs: 15 * 1000,
    }, options);
  }

  subscribeToChannel(reticulumCh) {
    reticulumCh.on('join', (ts, id, kind, whom) => { this.arrive(id, whom, ts); });
    reticulumCh.on('leave', (ts, id, kind, whom) => { this.depart(id, whom, ts); });
    reticulumCh.on('renameuser', (ts, id, kind, prev, curr) => { this.rename(id, prev, curr, ts); });
  }

  latest() {
    return this.entries.length ? this.entries[this.entries.length - 1] : null;
  }

  arrive(id, name, timestamp) {
    const pending = (this.pendingDepartures[name] || []).pop();
    if (pending) {
      // don't bother reporting leave/rejoins
      clearTimeout(pending);
      return;
    }

    const prev = this.latest();
    if (prev != null && prev.kind === "arrive") {
      const elapsed = timestamp - prev.timestamp;
      if (elapsed <= this.options.arriveRollupLeewayMs ) {
        // roll it up into the last arrival notification
        prev.users.push({ id, name });
        prev.timestamp = timestamp;
        this.emit("update", prev);
        return;
      }
    }
    // create a new arrival notification
    const fresh = prev != null && (timestamp - prev.timestamp >= this.options.freshnessCooldownMs);
    const curr = { kind: "arrive", users: [{ id, name }], timestamp, fresh };
    this.entries.push(curr);
    this.emit("new", curr);
  }

  rename(id, prevName, name, timestamp) {
    const prev = this.latest();
    if (prev != null && prev.kind === "rename" || prev.kind === "arrive") {
      const user = prev.users.find(u => u.id === id);
      const elapsed = timestamp - prev.timestamp;
      if (user != null && elapsed <= this.options.renameLeewayMs) {
        // update the last arrival or rename to have the new name
        user.name = name;
        prev.timestamp = timestamp;
        this.emit("update", prev);
        return;
      }
    }
    // create a new rename notification
    const fresh = prev != null && (timestamp - prev.timestamp >= this.options.freshnessCooldownMs);
    const curr = { kind: "rename", users: [{ id, name, prevName }], timestamp, fresh };
    this.entries.push(curr);
    this.emit("new", curr);
  }

  depart(id, name, timestamp) {
    // we don't know yet whether this person might quickly rejoin, so wait and see
    const delay = this.options.departRejoinPatienceMs;
    const pending = this.pendingDepartures[name] || (this.pendingDepartures[name] = []);
    pending.push(setTimeout(() => { this.finalizeDeparture(id, name, timestamp + delay); }, delay));
  }

  finalizeDeparture(id, name, timestamp) {
    (this.pendingDepartures[name] || []).pop();
    const prev = this.latest();
    if (prev != null && prev.kind === "depart") {
      const elapsed = timestamp - prev.timestamp;
      if (elapsed <= this.options.departRollupLeewayMs) {
        // roll it up into the last departure notification
        prev.users.push({ id, name });
        prev.timestamp = timestamp;
        this.emit("update", prev);
        return;
      }
    }
    // create a new departure notification
    const fresh = prev != null && (timestamp - prev.timestamp >= this.options.freshnessCooldownMs);
    const curr = { kind: "depart", users: [{ id, name }], timestamp, fresh };
    this.entries.push(curr);
    this.emit("new", curr);
  }

}

module.exports = { PresenceRollups };
