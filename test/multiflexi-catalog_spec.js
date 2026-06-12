'use strict';

var os = require('os');
var fs = require('fs');
var path = require('path');
var http = require('http');
var helper = require('node-red-node-test-helper');
var catalogNode = require('../multiflexi/multiflexi-catalog.js');
var { createStore } = require('../multiflexi/lib/catalog');

helper.init(require.resolve('node-red'));

var SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

var sampleCatalog = {
    event: 'catalog.update',
    companies: [{ id: 1, name: 'ACME', slug: 'acme', enabled: true }],
    runtemplates: [{ id: 15, name: 'Nightly', company_id: 1, app_id: 2, app_uuid: 'abc-uuid' }],
    credentials: [{ id: 3, name: 'Fio', company_id: 1, credential_type_id: 7 }],
};

describe('multiflexi catalog store (lib)', function () {
    var dir, iconsDir, cacheFile, store, imgServer, base, requested;

    beforeEach(function (done) {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-cat-'));
        iconsDir = path.join(dir, 'icons');
        cacheFile = path.join(dir, 'multiflexi-catalog.json');
        store = createStore({ iconsDir: iconsDir, cacheFile: cacheFile });
        requested = [];
        imgServer = http.createServer(function (req, res) {
            requested.push(req.url);
            res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
            res.end(SVG);
        });
        imgServer.listen(0, '127.0.0.1', function () {
            base = 'http://127.0.0.1:' + imgServer.address().port + '/';
            done();
        });
    });

    afterEach(function (done) {
        imgServer.close(function () {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
            done();
        });
    });

    it('builds image URLs, fetches + caches icons, records iconUrl/iconFile', function () {
        return store.ingest(sampleCatalog, base).then(function (lean) {
            // URLs hit the right endpoints
            lean.companies[0].iconUrl.should.equal(base + 'companylogo.php?id=1');
            lean.runtemplates[0].iconUrl.should.equal(base + 'appimage.php?uuid=abc-uuid');
            lean.credentials[0].iconUrl.should.equal(base + 'credentialimage.php?id=3');
            // each icon fetched + cached as a file
            lean.companies[0].iconFile.should.equal('mf-company-1.svg');
            fs.existsSync(path.join(iconsDir, 'mf-company-1.svg')).should.be.true();
            fs.existsSync(path.join(iconsDir, 'mf-runtemplate-15.svg')).should.be.true();
            fs.existsSync(path.join(iconsDir, 'mf-credential-3.svg')).should.be.true();
            requested.length.should.equal(3);
        });
    });

    it('skips run-templates without an app_uuid', function () {
        var c = { companies: [], runtemplates: [{ id: 9, name: 'x', app_uuid: '' }], credentials: [] };
        return store.ingest(c, base).then(function (lean) {
            (lean.runtemplates[0].iconUrl === null).should.be.true();
            (lean.runtemplates[0].iconFile === null).should.be.true();
        });
    });

    it('persists and reads back the lean catalog', function () {
        return store.process(sampleCatalog, base).then(function () {
            var back = store.read();
            back.companies[0].should.have.property('name', 'ACME');
            back.runtemplates[0].should.have.property('iconFile', 'mf-runtemplate-15.svg');
        });
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

    it('should be loaded with appUrl default', function (done) {
        var flow = [{ id: 'n1', type: 'multiflexi-catalog', name: 'cat', path: '/mf-cat', appUrl: '/multiflexi/' }];
        helper.load(catalogNode, flow, function () {
            var n1 = helper.getNode('n1');
            n1.should.have.property('name', 'cat');
            n1.should.have.property('appUrl', '/multiflexi/');
            done();
        });
    });

    it('serves the persisted catalog on the admin endpoint', function (done) {
        fs.writeFileSync(path.join(tmpDir, 'multiflexi-catalog.json'), JSON.stringify({
            companies: [{ id: 1, name: 'ACME', iconFile: 'mf-company-1.svg', iconUrl: '/multiflexi/companylogo.php?id=1' }],
            runtemplates: [], credentials: [],
        }));
        var flow = [{ id: 'n1', type: 'multiflexi-catalog', name: 'cat', path: '/mf-cat' }];
        helper.load(catalogNode, flow, function () {
            helper.request().get('/multiflexi-catalog/list').expect(200).end(function (err, res) {
                if (err) { return done(err); }
                res.body.companies[0].should.have.property('iconFile', 'mf-company-1.svg');
                done();
            });
        });
    });
});
