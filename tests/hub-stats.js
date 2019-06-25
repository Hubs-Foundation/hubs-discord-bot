var test = require('tape');
var { HubStats } = require('../src/hub-stats.js');

test('HubStats correctly identifies peak CCU', function(t) {
  var stats = new HubStats();
  stats.arrive(0, 4);
  t.deepEqual(stats.summarize(), { arrivals: 4, departures: 0, peakCcu: 4, peakTime: 0 });
  stats.arrive(1);
  t.deepEqual(stats.summarize(), { arrivals: 5, departures: 0, peakCcu: 5, peakTime: 1 });
  stats.depart(2);
  t.deepEqual(stats.summarize(), { arrivals: 5, departures: 1, peakCcu: 5, peakTime: 1 });
  stats.depart(3);
  t.deepEqual(stats.summarize(), { arrivals: 5, departures: 2, peakCcu: 5, peakTime: 1 });
  stats.arrive(5);
  t.deepEqual(stats.summarize(), { arrivals: 6, departures: 2, peakCcu: 5, peakTime: 1 });
  stats.depart(10);
  t.deepEqual(stats.summarize(), { arrivals: 6, departures: 3, peakCcu: 5, peakTime: 1 });
  stats.arrive(12, 3);
  t.deepEqual(stats.summarize(), { arrivals: 9, departures: 3, peakCcu: 6, peakTime: 12 });
  stats.depart(13, 5);
  t.deepEqual(stats.summarize(), { arrivals: 9, departures: 8, peakCcu: 6, peakTime: 12 });

  t.deepEqual(stats.summarize(0, 15), stats.summarize());
  t.deepEqual(stats.summarize(1, 5), { arrivals: 2, departures: 2, peakCcu: 5, peakTime: 1 });
  t.deepEqual(stats.summarize(10, 12), { arrivals: 3, departures: 1, peakCcu: 6, peakTime: 12 });
  t.end();
});
