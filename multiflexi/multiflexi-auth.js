'use strict';

/**
 * Node-RED adminAuth module for MultiFlexi.
 *
 * Validates Node-RED admin login against the MultiFlexi REST API's /login
 * endpoint (real password check, issues a MultiFlexi API token as a side
 * effect - discarded here, Node-RED keeps its own session).
 *
 * Every successfully-authenticated MultiFlexi user gets read-only Node-RED
 * access by default. Full edit access is reserved for the single admin
 * account configured by the deployment (see
 * multiflexi_server_nodered_admin_user/_admin_password_hash in the Ansible
 * role) - this module does not grant '*' to arbitrary MultiFlexi users.
 * Mapping specific MultiFlexi RBAC roles (see MultiFlexi\Rbac) onto Node-RED
 * permissions needs a REST endpoint exposing a user's roles, which does not
 * exist yet; until then, read-only is the safe default.
 *
 * Usage in settings.js:
 *   adminAuth: require('node-red-contrib-multiflexi/multiflexi/multiflexi-auth'),
 *
 * Configure the MultiFlexi API base URL via the MULTIFLEXI_URL environment
 * variable (default: http://localhost/multiflexi/api).
 */

const http = require('http');
const https = require('https');

const BASE_URL = (process.env.MULTIFLEXI_URL || 'http://localhost/multiflexi/api').replace(/\/+$/, '');
const LOGIN_URL = BASE_URL + '/VitexSoftware/MultiFlexi/1.0.0/login';
const DEFAULT_PERMISSIONS = 'read';
// How long a successful authenticate() result remains valid for getUser()
// lookups (node-red's bearer-token flow calls getUser() repeatedly without
// re-invoking authenticate()). Kept short so a disabled/removed MultiFlexi
// account loses Node-RED access reasonably quickly too.
const SESSION_TTL_MS = 5 * 60 * 1000;

// username -> { permissions, expiresAt } - populated ONLY by a successful
// authenticate() call below. getUser() never fabricates an entry.
const authenticatedSessions = new Map();

function tryLogin(method, loginUrl, username, password) {
    return new Promise(function (resolve) {
        let parsed;
        try {
            parsed = new URL(loginUrl);
            parsed.searchParams.set('username', username);
            parsed.searchParams.set('password', password);
        } catch (_) {
            return resolve({ ok: false, retryable: false });
        }

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: method,
            headers: { Accept: 'application/json' },
            timeout: 5000,
        };

        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.request(options, function (res) {
            let data = '';
            res.on('data', function (chunk) { data += chunk; });
            res.on('end', function () {
                // 404/405/501 means this method+URL shape doesn't match the
                // deployed API's routing/implementation convention (e.g.
                // multiflexi-api only implements bare GET /login,
                // multiflexi-server only implements POST /login.json) -
                // that's worth retrying with the other shape, not a login
                // failure.
                if (res.statusCode === 404 || res.statusCode === 405 || res.statusCode === 501) {
                    resolve({ ok: false, retryable: true });
                    return;
                }

                let parsedBody = null;
                try { parsedBody = JSON.parse(data); } catch (_) { /* ignore */ }

                resolve({ ok: res.statusCode === 200 && !!(parsedBody && parsedBody.token), retryable: false });
            });
        });
        req.on('error', function () { resolve({ ok: false, retryable: false }); });
        req.on('timeout', function () { req.destroy(); resolve({ ok: false, retryable: false }); });
        req.end();
    });
}

// Different MultiFlexi API backends implement login differently:
// multiflexi-api only has a bare GET /login handler, multiflexi-server
// only has a POST /login.json handler (its GET variant is an
// unimplemented stub). Try the more common GET+bare shape first, and
// fall back to POST+.json only if that shape isn't supported here.
function authenticate(username, password) {
    return tryLogin('GET', LOGIN_URL, username, password).then(function (result) {
        return result.retryable ? tryLogin('POST', LOGIN_URL + '.json', username, password) : result;
    }).then(function (result) {
        if (!result.ok) {
            return null;
        }

        authenticatedSessions.set(username, {
            permissions: DEFAULT_PERMISSIONS,
            expiresAt: Date.now() + SESSION_TTL_MS,
        });

        return { username: username, permissions: DEFAULT_PERMISSIONS };
    });
}

// node-red's bearerStrategy validates a session token via Tokens.get(), then
// looks up the full user object via Users.get(username). Only usernames with
// a live, unexpired entry from a prior authenticate() success resolve here -
// everyone else (including a username that was never authenticated, or whose
// session has expired) gets null, i.e. denied.
function getUser(username) {
    const session = authenticatedSessions.get(username);
    if (!session || session.expiresAt < Date.now()) {
        authenticatedSessions.delete(username);
        return Promise.resolve(null);
    }
    return Promise.resolve({ username: username, permissions: session.permissions });
}

module.exports = {
    type: 'credentials',
    users: getUser,
    authenticate: authenticate,
    // Exposed for tests only, to inspect/manipulate session expiry without
    // waiting on SESSION_TTL_MS.
    _authenticatedSessions: authenticatedSessions,
};
