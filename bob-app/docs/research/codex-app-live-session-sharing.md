# Bob and Codex Desktop: true live session sharing

Research snapshot: 2026-07-21

## Conclusion

True live sharing is possible only when Bob and Codex Desktop are two initialized
connections to the **same app-server process**, and both connections are
subscribed to the same thread. The practical local topology is one managed
app-server daemon listening on its Unix socket:

```text
Bob/Gerb -- WebSocket over Unix socket --+
                                          +-- one codex app-server daemon -- one live thread
Desktop  -- WebSocket over Unix socket --+
```

Each client performs its own `initialize` handshake. The client that creates the
thread is subscribed automatically; the other client calls `thread/resume` for
the same `threadId`. The server keeps a set of connection IDs per thread and
fans each live thread event to that set. This is real live sharing: a turn
started or changed from Desktop is observable by Bob, and a turn started by Bob
is observable by Desktop, provided both remain connected and subscribed.
([protocol and lifecycle](https://learn.chatgpt.com/docs/app-server#lifecycle-overview),
[subscription state](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/src/thread_state.rs#L257-L365),
[event fanout](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/src/request_processors/thread_lifecycle.rs#L300-L343))

Sharing `CODEX_HOME` between two independent stdio app-servers is **not** live
sharing. It shares persisted thread inventory, but each process has its own
in-memory subscriber set and event stream.

## What the prep folder already built

The `hackathon-prep` Gerb implementation already contains the intended
experimental bridge:

- [`electron/codex-app-server.ts`](/Users/yoavgal/code/hackathon-prep/electron/codex-app-server.ts)
  starts the managed daemon, connects through `codex app-server proxy`, performs
  the WebSocket upgrade/framing, initializes Gerb, resumes its known threads,
  and tracks agent-message deltas, turn completion, disconnects, and approval
  attention.
- [`scripts/codex-shared-daemon.sh`](/Users/yoavgal/code/hackathon-prep/scripts/codex-shared-daemon.sh)
  prepares the daemon and launches Desktop once with the private local-daemon
  switch.
- [`README.md`](/Users/yoavgal/code/hackathon-prep/README.md) documents the
  experimental mode and its separate-server fallback.
- Gerb's `.env.local` currently opts into both
  `CODEX_APP_SERVER_USE_LOCAL_DAEMON=1` and
  `GERB_CODEX_APP_SERVER_MODE=shared`.

This is the correct architecture for the hackathon. It is not a supported
Desktop integration contract because the switch that redirects Desktop is
private.

## Why the ordinary Desktop app cannot be attached after launch

The public app-server interface supports:

- stdio: one JSONL stream owned by the process that spawned the server;
- a Unix socket: WebSocket connections over
  `$CODEX_HOME/app-server-control/app-server-control.sock`;
- `codex app-server proxy`: one raw byte tunnel from stdio to that Unix socket.

The Unix listener is the multi-client control plane. The proxy connects a new
client to that listener; it does not discover, duplicate, or hijack an
already-running Desktop stdio stream. A normal Desktop-launched stdio child
therefore cannot be proxied into a shared server after the fact.
([transport contract](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/README.md#L20-L42),
[proxy implementation](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/stdio-to-uds/src/lib.rs#L10-L16))

`codex --remote unix://...` is a documented way for the **terminal UI** to use
an existing socket. `codex app --help` exposes only a workspace path and
installer override; it has no documented Desktop endpoint option. The official
Desktop client implementation is not in the public `openai/codex` repository,
so the public source cannot establish a supported local Desktop attachment
path.

## The installed Desktop's private shared-daemon path

The installed app is ChatGPT/Codex Desktop `26.715.61943`. Inspection of its
packaged `app.asar` shows this private branch:

```text
CODEX_APP_SERVER_USE_LOCAL_DAEMON=1
  -> run `codex app-server daemon version`
  -> connect by WebSocket to
     $CODEX_HOME/app-server-control/app-server-control.sock
otherwise
  -> spawn a private app-server over stdio
```

The branch also declines the daemon path when Desktop is forced to a custom CLI
or host command. This environment variable is not in the official App Server
guide, CLI help, or public source. It must therefore be treated as a private,
version-specific experiment that can disappear or change with a Desktop
update.

The prep helper invokes it for one launch without persisting it globally:

```sh
./scripts/codex-shared-daemon.sh prepare
# Quit Desktop normally, then:
./scripts/codex-shared-daemon.sh launch
```

Equivalent launch command:

```sh
open --env CODEX_APP_SERVER_USE_LOCAL_DAEMON=1 -a /Applications/ChatGPT.app
```

Then Bob/Gerb connects to the same daemon using the prep adapter or an
equivalent Unix-socket WebSocket client. Both clients must use the same
`CODEX_HOME`, initialize separately, and `thread/resume` the same thread.

## Current local evidence

The mechanism has partially worked on this Mac:

- The managed daemon is running as standalone Codex `0.144.6` on
  `/Users/yoavgal/.codex/app-server-control/app-server-control.sock`.
- A prior private-flag Desktop launch logged a successful local
  `transport=websocket` initialization. During the Gerb smoke, Gerb reported
  shared connection mode, received live agent deltas and `turn/completed`, and
  the generated thread could be read/resumed in Desktop.
- This proves the private redirect and the Gerb-to-daemon live stream work. It
  does **not** yet prove the full visible two-client acceptance case where an
  in-flight change is seen simultaneously in both UIs and an approval is routed
  safely.

Sharing is **not active at the moment of this snapshot**. The currently running
Desktop PID has its own bundled Codex `0.145.0-alpha.27` app-server child over
stdio, while the standalone `0.144.6` daemon is a separate process. Merely
leaving the daemon running, or setting Gerb's environment variables, does not
move an already-running Desktop process onto it; Desktop must be quit and
relaunched with the private flag. The version split also makes this a demo
spike rather than a stable production boundary.

## Subscription and narration rules for Bob

Bob is not subscribed to every stored Codex thread merely because it shares
`CODEX_HOME`. For a thread Bob should monitor, it must retain its `threadId`,
call `thread/resume` on its daemon connection, and keep reading notifications.
After that it can tell the user about app-originated changes using:

- `turn/started` and `turn/completed`;
- `item/agentMessage/delta` and completed agent messages;
- `turn/plan/updated` and `turn/diff/updated`;
- command/file/tool progress and failures;
- approval and user-input requests that need attention.

The official event contract explicitly says to keep reading `turn/*` and
`item/*` after starting or resuming a thread, and notification opt-outs are
per connection. ([events](https://learn.chatgpt.com/docs/app-server#events),
[resume contract](https://learn.chatgpt.com/docs/app-server#resume-a-thread))

`thread/realtime/*` is unrelated to this requirement. It is an experimental
audio/realtime surface; the ordinary thread, turn, and item stream is what
provides shared coding-session state.

## Approval hazard (research-era policy)

The current hackathon implementation supersedes the policy below for
Bob-created and resumed Tasks: it uses approval policy `never` with
`danger-full-access`. The first-response behavior still matters when Bob
monitors a Task that another client created with interactive requests enabled.

Approval and user-input prompts are server-initiated requests, not passive
events. The current server sends the same request to all subscribed
connections, keeps one callback for that request ID, and removes it when the
first response arrives. In effect, **the first client response wins**.
([request fanout and callback](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/src/outgoing_message.rs#L287-L350),
[response consumption](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/src/outgoing_message.rs#L374-L452))

For the hackathon, Desktop should be the only approval authority. Bob may
narrate that attention is required, but it should not answer the reverse RPC.
If Desktop is absent, the turn will wait. A future production design needs an
explicit authority lease/fallback rather than letting two UIs race.

## Remote control and daemon do different jobs

The daemon is what changes the local process model from private stdio to a
multi-client Unix listener. Remote control optionally enrolls that same
app-server with OpenAI's remote-control service so authorized mobile/remote
clients can reach it. It does not merge two existing app-server processes and
does not redirect an already-running local Desktop stdio child.

The daemon lifecycle is explicitly experimental and Unix-only. Remote control
is therefore unnecessary for Bob on the same Mac; use the local Unix socket.
It becomes relevant only if Bob itself is on another authorized device.
([daemon README](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server-daemon/README.md#L1-L25),
[remote-control API](https://learn.chatgpt.com/docs/app-server#api-overview))

## Required final acceptance test

Before claiming the feature complete:

1. Quit Desktop and launch it with the private daemon flag; confirm its log says
   `transport=websocket` and no Desktop-owned stdio app-server child exists.
2. Start Gerb in strict shared mode and confirm both clients initialize against
   the same daemon/version.
3. Open/resume one uniquely named test thread in both clients.
4. Start a turn from Gerb; observe deltas and completion live in Desktop and
   Gerb without reopening or refreshing.
5. Start or steer a turn from Desktop; observe the same events in Gerb and have
   Gerb narrate the change.
6. Trigger one harmless approval; confirm Desktop alone can answer and Gerb only
   announces that attention is needed.
7. Disconnect/reconnect Gerb, call `thread/resume`, and verify live monitoring
   continues.

Until steps 4–6 pass together, the accurate status is: **the shared-daemon path
is implemented and partially smoke-tested, but simultaneous two-visible-client
sharing and approval ownership remain unverified.**

## Primary sources

- [Official Codex App Server guide](https://learn.chatgpt.com/docs/app-server)
- [OpenAI app-server protocol README, pinned source](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/README.md)
- [OpenAI connection/subscription state, pinned source](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/src/thread_state.rs)
- [OpenAI event listener/fanout, pinned source](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server/src/request_processors/thread_lifecycle.rs)
- [OpenAI app-server daemon README, pinned source](https://github.com/openai/codex/blob/0b175e6439a8608ba7726ee153fd8590619e8f34/codex-rs/app-server-daemon/README.md)
