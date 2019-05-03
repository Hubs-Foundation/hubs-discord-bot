// Tracks join/leaves in a hub for the purposes of activity reporting later on.
//
// When beginning to accumulate statistics for a hub, you can call `arrive` with the current
// timestamp for any existing users, and those users' preexisting presence will be correctly
// accounted for in the summary statistics later.
class HubStats {

  constructor() {
    this.ccu = 0;
    this.timeline = [];
  }

  // Marks the arrival of N new users.
  arrive(timestamp, n) {
    n = (n != null) ? n : 1;
    this.ccu += n;
    this.timeline.push({ kind: "arrive", ccu: this.ccu, timestamp, n });
  }

  // Marks the departure of N existing users.
  depart(timestamp, n) {
    n = (n != null) ? n : 1;
    this.ccu -= n;
    this.timeline.push({ kind: "depart", ccu: this.ccu, timestamp, n });
  }

  // Returns information about users who were present between the given start and end times.
  summarize(startTs, endTs) {
    let i = 0;

    // scan ahead to the start time
    while (i < this.timeline.length) {
      const ev = this.timeline[i];
      if (startTs == null || ev.timestamp >= startTs) {
        break;
      }
      i++;
    }

    // count up stuff until the end time
    let arrivals = 0;
    let departures = 0;
    let peakCcu = 0;
    let peakTime = null;
    while (i < this.timeline.length) {
      const ev = this.timeline[i];
      if (endTs != null && ev.timestamp > endTs) {
        break;
      }
      arrivals += ev.kind === "arrive" ? ev.n : 0;
      departures += ev.kind === "depart" ? ev.n : 0;
      if (ev.ccu > peakCcu) {
        peakCcu = ev.ccu;
        peakTime = ev.timestamp;
      }
      i++;
    }

    return { arrivals, departures, peakCcu, peakTime };
  }
}

module.exports = { HubStats };
