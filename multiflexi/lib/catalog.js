'use strict';

const fs = require('fs');
const path = require('path');

// kind grouping: payload key -> singular type prefix + msg property
const KINDS = [
    { key: 'companies', prefix: 'company', prop: 'company' },
    { key: 'runtemplates', prefix: 'runtemplate', prop: 'runtemplate' },
    { key: 'credentials', prefix: 'credential', prop: 'credential' },
];

const MIME_EXT = {
    'image/svg+xml': 'svg',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
};

/**
 * Catalog store: turns the raw catalog pushed by MultiFlexi into a lean catalog
 * (icon data URIs written to files, icon filename recorded) and persists it.
 *
 * Pure of Node-RED so it can be unit-tested directly.
 *
 * @param {object} opts { iconsDir, cacheFile, log? }
 */
function createStore(opts) {
    const iconsDir = opts.iconsDir;
    const cacheFile = opts.cacheFile;
    const log = opts.log || { warn: function () {} };

    /**
     * Decode a data: URI icon and write it into the icons dir.
     * Returns the written filename, or null when nothing usable was written.
     */
    function writeIcon(prefix, id, icon) {
        if (typeof icon !== 'string' || icon.indexOf('data:') !== 0) {
            return null;
        }
        const m = /^data:([^;]+);base64,(.*)$/s.exec(icon);
        if (!m) {
            return null;
        }
        const ext = MIME_EXT[m[1].toLowerCase()];
        if (!ext) {
            return null;
        }
        const filename = 'mf-' + prefix + '-' + id + '.' + ext;
        try {
            fs.mkdirSync(iconsDir, { recursive: true });
            fs.writeFileSync(path.join(iconsDir, filename), Buffer.from(m[2], 'base64'));
            return filename;
        } catch (e) {
            // Read-only install (e.g. system package): icons just won't update.
            log.warn('multiflexi-catalog: could not write icon ' + filename + ': ' + e.message);
            return null;
        }
    }

    /**
     * Strip bulky icon data URIs (writing them to files) and record the icon
     * filename instead. Does not persist.
     */
    function ingest(raw) {
        const out = {};
        KINDS.forEach(function (k) {
            out[k.key] = (Array.isArray(raw[k.key]) ? raw[k.key] : []).map(function (e) {
                const iconFile = writeIcon(k.prefix, e.id, e.icon);
                const lean = Object.assign({}, e);
                delete lean.icon;
                lean.iconFile = iconFile;
                return lean;
            });
        });
        return out;
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

    /** ingest + persist; returns the lean catalog. */
    function process(raw) {
        const lean = ingest(raw);
        persist(lean);
        return lean;
    }

    return { KINDS: KINDS, writeIcon: writeIcon, ingest: ingest, read: read, persist: persist, process: process };
}

module.exports = { createStore: createStore, KINDS: KINDS, MIME_EXT: MIME_EXT };
