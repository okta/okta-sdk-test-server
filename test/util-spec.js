const path = require('path');
const expect = require('chai').expect;
const util = require('../lib/util');

describe('util', () => {
  describe('formatPath', () => {
    it('returns undefined if nothing passed', () => expect(util.formatPath()).to.be.undefined);

    it('returns absolute path if absolute path passed', () => {
      const absolutePath = __dirname;
      expect(util.formatPath(absolutePath)).to.equal(absolutePath);
    });

    it('returns absolute path relative to current process if relative path passed', () => {
      const relativePath = 'something';
      const absolutePath = path.join(process.cwd(), relativePath);
      expect(util.formatPath(relativePath)).to.equal(absolutePath);
    });
  });
});
