# Bob + Codex app-server integration

Research snapshot: 2026-07-21

## Bottom line

Bob can call Codex through `codex app-server`, create durable Codex threads, stream their work, resume them later, and handle approvals. The clean first integration is:

```text
Bob renderer
    -> narrow Electron IPC
Bob main process
    -> owns one `codex app-server --listen stdio://` child
    -> reads/writes JSONL JSON-RPC messages
Codex app-server
    -> uses the user's normal CODEX_HOME auth, config, and persisted threads
```

There are two different meanings of “share with the Codex app,” and they should not be conflated:

1. **Shared durable inventory:** yes. Codex clients that use the same `CODEX_HOME` share config, auth, sessions, and SQLite-backed state. A non-ephemeral thread Bob creates is therefore discoverable and resumable by another Codex client using the same home. OpenAI documents `CODEX_HOME` as the root for “config, auth, logs, sessions, skills, and standalone package metadata,” and `thread/list` pages through stored threads. ([environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables#core-locations), [app-server API overview](https://learn.chatgpt.com/docs/app-server#api-overview))
2. **Shared live event fanout:** only when clients are connected to the **same app-server instance** and subscribed to the same thread. Subscriptions are tracked per connection; `thread/start` auto-subscribes its caller, `thread/resume` rejoins a thread, and `thread/unsubscribe` removes that connection. The open-source implementation stores connection IDs per thread. ([API overview](https://learn.chatgpt.com/docs/app-server#api-overview), [connection subscription implementation](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/src/thread_state.rs#L453-L544))

The desktop app currently owns a private app-server child over stdio on this Mac. Stdio belongs to the process that spawned it; Bob cannot attach to that already-running stream. A separate Bob-owned app-server can share persisted inventory with the app, but it does **not** automatically make the desktop app a live subscriber to Bob's process.

OpenAI's public docs show how the **CLI TUI** can connect to a shared WebSocket app-server, but they do not document an equivalent “connect the Codex desktop app to this local endpoint” setting. Treat immediate desktop live co-presence as unproven until a supported desktop endpoint or a runtime smoke test establishes it. ([remote TUI docs](https://learn.chatgpt.com/docs/app-server#connect-the-cli-terminal-ui))

## What app-server is

OpenAI describes app-server as the interface used to power rich Codex clients. It is the right surface for a product that needs authentication, conversation history, approvals, and streamed agent events; OpenAI recommends the SDK instead for batch automation or CI. ([official app-server guide](https://learn.chatgpt.com/docs/app-server), [open-source implementation](https://github.com/openai/codex/tree/main/codex-rs/app-server))

Its public model has three levels:

- A **thread** is a durable conversation.
- A **turn** is one user request and the agent work it starts.
- An **item** is an input or output inside a turn, such as a message, plan, command execution, file change, or tool call.

That terminology is the current public API; older material may call threads “sessions.” A returned `Thread` also has a `sessionId`, used for threads in the same session tree, but Bob should persist and address the concrete `thread.id`. ([core primitives](https://learn.chatgpt.com/docs/app-server#core-primitives), [current `Thread` schema in source](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L170-L239))

## Transport and wire protocol

App-server uses bidirectional JSON-RPC 2.0 shapes, but deliberately omits the `"jsonrpc":"2.0"` member on the wire. Requests have `method`, `params`, and `id`; responses echo `id` with either `result` or `error`; notifications omit `id`. ([protocol and message schema](https://learn.chatgpt.com/docs/app-server#protocol))

Available transports are:

| Transport | Framing | Recommendation for Bob |
| --- | --- | --- |
| `stdio://` (default) | One JSON object per line (JSONL) | Use first. It is local, simple, and does not expose a listener. |
| `unix://` / `unix://PATH` | WebSocket handshake and frames over a Unix socket | Useful for multiple local clients on one server, but more lifecycle and framing work. |
| `ws://IP:PORT` | One JSON-RPC message per WebSocket text frame | Experimental and unsupported. Restrict to localhost or SSH forwarding; configure auth and TLS before any remote exposure. |
| `off` | No local transport | Not useful for Bob. |

