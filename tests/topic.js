var test = require('tape');
var { TopicManager } = require('../src/topic.js');

test('Hubs URLs are correctly added to and removed from topics', function(t) {
  var tm = new TopicManager(["hubs.mozilla.com"]);
  t.equal(tm.addHub("", "https://hubs.mozilla.com/foobars"), "https://hubs.mozilla.com/foobars");
  t.equal(tm.addHub("whatever", "https://hubs.mozilla.com/foobars"), "whatever | https://hubs.mozilla.com/foobars");
  t.equal(tm.removeHub("whatever | https://hubs.mozilla.com/foobars"), "whatever");
  t.equal(tm.removeHub("whatever"), "whatever");
  t.equal(tm.removeHub("http://zombo.com"), "http://zombo.com");
  t.end();
});

test('Hubs URLs are detected in channel topics', function(t) {
  var tm = new TopicManager(["foo", "bar.mozilla.com", "hubs.local:8080", "localhost"]);
  // path form: hub IDs must be exactly 7 characters and followed by an optional slug
  t.equal(tm.matchHub("https://foo/0123456/").hubId, "0123456");
  t.equal(tm.matchHub("http://foo/fiddles/blah-blah-blah").hubId, "fiddles");
  t.equal(tm.matchHub("https://bar.mozilla.com/spoke"), null);
  t.equal(tm.matchHub("https://bar.mozilla.com/s0mething/"), null);
  t.equal(tm.matchHub("http://bar.mozilla.com/"), null);
  t.equal(tm.matchHub("https://bar.mozilla.com/d0gf00d").hubId, "d0gf00d");
  t.equal(tm.matchHub("https://foo.bar.mozilla.com/whatever/"), null);
  t.equal(tm.matchHub("http://zombo.com/hmmmm"), null);
  t.equal(tm.matchHub("https://foo/index.html"), null);
  // query form: hub IDs are 7 characters in the query parameter, useful for local dev
  t.equal(tm.matchHub("https://hubs.local:8080/hub.html?hub_id=a0b1c2d").hubId, "a0b1c2d");
  t.equal(tm.matchHub("https://hubs.local:443/hub.html"), null);
  t.equal(tm.matchHub("http://localhost/hub.html?hub_id=foobar1").hubId, "foobar1");
  t.equal(tm.matchHub("https://localhots/hub.html?hub_id=foobar1"), null);
  t.end();
});
