'use strict';

const path = require('path');
const { postJob } = require('./lib/postJob');
const { createStore } = require('./lib/catalog');

/**
 * MultiFlexi Catalog node.
 *
 * Receives the MultiFlexi configuration catalog (companies, enabled
 * run-templates, credentials) pushed by the multiflexi-eventor daemon
 * (NodeRedCatalog -> NodeRedBridge::forwardCatalog) as an HTTP POST:
 *   { event: "catalog.update", companies: [...], runtemplates: [...], credentials: [...] }
 *
 * On receipt it writes each entity icon to <module>/icons/mf-<kind>-<id>.<ext>,
 * persists a lean catalog to <userDir>/multiflexi-catalog.json and emits it.
 *
 * From the persisted catalog the module dynamically registers one palette node
 * per company / run-template / credential, each using that entity's MultiFlexi
 * icon. The editor side (multiflexi-catalog.html) registers the matching editor
 * definitions by fetching the GET /multiflexi-catalog/list admin endpoint.
 */
module.exports = function (RED) {
    const store = createStore({
        iconsDir: path.join(__dirname, '..', 'icons'),
        cacheFile: path.join(RED.settings.userDir || '.', 'multiflexi-catalog.json'),
        log: RED.log,
    });

    // ---- dynamic per-entity runtime node constructors -------------------

    function stampCtor(prop, entity) {
        return function (config) {
            RED.nodes.createNode(this, config);
            const node = this;
            node.on('input', function (msg, send, done) {
                send = send || function () { node.send.apply(node, arguments); };
                done = done || function () {};
                msg[prop] = { id: entity.id, name: entity.name };
                send(msg);
                done();
            });
        };
    }

    function runTemplateCtor(entity) {
        return function (config) {
            RED.nodes.createNode(this, config);
            const node = this;
            node.server = RED.nodes.getNode(config.server);
            node.scheduled = config.scheduled || 'now';
            node.executor = config.executor || '';

            node.on('input', function (msg, send, done) {
                send = send || function () { node.send.apply(node, arguments); };
                done = done || function (err) { if (err) { node.error(err, msg); } };

                msg.runtemplate = { id: entity.id, name: entity.name };
                msg.runtemplate_id = entity.id;

                // Without a server configured this node just stamps the id and
                // passes through (feed it into a multiflexi-runtemplate node).
                if (!node.server || !node.server.baseUrl) {
                    send(msg);
                    done();
                    return;
                }

                const body = { runtemplate_id: entity.id, scheduled: msg.scheduled || node.scheduled || 'now' };
                if (node.executor) {
                    body.executor = node.executor;
                }
                const env = Object.assign({}, (msg.payload && msg.payload.env) || {});
                if (Object.keys(env).length > 0) {
                    body.env = env;
                }

                node.status({ fill: 'blue', shape: 'dot', text: 'scheduling #' + entity.id });
                postJob(node.server, body)
                    .then(function (result) {
                        msg.payload = result;
                        node.status({ fill: 'green', shape: 'dot', text: 'job ' + (result.job_id || 'scheduled') });
                        send(msg);
                        done();
                    })
                    .catch(function (err) {
                        node.status({ fill: 'red', shape: 'ring', text: 'failed' });
                        done(err);
                    });
            });
        };
    }

    /**
     * Register runtime constructors for every catalogued entity. Safe to call
     * repeatedly: types already registered are skipped.
     */
    function registerDynamic(catalog) {
        store.KINDS.forEach(function (k) {
            (catalog[k.key] || []).forEach(function (entity) {
                const type = 'multiflexi-' + k.prefix + '-' + entity.id;
                try {
                    const ctor = k.prefix === 'runtemplate' ? runTemplateCtor(entity) : stampCtor(k.prop, entity);
                    RED.nodes.registerType(type, ctor);
                } catch (e) {
                    // Already registered (re-push without restart) — ignore.
                }
            });
        });
    }

    // Register whatever we already know about at load time so deployed flows
    // referencing these types remain valid across restarts.
    registerDynamic(store.read());

    // ---- the catalog receiver node --------------------------------------

    function MultiFlexiCatalogNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        if (RED.settings.httpNodeRoot === false) {
            node.warn('node-red-contrib-multiflexi: httpNodeRoot is disabled; catalog node cannot register route');
            return;
        }

        const bodyParser = require('body-parser');
        let rawPath = (config.path || '/multiflexi-catalog').trim();
        if (rawPath[0] !== '/') { rawPath = '/' + rawPath; }
        node.path = rawPath;
        node.token = (node.credentials && node.credentials.token ? node.credentials.token : (config.token || '')).trim();

        // The catalog inlines every entity icon as a base64 data URI, so the
        // payload can be several MB. Use a generous dedicated limit rather than
        // apiMaxLength (which defaults to 5mb and would reject larger catalogs).
        const maxSize = RED.settings.multiflexiCatalogMaxLength || '64mb';
        const jsonParser = bodyParser.json({ limit: maxSize });

        function handlePost(req, res) {
            if (node.token) {
                const incoming = (req.headers['x-multiflexi-token'] || '').trim();
                if (incoming !== node.token) {
                    res.sendStatus(401);
                    node.warn('MultiFlexi catalog: rejected request with invalid X-MultiFlexi-Token from ' + req.ip);
                    return;
                }
            }

            res.sendStatus(200); // respond immediately so the daemon does not block

            const raw = req.body;
            if (!raw || typeof raw !== 'object') {
                node.status({ fill: 'yellow', shape: 'ring', text: 'empty body' });
                return;
            }

            const catalog = store.process(raw);
            registerDynamic(catalog); // make new types usable without a full restart

            const counts =
                catalog.companies.length + ' co / ' +
                catalog.runtemplates.length + ' rt / ' +
                catalog.credentials.length + ' cred';
            node.status({ fill: 'green', shape: 'dot', text: counts + ' @ ' + new Date().toLocaleTimeString() });
            node.send({ event: 'catalog.update', payload: catalog });
        }

        RED.httpNode.post(node.path, jsonParser, handlePost);

        node.on('close', function (done) {
            const stack = RED.httpNode._router && RED.httpNode._router.stack;
            if (stack) {
                for (let i = stack.length - 1; i >= 0; i--) {
                    const layer = stack[i];
                    if (layer.route && layer.route.path === node.path &&
                        layer.route.methods && layer.route.methods.post) {
                        stack.splice(i, 1);
                    }
                }
            }
            done();
        });
    }

    RED.nodes.registerType('multiflexi-catalog', MultiFlexiCatalogNode, {
        credentials: {
            token: { type: 'password' },
        },
    });

    // Admin endpoint the editor uses to build the dynamic palette entries.
    RED.httpAdmin.get('/multiflexi-catalog/list', RED.auth.needsPermission('multiflexi.read'), function (req, res) {
        res.json(store.read());
    });
};
