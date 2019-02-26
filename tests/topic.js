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
  var re = TopicManager.buildHubUrlRegex(["foo", "bar.mozilla.com"]);
  // hub IDs must be exactly 7 characters and followed by an optional slug
  t.equal("https://foo/0123456/".match(re)[2], "0123456");
  t.equal("https://foo/fiddles/blah-blah-blah".match(re)[2], "fiddles");
  t.equal("https://bar.mozilla.com/spoke".match(re), null);
  t.equal("https://bar.mozilla.com/s0mething/".match(re), null);
  t.equal("https://bar.mozilla.com/".match(re), null);
  t.equal("https://bar.mozilla.com/d0gf00d".match(re)[2], "d0gf00d");
  t.equal("https://foo.bar.mozilla.com/whatever/".match(re), null);
  t.equal("https://zombo.com/hmmmm".match(re), null);
  t.equal("https://foo/index.html".match(re), null);
  t.end();
});
