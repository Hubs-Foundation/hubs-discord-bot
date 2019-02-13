var test = require('tape');
var { buildUrlRegex } = require('../src/reticulum.js');

test('Hubs URLs are detected in channel topics', function(t) {
  var re = new buildUrlRegex(["foo", "bar.mozilla.com"]);
  // hub IDs must be exactly 7 characters and followed by an optional slug
  t.deepEqual("https://foo/0123456/".match(re)[2], "0123456");
  t.deepEqual("https://foo/fiddles/blah-blah-blah".match(re)[2], "fiddles");
  t.deepEqual("https://bar.mozilla.com/spoke".match(re), null);
  t.deepEqual("https://bar.mozilla.com/s0mething/".match(re), null);
  t.deepEqual("https://bar.mozilla.com/".match(re), null);
  t.deepEqual("https://bar.mozilla.com/d0gf00d".match(re)[2], "d0gf00d");
  t.deepEqual("https://foo.bar.mozilla.com/whatever/".match(re), null);
  t.deepEqual("https://zombo.com/hmmmm".match(re), null);
  t.deepEqual("https://foo/index.html".match(re), null);
  t.end();
});
