'use strict';

var os = require('os');
var fs = require('fs');
var path = require('path');
var helper = require('node-red-node-test-helper');
var catalogNode = require('../multiflexi/multiflexi-catalog.js');
var { createStore } = require('../multiflexi/lib/catalog');

helper.init(require.resolve('node-red'));

// 1x1 transparent PNG as a data: URI (smallest valid icon payload)
var PNG_DATAURI =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

var sampleCatalog = {
    event: 'catalog.update',
    companies: [{ id: 1, name: 'ACME', slug: 'acme', enabled: true, icon: PNG_DATAURI }],
    runtemplates: [{ id: 15, name: 'Nightly', company_id: 1, app_id: 2 }],
    credentials: [{ id: 3, name: 'Fio', company_id: 1, credential_type_id: 7 }],
};

describe('multiflexi catalog store (lib)', function () {
    var dir, iconsDir, cacheFile, store;

    beforeEach(function () {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-cat-'));
        iconsDir = path.join(dir, 'icons');
        cacheFile = path.join(dir, 'multiflexi-catalog.json');
        store = createStore({ iconsDir: iconsDir, cacheFile: cacheFile });
    });

    afterEach(function () {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    });

    it('writes icons, strips data URIs and records iconFile', function () {
        var lean = store.ingest(sampleCatalog);
        lean.companies[0].should.have.property('name', 'ACME');
        lean.companies[0].should.not.have.property('icon');
        lean.companies[0].iconFile.should.equal('mf-company-1.png');
        fs.existsSync(path.join(iconsDir, 'mf-company-1.png')).should.be.true();
        // entities without an icon get iconFile = null
        (lean.runtemplates[0].iconFile === null).should.be.true();
    });

    it('persists and reads back the lean catalog', function () {
        var lean = store.process(sampleCatalog);
        lean.runtemplates[0].should.have.property('id', 15);
        var back = store.read();
        back.companies[0].should.have.property('name', 'ACME');
        back.credentials[0].should.have.property('credential_type_id', 7);
    });

    it('returns an empty catalog when no cache exists', function () {
        var empty = createStore({ iconsDir: iconsDir, cacheFile: path.join(dir, 'missing.json') }).read();
        empty.companies.should.have.length(0);
        empty.runtemplates.should.have.length(0);
        empty.credentials.should.have.length(0);
    });
});

describe('multiflexi-catalog node', function () {
    var tmpDir;

    beforeEach(function (done) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-node-'));
        helper.settings({ userDir: tmpDir });
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload().then(function () {
            helper.stopServer(done);
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        });
    });

    it('should be loaded', function (done) {
        var flow = [{ id: 'n1', type: 'multiflexi-catalog', name: 'cat', path: '/mf-cat' }];
        helper.load(catalogNode, flow, function () {
            var n1 = helper.getNode('n1');
            n1.should.have.property('name', 'cat');
            done();
        });
    });

    it('serves the persisted catalog on the admin endpoint', function (done) {
        // Seed the cache the node reads from (userDir/multiflexi-catalog.json).
        fs.writeFileSync(path.join(tmpDir, 'multiflexi-catalog.json'), JSON.stringify({
            companies: [{ id: 1, name: 'ACME', iconFile: 'mf-company-1.png' }],
            runtemplates: [{ id: 15, name: 'Nightly', iconFile: null }],
            credentials: [],
        }));
        var flow = [{ id: 'n1', type: 'multiflexi-catalog', name: 'cat', path: '/mf-cat' }];
        helper.load(catalogNode, flow, function () {
            helper.request()
                .get('/multiflexi-catalog/list')
                .expect(200)
                .end(function (err, res) {
                    if (err) { return done(err); }
                    res.body.companies[0].should.have.property('name', 'ACME');
                    res.body.companies[0].should.have.property('iconFile', 'mf-company-1.png');
                    res.body.runtemplates.should.have.length(1);
                    done();
                });
        });
    });
});