The server's stdout is the protocol stream. Bob should keep stderr separate for logs and diagnostics. In WebSocket mode the server can return retryable error `-32001`, `Server overloaded; retry later`; clients should use exponential backoff with jitter. ([transport details](https://learn.chatgpt.com/docs/app-server#protocol))

For the first slice, Bob's Electron main process should spawn:

```bash
codex app-server --listen stdio://
```

Do not run app-server in the renderer, expose its raw protocol over broad IPC, or attempt to adopt the desktop app's existing stdio file descriptors.

## Exact connection lifecycle

### 1. Start and initialize once

Immediately after transport connection, send exactly one `initialize` request, then an `initialized` notification. Requests sent before this handshake fail with `Not initialized`; a second `initialize` fails with `Already initialized`. `clientInfo.name` identifies Bob in OpenAI compliance logs, so it should be stable and truthful. ([initialization docs](https://learn.chatgpt.com/docs/app-server#initialization))

```json
{"method":"initialize","id":1,"params":{"clientInfo":{"name":"bob","title":"Bob","version":"0.1.0"}}}
{"method":"initialized","params":{}}
```

The initialize response includes the effective `codexHome`. Bob should check it at startup and log the path, not credentials, because sharing depends on Bob and the Codex app resolving the same home.

Stay off the experimental API initially: omit `capabilities.experimentalApi` or set it to `false`. Notification suppression is exact-match and per connection through `capabilities.optOutNotificationMethods`. ([experimental opt-in](https://learn.chatgpt.com/docs/app-server#experimental-api-opt-in), [events](https://learn.chatgpt.com/docs/app-server#events))

### 2. Confirm authentication

Call:

```json
{"method":"account/read","id":2,"params":{"refreshToken":false}}
```

When Bob uses the user's normal `CODEX_HOME`, app-server can use the existing managed ChatGPT login. App-server also supports API-key login, managed ChatGPT browser/device-code flows, and experimental host-managed ChatGPT tokens. Bob should prefer the existing managed login for this local prototype and show a sign-in UX only when `account/read` says OpenAI auth is required. ([authentication modes and endpoints](https://learn.chatgpt.com/docs/app-server#auth-endpoints))

### 3. Start a persistent thread

```json
{"method":"thread/start","id":3,"params":{"cwd":"/absolute/path/to/project","sandbox":"read-only","approvalPolicy":"on-request","ephemeral":false}}
```

The response contains `result.thread.id`. Save it immediately. `thread/start` also emits `thread/started` and auto-subscribes Bob's connection to turn and item events. Do not set `ephemeral:true` for a thread that should appear in other clients: ephemeral threads are in-memory only and have no persisted path. ([lifecycle overview](https://learn.chatgpt.com/docs/app-server#lifecycle-overview), [API overview](https://learn.chatgpt.com/docs/app-server#api-overview))

Optionally give it a user-facing name:

```json
{"method":"thread/name/set","id":4,"params":{"threadId":"<thread-id>","name":"Bob: inspect this repository"}}
```

The first slice should begin read-only. Expand to `workspace-write` only when Bob has a real, visible approval experience.

### 4. Start a turn

```json
{"method":"turn/start","id":5,"params":{"threadId":"<thread-id>","input":[{"type":"text","text":"Summarize the architecture of this repository."}]}}
```

The response immediately returns the initial turn object. Save `result.turn.id`; it is required for precise cancellation and current steering APIs. The server then streams `turn/started`, `item/*`, and finally `turn/completed`. ([official getting-started example](https://learn.chatgpt.com/docs/app-server#getting-started), [turn API overview](https://learn.chatgpt.com/docs/app-server#api-overview))

While a regular turn is active:

- `turn/steer` appends user input to the in-flight turn rather than creating a new turn.
- `turn/interrupt` requests cancellation; completion arrives with status `interrupted`.

### 5. Stream events

Bob should treat events as a state machine, not as a text stream alone:

- `thread/status/changed`
- `turn/started`, `turn/completed`
- `turn/plan/updated`, `turn/diff/updated`
- `item/started`, `item/completed`
- `item/agentMessage/delta`
- `item/commandExecution/outputDelta`
- `serverRequest/resolved`
- warnings and authentication/rate-limit updates

Append deltas in order for live UI, but treat `item/completed` as the authoritative final item and `turn/completed` as the terminal turn state. `turn.completed.status` is `completed`, `interrupted`, or `failed`. ([events reference](https://learn.chatgpt.com/docs/app-server#events))

### 6. Handle reverse requests, especially approvals

Approvals are server-initiated JSON-RPC **requests**, not passive notifications. They carry an `id`; Bob must render an explicit decision UI and answer that same `id`.

For example:

```json
{"method":"item/commandExecution/requestApproval","id":91,"params":{"threadId":"...","turnId":"...","itemId":"...","command":"...","cwd":"..."}}
{"id":91,"result":{"decision":"accept"}}
```

Command decisions include `accept`, `acceptForSession`, `decline`, and `cancel`; file changes have a parallel `item/fileChange/requestApproval` flow. Network requests may include network-specific context and must be presented as such. After a decision, app-server emits `serverRequest/resolved` and eventually `item/completed`. ([approvals reference](https://learn.chatgpt.com/docs/app-server#approvals))

Bob must never translate a voice transcript such as “sure” into blanket approval without showing the exact command, paths, or network destination. Voice is input; it is not an approval bypass.

### 7. Resume after restart

Persist `thread.id` in Bob's own state. After a Bob/app-server restart and initialization:

```json
{"method":"thread/resume","id":6,"params":{"threadId":"<thread-id>"}}
```

Then send later `turn/start` calls to the same thread. Use `thread/read` when Bob only needs stored history without loading/resuming the conversation, and `thread/list` to discover stored threads. `thread/unsubscribe` stops this connection's turn/item stream; it does not delete the durable thread. ([API overview](https://learn.chatgpt.com/docs/app-server#api-overview))

## When will a Bob thread appear in the Codex app?

The durable path is well supported, but desktop UI refresh behavior is not an explicit public contract.

Evidence:

- Both the app/IDE-side Codex surfaces and app-server use `CODEX_HOME` for sessions and state. ([environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables#core-locations))
- `thread/list` reads stored thread logs and defaults to interactive sources. ([API overview](https://learn.chatgpt.com/docs/app-server#api-overview))
- In current open source, a bare app-server process defaults its session source to `vscode`, an interactive source, and list filtering defaults to the interactive source set. ([app-server default source](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/src/main.rs#L25-L41), [source filtering](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/src/filters.rs#L6-L50))
- Local read-only verification on 2026-07-21 started a separate stdio app-server against `/Users/yoavgal/.codex`; its `thread/list` returned the current Codex app task ID for this working directory with status `notLoaded`. This proves shared persisted inventory in the app-to-Bob direction while also proving that runtime loaded state was not shared across the two processes.
- A temporary ephemeral `thread/start` from a client named `bob_exploration` returned `source: "vscode"` on local CLI `0.144.6`, matching the current source default. Because the thread was ephemeral, the probe did not leave a durable Bob thread behind.

Inference: a non-ephemeral Bob thread created with the same `CODEX_HOME` should be visible to the desktop app's stored-thread listing, subject to the app's source filters and refresh timing. It does **not** prove that the desktop UI will receive Bob's in-flight deltas in real time.

Required acceptance test before claiming the feature:

1. Start a harmless read-only Bob thread, give it a unique name, and complete one turn.
2. Open or refresh the Codex desktop app and locate that exact name/thread ID.
3. Resume it in the app and verify the transcript.
4. Start a second Bob turn and verify Bob receives its own event stream.
5. If live two-client fanout is a requirement, connect two test clients to one shared app-server listener, resume the same thread from both, and verify both receive events. Do not use two independent stdio processes as proof of live fanout.

## Process ownership and versioning

Bob should own the child process in Electron main:

- Resolve a configurable Codex binary path; do not hard-code `/Applications/ChatGPT.app/Contents/Resources/codex`, which is an internal app bundle path and changes with app updates.
- Record `codex --version` and the initialize response's `codexHome` in diagnostics.
- Keep stdin/stdout open for the process lifetime; parse stdout line-by-line; keep stderr out of the JSON parser.
- Correlate every request ID with a pending promise and reject pending requests when the child exits.
- Persist thread/turn IDs before presenting a task as started.
- On shutdown, interrupt an active turn if appropriate, then close the child cleanly; on crash, restart, initialize, and `thread/resume` from the stored ID.
- Keep approvals and credentials in main-process code; expose only narrow typed events/actions to the renderer.

The protocol is versioned by the executable, not by a separately stable package. Generate bindings from the exact binary Bob will launch:

```bash
codex app-server generate-ts --out ./generated/codex-app-server
# Or:
codex app-server generate-json-schema --out ./generated/codex-app-server
```

The generated output is guaranteed to match that Codex version. Only add `--experimental` if Bob also sets `capabilities.experimentalApi:true` and intentionally accepts that unstable surface. ([schema generation](https://learn.chatgpt.com/docs/app-server#message-schema), [source README](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/README.md#L50-L61))

Current local version snapshot, which illustrates why this matters:

- `codex` on `PATH`: `0.144.6`
- Codex desktop bundled binary: `0.145.0-alpha.27`
- Running standalone Unix daemon: `0.144.6`

Do not mix schemas generated by one of these binaries with another binary at runtime.

## Stability and security boundaries

- `codex app-server` is still exposed by the CLI as an experimental developer command and may change. Pin a known Codex version for Bob demos and regenerate/compile-check bindings on upgrades. ([developer command reference](https://learn.chatgpt.com/docs/developer-commands#codex-app-server))
- The core `initialize`, thread, turn, event, and approval flow is documented. Prefer it over experimental fields and methods for v1.
- WebSocket transport is explicitly experimental and unsupported. Use stdio for Bob v1. ([protocol docs](https://learn.chatgpt.com/docs/app-server#protocol))
- Do not expose an unauthenticated non-loopback WebSocket listener. For remote use, configure app-server WebSocket auth, TLS, and secret storage; do not put raw tokens on the command line. ([WebSocket auth guidance](https://learn.chatgpt.com/docs/app-server#protocol))
- A `thread/shellCommand` is documented as unsandboxed full access. Bob should not expose it as a generic voice action. ([API overview](https://learn.chatgpt.com/docs/app-server#api-overview))
- Avoid the experimental `thread/realtime/*` surface initially. Bob already owns voice/realtime interaction; app-server should first be the persistent coding-agent/tool execution side of the bridge.

## Recommended first spike

Build only a narrow adapter behind Electron main with these capabilities:

1. Spawn/stop app-server over stdio.
2. Initialize and verify `codexHome` plus `account/read`.
3. `thread/list`, `thread/start`, `thread/name/set`, `thread/resume`.
4. `turn/start`, `turn/steer`, `turn/interrupt`.
5. Normalize the key thread/turn/item notifications into Bob events.
6. Surface command/file/network approvals visibly and reply to reverse RPC.
7. Run the desktop visibility acceptance test above.

That proves the valuable boundary: Bob can hand a spoken or typed task to a real persistent Codex thread, narrate progress from app-server events, and leave a durable conversation the user can later open in Codex. True simultaneous desktop live co-presence should remain a separate spike until the desktop app exposes a documented shared-server connection path.

## Primary sources

- [Codex App Server — official guide](https://learn.chatgpt.com/docs/app-server)
- [Codex environment variables — official `CODEX_HOME` and `CODEX_SQLITE_HOME` reference](https://learn.chatgpt.com/docs/config-file/environment-variables#core-locations)
- [Codex developer commands — official app-server CLI reference](https://learn.chatgpt.com/docs/developer-commands#codex-app-server)
- [OpenAI Codex app-server source](https://github.com/openai/codex/tree/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server)
- [OpenAI Codex app-server protocol source](https://github.com/openai/codex/tree/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server-protocol)
