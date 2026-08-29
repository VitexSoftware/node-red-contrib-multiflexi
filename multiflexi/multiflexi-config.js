module.exports = function (RED) {
    'use strict';

    /**
     * Configuration node holding the MultiFlexi REST API connection.
     *
     * baseUrl is the full API base including the version path, e.g.
     *   http://multiflexi.example.com/multiflexi/api/VitexSoftware/MultiFlexi/1.0.0
     *
     * The default base URL is derived from the MULTIFLEXI_URL environment variable
     * (pointing at the API root, e.g. http://localhost/multiflexi/api) and exposed
     * to the editor via the /multiflexi/default-url admin endpoint.
     */
    function MultiFlexiConfigNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
        // credentials.username / credentials.password / credentials.token are
        // managed by Node-RED's encrypted credential store.
    }

    RED.nodes.registerType('multiflexi-config', MultiFlexiConfigNode, {
        credentials: {
            username: { type: 'text' },
            password: { type: 'password' },
            token: { type: 'password' },
        },
    });

    // Expose the server-side default URL so the editor can pre-populate the field.
    RED.httpAdmin.get(
        '/multiflexi/default-url',
        RED.auth.needsPermission('multiflexi.read'),
        function (req, res) {
            const base = (process.env.MULTIFLEXI_URL || '').replace(/\/+$/, '');
            res.json({
                baseUrl: base ? base + '/VitexSoftware/MultiFlexi/1.0.0' : '',
            });
        },
    );
};
