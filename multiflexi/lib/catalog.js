'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// kind grouping: payload key -> singular type prefix, msg property, and the
// MultiFlexi web image endpoint used to render the entity's icon.
const KINDS = [
    {
        key: 'companies', prefix: 'company', prop: 'company',
        script: 'companylogo.php', query: function (e) { return 'id=' + e.id; },
        skip: function () { return false; },
    },
    {
        key: 'runtemplates', prefix: 'runtemplate', prop: 'runtemplate',
        script: 'appimage.php', query: function (e) { return 'uuid=' + encodeURIComponent(e.app_uuid || ''); },
        skip: function (e) { return !e.app_uuid; },
    },
    {
        key: 'credentials', prefix: 'credential', prop: 'credential',
        script: 'credentialimage.php', query: function (e) { return 'id=' + e.id; },
        skip: function () { return false; },
    },
];

const CONTENT_TYPE_EXT = {
    'image/svg+xml': 'svg',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
};

/**
 * Catalog store: builds the per-entity MultiFlexi image URLs, fetches each icon
 * once and caches it as a node-red-served icon file, and persists a lean
 * catalog (with iconUrl + iconFile) for the editor to consume.
 *
 * Pure of Node-RED so it can be unit-tested directly.
 *
 * @param {object} opts { iconsDir, cacheFile, log? }
 */
function createStore(opts) {
    const iconsDir = opts.iconsDir;
    const cacheFile = opts.cacheFile;
    const log = opts.log || { warn: function () {} };

    /** Ensure the configured app URL ends with a single trailing slash. */
    function normaliseBase(appUrl) {
        let base = (appUrl || '/multiflexi/').trim();
        if (base.charAt(base.length - 1) !== '/') {
            base += '/';
        }
        return base;
    }

    /** Resolve a (possibly relative) app URL to an absolute one for server-side fetch. */
    function toAbsolute(base) {
        if (/^https?:\/\//i.test(base)) {
            return base;
        }
        // Relative path (e.g. "/multiflexi/") — resolve against the local web server.
        return 'http://127.0.0.1' + (base.charAt(0) === '/' ? '' : '/') + base;
    }

    function iconUrl(base, kind, entity) {
        return base + kind.script + '?' + kind.query(entity);
    }

    /** Fetch image bytes from an absolute URL. */
    function fetchIcon(absoluteUrl) {
        return new Promise(function (resolve, reject) {
            let target;
            try {
                target = new URL(absoluteUrl);
            } catch (e) {
                return reject(e);
            }
            const transport = target.protocol === 'https:' ? https : http;
            const req = transport.get(target, function (res) {
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error('HTTP ' + res.statusCode));
                }
                const ct = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
                const chunks = [];
                res.on('data', function (c) { chunks.push(c); });
                res.on('end', function () {
                    resolve({ buffer: Buffer.concat(chunks), ext: CONTENT_TYPE_EXT[ct] || 'svg' });
                });
            });
            req.on('error', reject);
            req.setTimeout(8000, function () { req.destroy(new Error('timeout')); });
        });
    }

    /** Fetch and cache one entity icon. Returns the written filename or null. */
    function cacheIcon(prefix, id, absoluteUrl) {
        return fetchIcon(absoluteUrl).then(function (img) {
            if (!img.buffer.length) {
                return null;
            }
            const filename = 'mf-' + prefix + '-' + id + '.' + img.ext;
            fs.mkdirSync(iconsDir, { recursive: true });
            fs.writeFileSync(path.join(iconsDir, filename), img.buffer);
            return filename;
        }).catch(function (e) {
            log.warn('multiflexi-catalog: icon fetch failed for ' + prefix + ' ' + id + ': ' + e.message);
            return null;
        });
    }

    /** Run task-producing functions with bounded concurrency. */
    function runPool(tasks, limit) {
        return new Promise(function (resolve) {
            if (tasks.length === 0) { return resolve(); }
            let index = 0;
            let finished = 0;

            function settle() {
                if (++finished === tasks.length) { resolve(); } else { pump(); }
            }
            function pump() {
                while (index < tasks.length && (index - finished) < limit) {
                    tasks[index++]().then(settle, settle);
                }
            }
            pump();
        });
    }

    /**
     * Build the lean catalog: attach the browser-resolvable iconUrl and fetch +
     * cache the served iconFile for each entity. Async, with bounded concurrency
     * so a large catalog doesn't overwhelm the MultiFlexi web server.
     */
    function ingest(raw, appUrl) {
        const base = normaliseBase(appUrl);
        const absBase = toAbsolute(base);
        const out = {};
        const tasks = [];

        KINDS.forEach(function (k) {
            out[k.key] = (Array.isArray(raw[k.key]) ? raw[k.key] : []).map(function (e) {
                const lean = Object.assign({}, e);
                if (k.skip(e)) {
                    lean.iconUrl = null;
                    lean.iconFile = null;
                    return lean;
                }
                lean.iconUrl = iconUrl(base, k, e);          // for the editor (browser)
                lean.iconFile = null;
                tasks.push(function () {
                    return cacheIcon(k.prefix, e.id, iconUrl(absBase, k, e)).then(function (f) {
                        lean.iconFile = f;                   // for the palette (served file)
                    });
                });
                return lean;
            });
        });

        return runPool(tasks, 6).then(function () { return out; });
    }

    function read() {
        try {
            return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        } catch (e) {
            return { companies: [], runtemplates: [], credentials: [] };
        }
    }

    function persist(catalog) {
        try {
            fs.writeFileSync(cacheFile, JSON.stringify(catalog, null, 2));
        } catch (e) {
            log.warn('multiflexi-catalog: could not persist catalog: ' + e.message);
        }
    }

    /** ingest + persist; resolves to the lean catalog. */
    function process(raw, appUrl) {
        return ingest(raw, appUrl).then(function (lean) {
            persist(lean);
            return lean;
        });
    }

    return { KINDS: KINDS, ingest: ingest, read: read, persist: persist, process: process };
}

module.exports = { createStore: createStore, KINDS: KINDS, CONTENT_TYPE_EXT: CONTENT_TYPE_EXT };
