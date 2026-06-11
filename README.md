# node-red-contrib-multiflexi

![node-red-contrib-multiflexi logo](node-red-contrib-multiflexi.svg?raw=true)

Node-RED nodes for visually orchestrating [MultiFlexi](https://multiflexi.eu/)
processes. Receive webhook and job events from the MultiFlexi event processor
(`multiflexi-eventor`) and schedule RunTemplates — the "arrows" in your flow
become the relationships between MultiFlexi processes.

## Nodes

| Node | Role | Direction |
|------|------|-----------|
| **multiflexi-config** | MultiFlexi REST API connection (base URL + Basic auth) | — |
| **multiflexi-event** | Receives forwarded events over HTTP; the *source* of arrows | MultiFlexi → Node-RED |
| **multiflexi-runtemplate** | Schedules a RunTemplate via `POST /job/`; the *target* of arrows | Node-RED → MultiFlexi |
| **multiflexi-artifact** | Splits a `job.completed` event into per-artifact messages for chaining | filter |
| **multiflexi-catalog** | Receives the MultiFlexi config catalog and builds one palette node per company / run-template / credential | MultiFlexi → Node-RED |

## Data flow

```
abraflexi-webhook-acceptor → changes_cache
            │ (poll)
   multiflexi-eventor daemon ──HTTP POST──▶ [multiflexi-event] ──▶ [multiflexi-runtemplate] ──HTTP──▶ MultiFlexi API
            │ (poll finished jobs)
            └─────────────────HTTP POST──▶ [multiflexi-event:job.completed] ─▶ [multiflexi-artifact] ─▶ [multiflexi-runtemplate]
```

## Setup

Install one of two ways:

**Debian package (recommended)** — installs to `/usr/share/nodejs/node-red-contrib-multiflexi`:

```sh
sudo apt install node-red-contrib-multiflexi
sudo systemctl restart node-red
```

**From source** into your Node-RED user directory (`~/.node-red`):

```sh
cd ~/.node-red
npm install /path/to/node-red-contrib-multiflexi
node-red-restart   # or restart Node-RED
```

Then configure the `multiflexi-eventor` daemon to forward events
(`/etc/multiflexi/multiflexi.env`):

```ini
NODERED_WEBHOOK_URL=http://YOUR-NODE-RED:1880/multiflexi-event
NODERED_FORWARD_CHANGES=true
# NODERED_TOKEN=optional-shared-secret
# Catalog feed — builds the dynamic palette (see below)
NODERED_CATALOG_URL=http://YOUR-NODE-RED:1880/multiflexi-catalog
```

Finally, import `examples/payment-confirmation.flow.json`, set the **Server** base
URL and credentials on the config node, and fill in the RunTemplate IDs.

## Dynamic palette from the MultiFlexi catalog

Drop a **multiflexi-catalog** node into a flow and set
`NODERED_CATALOG_URL` on the `multiflexi-eventor` daemon to that node's path
(default `/multiflexi-catalog`). The daemon then pushes the MultiFlexi
configuration catalog — every company, every enabled run-template and every
credential — to Node-RED.

For each entity the package registers a dedicated palette node, grouped under
**MultiFlexi Companies**, **MultiFlexi RunTemplates** and
**MultiFlexi Credentials**, each carrying the same icon it has in MultiFlexi.
Company and credential nodes stamp their identity onto the message
(`msg.company` / `msg.credential`); run-template nodes set `msg.runtemplate_id`
so they can feed a **multiflexi-runtemplate** node for scheduling.

**Reload the editor** after the first push to see the generated palette nodes.
The catalog is re-published periodically (`NODERED_CATALOG_INTERVAL`, default
300 s) and whenever its content changes.

## Example

`examples/payment-confirmation.flow.json` wires:

- **Payment received** (`webhook.change`, evidence `banka`/create) →
  **Payment Receipt Confirmation** RunTemplate.
- **Job completed** → **JSON output** artifact filter → **Data consumer**
  RunTemplate (output chaining).

## License

MIT
