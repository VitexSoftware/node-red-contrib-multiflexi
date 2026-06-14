'use strict';

var http = require('http');
var https = require('https');
var { URL } = require('url');

/**
 * MultiFlexi Map node.
 *
 * Server-backed binding editor for A→B job chaining (Phase 4).
 *
 * Stores an event_rule row on the MultiFlexi server that describes how the
 * output produced by RunTemplate A is mapped to the environment input of
 * RunTemplate B.  The actual chaining is performed server-side by
 * eventrules.php — this node is passive at runtime (pass-through).
 *
 * Optional "local transform" mode: when localMode is true the node resolves
 * the env_mapping against msg.payload and sets msg.payload.env so that a
 * downstream multiflexi-runtemplate node receives the derived overrides.
 */

// ---------------------------------------------------------------------------
// Shared HTTP helper — makes a JSON request to the MultiFlexi REST API.
// ---------------------------------------------------------------------------

function apiRequest(server, method, pathSuffix, body) {
    return new Promise(function (resolve, reject) {
        var base = server.baseUrl.replace(/\/+$/, '');
        var target;
        try {
            target = new URL(base + pathSuffix);
        } catch (e) {
            return reject(e);
        }

        var transport = target.protocol === 'https:' ? https : http;
        var payload = body ? JSON.stringify(body) : null;

        var auth = server.credentials
            ? Buffer.from(
                  (server.credentials.username || '') + ':' + (server.credentials.password || '')
              ).toString('base64')
            : '';

        var headers = { 'Accept': 'application/json' };
        if (payload) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        if (auth) {
            headers['Authorization'] = 'Basic ' + auth;
        }

        var options = {
            method: method,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: target.pathname + target.search,
            headers: headers,
        };

        var req = transport.request(options, function (res) {
            var data = '';
            res.on('data', function (chunk) { data += chunk; });
            res.on('end', function () {
                var parsed = data;
                try { parsed = JSON.parse(data); } catch (e) { /* keep raw */ }
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(parsed);
                } else {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + JSON.stringify(parsed)));
                }
            });
        });
        req.on('error', reject);
        if (payload) { req.write(payload); }
        req.end();
    });
}

// ---------------------------------------------------------------------------
// dot-path / JSONPath resolver used in local-mode transforms
// ---------------------------------------------------------------------------

function resolvePath(obj, selector) {
    if (!selector || typeof selector !== 'string') { return undefined; }
    // Strip leading "$." (JSONPath style)
    var path = selector.replace(/^\$\./, '');
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
        if (cur === null || cur === undefined) { return undefined; }
        cur = cur[parts[i]];
    }
    return cur;
}

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------

