'use strict';

require('should');
var { timingSafeTokenEqual } = require('../multiflexi/lib/tokenAuth');

describe('lib/tokenAuth timingSafeTokenEqual', function () {
    it('returns true for matching tokens', function () {
        timingSafeTokenEqual('secret-token', 'secret-token').should.be.true();
    });

    it('returns false for a wrong token of the same length', function () {
        timingSafeTokenEqual('secret-tokeX', 'secret-token').should.be.false();
    });

    it('returns false for tokens of different lengths', function () {
        timingSafeTokenEqual('short', 'a-much-longer-token').should.be.false();
    });

    it('returns false when the incoming value is empty', function () {
        timingSafeTokenEqual('', 'secret-token').should.be.false();
    });

    it('returns false when the expected value is empty', function () {
        timingSafeTokenEqual('secret-token', '').should.be.false();
    });

    it('returns false when both are empty (never treat "no secret" as a match)', function () {
        timingSafeTokenEqual('', '').should.be.false();
    });
});
