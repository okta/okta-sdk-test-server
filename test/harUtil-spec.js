const expect = require('chai').expect;
const harUtil = require('../lib/harUtil');

describe('harUtil', () => {
  describe('readHarFile', () => {
    it('returns a har if a file exists');
    it('returns a default har if a file does not exist');
  });
  describe('normalizeRequest', () => {
    it('creates a har for new requests');
  });
  describe('createHarEntry', () => {
    it('plays back a har if it matches');
  });
});