module.exports = function (RED) {

    function MultiFlexiMapNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.server = RED.nodes.getNode(config.server);
        node.sourceRuntemplateId = config.sourceRuntemplateId || '';
        node.targetRuntemplateId = config.targetRuntemplateId || '';
        node.ruleId = config.ruleId || '';
        node.localMode = config.localMode === true || config.localMode === 'true';

        // env_mapping is stored as a JSON string in the node config.
        var envMapping = {};
        try {
            envMapping = JSON.parse(config.envMapping || '{}') || {};
        } catch (e) {
            envMapping = {};
        }

        node.on('input', function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) { node.error(err, msg); } };

            if (node.localMode && Object.keys(envMapping).length > 0) {
                // Apply the env_mapping locally: resolve each selector against
                // msg.payload and accumulate into msg.payload.env.
                var source = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
                var env = Object.assign({}, (msg.payload && msg.payload.env) || {});

                Object.keys(envMapping).forEach(function (targetKey) {
                    var selector = envMapping[targetKey];
                    // @file:<producesName> selectors cannot be resolved locally;
                    // pass the selector value as-is so the downstream node at
                    // least sees the configured name.
                    if (typeof selector === 'string' && selector.indexOf('@file:') === 0) {
                        env[targetKey] = selector;
                    } else {
                        var value = resolvePath(source, selector);
                        if (value !== undefined) {
                            env[targetKey] = String(value);
                        }
                    }
                });

                if (!msg.payload || typeof msg.payload !== 'object') {
                    msg.payload = {};
                }
                msg.payload.env = env;
                node.status({ fill: 'green', shape: 'dot', text: 'mapped (local)' });
            } else {
                // Server-backed mode: chaining is handled by eventrules.php.
                // This node is a visual marker only; pass messages through unchanged.
                node.status({
                    fill: 'grey',
                    shape: 'ring',
                    text: 'server-side rule #' + (node.ruleId || '?'),
                });
            }

            send(msg);
            done();
        });
    }

    RED.nodes.registerType('multiflexi-map', MultiFlexiMapNode);

    // -----------------------------------------------------------------------
    // Admin HTTP endpoints used by the editor UI.
    // -----------------------------------------------------------------------

    /**
     * GET /multiflexi/map/runtemplates
     * Proxy to MultiFlexi API and return a flat list of run-templates.
     * The editor passes ?server=<configNodeId> as a query parameter.
     */
    RED.httpAdmin.get(
        '/multiflexi/map/runtemplates',
        RED.auth.needsPermission('multiflexi.read'),
        function (req, res) {
            var serverId = req.query.server;
            var serverNode = serverId ? RED.nodes.getNode(serverId) : null;
            if (!serverNode || !serverNode.baseUrl) {
                return res.status(400).json({ error: 'No server configured' });
            }
            apiRequest(serverNode, 'GET', '/runtemplate/', null)
                .then(function (data) { res.json(data); })
                .catch(function (err) { res.status(502).json({ error: err.message }); });
        }
    );

    /**
     * GET /multiflexi/map/app/:appId/produces
     * Return the produces object for an application.
     */
    RED.httpAdmin.get(
        '/multiflexi/map/app/:appId/produces',
        RED.auth.needsPermission('multiflexi.read'),
        function (req, res) {
            var serverId = req.query.server;
            var serverNode = serverId ? RED.nodes.getNode(serverId) : null;
            if (!serverNode || !serverNode.baseUrl) {
                return res.status(400).json({ error: 'No server configured' });
            }
            apiRequest(serverNode, 'GET', '/app/' + encodeURIComponent(req.params.appId) + '.json', null)
                .then(function (data) {
                    res.json(data && data.produces ? data.produces : {});
                })
                .catch(function (err) { res.status(502).json({ error: err.message }); });
        }
    );

    /**
     * GET /multiflexi/map/app/:appId/consumes
     * Return the consumes + environment keys for an application.
     */
    RED.httpAdmin.get(
        '/multiflexi/map/app/:appId/consumes',
        RED.auth.needsPermission('multiflexi.read'),
        function (req, res) {
            var serverId = req.query.server;
            var serverNode = serverId ? RED.nodes.getNode(serverId) : null;
            if (!serverNode || !serverNode.baseUrl) {
                return res.status(400).json({ error: 'No server configured' });
            }
            apiRequest(serverNode, 'GET', '/app/' + encodeURIComponent(req.params.appId) + '.json', null)
                .then(function (data) {
                    res.json({
                        consumes: (data && data.consumes) ? data.consumes : {},
                        environment: (data && data.environment) ? data.environment : {},
                    });
                })
                .catch(function (err) { res.status(502).json({ error: err.message }); });
        }
    );

    /**
     * POST /multiflexi/map/rule
     * Create a new event_rule on the MultiFlexi server.
     * Body must include: server, source_runtemplate_id, target_runtemplate_id, env_mapping
     */
    RED.httpAdmin.post(
        '/multiflexi/map/rule',
        RED.auth.needsPermission('multiflexi.write'),
        function (req, res) {
            var body = req.body || {};
            var serverId = body.server;
            var serverNode = serverId ? RED.nodes.getNode(serverId) : null;
            if (!serverNode || !serverNode.baseUrl) {
                return res.status(400).json({ error: 'No server configured' });
            }
            var ruleBody = {
                source_runtemplate_id: body.source_runtemplate_id,
                target_runtemplate_id: body.target_runtemplate_id,
                env_mapping: body.env_mapping || {},
            };
            apiRequest(serverNode, 'POST', '/eventrule/', ruleBody)
                .then(function (data) { res.json(data); })
                .catch(function (err) { res.status(502).json({ error: err.message }); });
        }
    );

    /**
     * PUT /multiflexi/map/rule/:id
     * Update an existing event_rule on the MultiFlexi server.
     */
    RED.httpAdmin.put(
        '/multiflexi/map/rule/:id',
        RED.auth.needsPermission('multiflexi.write'),
        function (req, res) {
            var body = req.body || {};
            var serverId = body.server;
            var serverNode = serverId ? RED.nodes.getNode(serverId) : null;
            if (!serverNode || !serverNode.baseUrl) {
                return res.status(400).json({ error: 'No server configured' });
            }
            var ruleBody = {
                source_runtemplate_id: body.source_runtemplate_id,
                target_runtemplate_id: body.target_runtemplate_id,
                env_mapping: body.env_mapping || {},
            };
            apiRequest(serverNode, 'PUT', '/eventrule/' + encodeURIComponent(req.params.id) + '.json', ruleBody)
                .then(function (data) { res.json(data); })
                .catch(function (err) { res.status(502).json({ error: err.message }); });
        }
    );
};
