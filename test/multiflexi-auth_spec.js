'use strict';

require('should');
var http = require('http');

describe('multiflexi-auth.js', function () {
    var server, base, loginOutcome, authModule, requestedPaths;

    beforeEach(function (done) {
        loginOutcome = 'success'; // 'success' | 'badpassword' | 'error' | 'suffix-required'
        requestedPaths = [];
        server = http.createServer(function (req, res) {
            requestedPaths.push(req.url.split('?')[0]);

            if (loginOutcome === 'suffix-required') {
                if (req.url.split('?')[0].endsWith('.json')) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ token: 'abc123' }));
                } else {
                    res.writeHead(404);
                    res.end();
                }

                return;
            }

            if (loginOutcome === 'success') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ token: 'abc123', message: 'Token generated' }));
            } else if (loginOutcome === 'badpassword') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'invalid password' }));
            } else {
                res.writeHead(500);
                res.end();
            }
        });
        server.listen(0, '127.0.0.1', function () {
            base = 'http://127.0.0.1:' + server.address().port;
            process.env.MULTIFLEXI_URL = base;
            delete require.cache[require.resolve('../multiflexi/multiflexi-auth.js')];
            authModule = require('../multiflexi/multiflexi-auth.js');
            done();
        });
    });

    afterEach(function (done) {
        delete process.env.MULTIFLEXI_URL;
        server.close(done);
    });

    it('getUser() denies a username that never authenticated', function () {
        return authModule.users('nobody').then(function (user) {
            (user === null).should.be.true();
        });
    });

    it('authenticate() with valid credentials returns a read-only user', function () {
        return authModule.authenticate('alice', 'correct-password').then(function (user) {
            user.should.eql({ username: 'alice', permissions: 'read' });
        });
    });

    it('authenticate() with invalid credentials returns null and grants no session', function () {
        loginOutcome = 'badpassword';
        return authModule.authenticate('mallory', 'wrong').then(function (user) {
            (user === null).should.be.true();
            return authModule.users('mallory');
        }).then(function (user) {
            (user === null).should.be.true();
        });
    });

    it('getUser() resolves a session created by a prior authenticate() success', function () {
        return authModule.authenticate('bob', 'correct-password').then(function () {
            return authModule.users('bob');
        }).then(function (user) {
            user.should.eql({ username: 'bob', permissions: 'read' });
        });
    });

    it('getUser() denies once the session has expired', function () {
        return authModule.authenticate('carol', 'correct-password').then(function () {
            authModule._authenticatedSessions.get('carol').expiresAt = Date.now() - 1;
            return authModule.users('carol');
        }).then(function (user) {
            (user === null).should.be.true();
        });
    });

    it('never grants blanket admin ("*") permissions to any authenticated user', function () {
        return authModule.authenticate('dave', 'correct-password').then(function (user) {
            user.permissions.should.not.equal('*');
        });
    });

    it('retries with a .json suffix when the bare login path 404s (backend routing convention differs)', function () {
        loginOutcome = 'suffix-required';

        return authModule.authenticate('erin', 'correct-password').then(function (user) {
            user.should.eql({ username: 'erin', permissions: 'read' });
            requestedPaths.length.should.equal(2);
            requestedPaths[0].should.not.endWith('.json');
            requestedPaths[1].should.endWith('.json');
        });
    });
});
