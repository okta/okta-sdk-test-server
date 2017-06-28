const expect = require('chai').expect;
const server = require('../lib/server');

describe('server', () => {
  describe('cleanup', () => {
    it('returns 0 if there are no remaining scenarios');
    it('returns 1 if there are remaining scenarios');
  });
  describe('recordProxy', () => {
    it('creates a har for new requests');
    it('adds to an existing har if one exists');
  });
  describe('playbackProxy', () => {
    it('plays back a har if it matches');
    it('returns a 404 if the next entry does not match');
  });
});
