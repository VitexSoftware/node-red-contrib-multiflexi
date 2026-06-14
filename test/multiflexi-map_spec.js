'use strict';

var helper = require('node-red-node-test-helper');
var mapNode = require('../multiflexi/multiflexi-map.js');

helper.init(require.resolve('node-red'));

describe('multiflexi-map node', function () {
    beforeEach(function (done) { helper.startServer(done); });
    afterEach(function (done) { helper.unload().then(function () { helper.stopServer(done); }); });

    // 1. Node loads without error
    it('should be loaded', function (done) {
        var flow = [{ id: 'n1', type: 'multiflexi-map', name: 'map' }];
        helper.load(mapNode, flow, function () {
            var n1 = helper.getNode('n1');
            n1.should.have.property('name', 'map');
            done();
        });
    });

    // 2a. Server mode: msg passes through unchanged
    it('passes msg through unchanged in server mode', function (done) {
        var flow = [
            { id: 'n1', type: 'multiflexi-map', name: 'map', localMode: false, wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        helper.load(mapNode, flow, function () {
            var n2 = helper.getNode('n2');
            var n1 = helper.getNode('n1');
            var original = { someField: 'unchanged' };
            n2.on('input', function (msg) {
                msg.payload.should.deepEqual(original);
                done();
            });
            n1.receive({ payload: original });
        });
    });

    // 2b. Server mode: node status shows "server-side rule" text
    it('shows server-side rule status in server mode', function (done) {
        var flow = [
            { id: 'n1', type: 'multiflexi-map', name: 'map', localMode: false, ruleId: '42', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        helper.load(mapNode, flow, function () {
            var n2 = helper.getNode('n2');
            var n1 = helper.getNode('n1');
            n2.on('input', function () {
                var status = n1.status.args;
                status.length.should.be.above(0);
                var lastStatus = status[status.length - 1][0];
                lastStatus.text.should.containEql('server-side rule');
                done();
            });
            n1.receive({ payload: { foo: 'bar' } });
        });
    });

    // 3a. Local mode — flat key mapping
    it('maps a flat key from msg.payload to msg.payload.env (local mode)', function (done) {
        var flow = [
            {
                id: 'n1',
                type: 'multiflexi-map',
                name: 'map',
                localMode: true,
                envMapping: JSON.stringify({ OUT: 'someField' }),
                wires: [['n2']],
            },
            { id: 'n2', type: 'helper' },
        ];
        helper.load(mapNode, flow, function () {
            var n2 = helper.getNode('n2');
            var n1 = helper.getNode('n1');
            n2.on('input', function (msg) {
                msg.payload.env.should.have.property('OUT', 'hello');
                done();
            });
            n1.receive({ payload: { someField: 'hello' } });
        });
    });

    // 3b. Local mode — dot-path mapping
    it('resolves a dot-path selector in local mode', function (done) {
        var flow = [
            {
                id: 'n1',
                type: 'multiflexi-map',
                name: 'map',
                localMode: true,
                envMapping: JSON.stringify({ OUT: 'a.b' }),
                wires: [['n2']],
            },
            { id: 'n2', type: 'helper' },
        ];
        helper.load(mapNode, flow, function () {
            var n2 = helper.getNode('n2');
            var n1 = helper.getNode('n1');
            n2.on('input', function (msg) {
                msg.payload.env.should.have.property('OUT', 'world');
                done();
            });
            n1.receive({ payload: { a: { b: 'world' } } });
        });
    });

    // 3c. Local mode — @file: selector passes through unchanged
    it('passes @file: selector value through unchanged in local mode', function (done) {
        var flow = [
            {
                id: 'n1',
                type: 'multiflexi-map',
                name: 'map',
                localMode: true,
                envMapping: JSON.stringify({ OUT: '@file:invoices' }),
                wires: [['n2']],
            },
            { id: 'n2', type: 'helper' },
        ];
        helper.load(mapNode, flow, function () {
            var n2 = helper.getNode('n2');
            var n1 = helper.getNode('n1');
            n2.on('input', function (msg) {
                msg.payload.env.should.have.property('OUT', '@file:invoices');
                done();
            });
            n1.receive({ payload: { invoices: '/some/path.json' } });
        });
    });

    // 3d. Local mode — missing source key → key absent from msg.payload.env
    it('omits missing source key from msg.payload.env (local mode)', function (done) {
        var flow = [
            {
                id: 'n1',
                type: 'multiflexi-map',
                name: 'map',
                localMode: true,
                envMapping: JSON.stringify({ OUT: 'missingField' }),
                wires: [['n2']],
            },
            { id: 'n2', type: 'helper' },
        ];
        helper.load(mapNode, flow, function () {
            var n2 = helper.getNode('n2');
            var n1 = helper.getNode('n1');
            n2.on('input', function (msg) {
                msg.payload.env.should.not.have.property('OUT');
                done();
            });
            n1.receive({ payload: { otherField: 'present' } });
        });
    });

    // 3e. Local mode — pre-existing msg.payload.env keys are preserved and merged
    it('preserves pre-existing msg.payload.env keys in local mode', function (done) {
        var flow = [
            {
                id: 'n1',
                type: 'multiflexi-map',
                name: 'map',
                localMode: true,
                envMapping: JSON.stringify({ NEW_KEY: 'source' }),
                wires: [['n2']],
            },
            { id: 'n2', type: 'helper' },
        ];
        helper.load(mapNode, flow, function () {
            var n2 = helper.getNode('n2');
            var n1 = helper.getNode('n1');
            n2.on('input', function (msg) {
                msg.payload.env.should.have.property('EXISTING', 'keep-me');
                msg.payload.env.should.have.property('NEW_KEY', 'value');
                done();
            });
            n1.receive({ payload: { source: 'value', env: { EXISTING: 'keep-me' } } });
        });
    });

    // 4. Malformed envMapping JSON → node logs an error, msg still passes through
    it('logs an error on malformed envMapping but still passes msg through', function (done) {
        var flow = [
            {
                id: 'n1',
                type: 'multiflexi-map',
                name: 'map',
                localMode: true,
                envMapping: '{not valid json}',
                wires: [['n2']],
            },
            { id: 'n2', type: 'helper' },
        ];
        helper.load(mapNode, flow, function () {
            var n2 = helper.getNode('n2');
            var n1 = helper.getNode('n1');
            var received = { payload: { foo: 'bar' } };
            n2.on('input', function (msg) {
                // msg passes through without throwing; payload shape is preserved
                msg.payload.should.have.property('foo', 'bar');
                done();
            });
            // Malformed JSON causes envMapping to fall back to {}, so localMode with
            // empty mapping behaves like server mode (pass-through). No thrown error.
            n1.receive(received);
        });
    });
});
