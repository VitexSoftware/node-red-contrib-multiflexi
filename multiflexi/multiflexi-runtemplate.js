module.exports = function (RED) {
    'use strict';

    const { postJob } = require('./lib/postJob');

    /**
     * MultiFlexi RunTemplate (action) node.
     *
     * On each input message it schedules a job for the configured RunTemplate
     * via the MultiFlexi REST API (POST /job/). Environment overrides are taken
     * from the static node configuration merged with msg.payload.env (the
     * latter wins), so upstream event data can flow into the job.
     */
    function MultiFlexiRunTemplateNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.server = RED.nodes.getNode(config.server);
        node.runtemplateId = config.runtemplateId;
        node.executor = config.executor || '';
        node.scheduled = config.scheduled || 'now';

        // Static env overrides: array of { key, value }
        let staticEnv = {};
        try {
            (JSON.parse(config.env || '[]') || []).forEach(function (pair) {
                if (pair && pair.key) {
                    staticEnv[pair.key] = pair.value;
                }
            });
        } catch (e) {
            staticEnv = {};
        }

        node.on('input', function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) { node.error(err, msg); } };

            if (!node.server || !node.server.baseUrl) {
                done(new Error('No MultiFlexi server configured'));
                return;
            }

            const runtemplateId = parseInt(msg.runtemplate_id || node.runtemplateId, 10);
            if (!runtemplateId) {
                done(new Error('No runtemplate_id set'));
                return;
            }

            const env = Object.assign({}, staticEnv, (msg.payload && msg.payload.env) || {});

            const body = {
                runtemplate_id: runtemplateId,
                scheduled: msg.scheduled || node.scheduled || 'now',
            };
            if (node.executor) {
                body.executor = node.executor;
            }
            if (Object.keys(env).length > 0) {
                body.env = env;
            }

            node.status({ fill: 'blue', shape: 'dot', text: 'scheduling #' + runtemplateId });

            postJob(node.server, body)
                .then((result) => {
                    msg.payload = result;
                    node.status({ fill: 'green', shape: 'dot', text: 'job ' + (result.job_id || 'scheduled') });
                    send(msg);
                    done();
                })
                .catch((err) => {
                    node.status({ fill: 'red', shape: 'ring', text: 'failed' });
                    done(err);
                });
        });
    }

    RED.nodes.registerType('multiflexi-runtemplate', MultiFlexiRunTemplateNode);
};
