# Vector

I am **Vector**.
I live in your Slack DM as a CS rival, not a gentle tutor.
I do not pat you on the back.
I pressure your logic until it either sharpens or breaks.

## What I Do

- I run as a personal Slack app in one workspace.
- I fire CS questions, grade your answer quality through Codex CLI, and push harder follow-ups.
- I persist session, thread, and topic memory in SQLite through the `sqlite3` CLI.
- I track outcomes as `continue`, `blocked`, and `mastered`.
- I split mastery into `clean` (solved without getting stuck) and `recovered` (stuck first, then fought back and solved it).

## How I Run The Conversation

- Study challenges start from DM root messages.
- Your direct technical questions also start from DM root messages.
- I answer direct questions in their thread.
- Study evaluation and follow-up stay in thread replies.
- If you answer in DM root while a study thread is open, I pull you back into the thread and keep the fight there.

## Commands You Control Me With

- `!start`: start or resume the session
- `!stop`: pause the session
- `!help`: show usage

`!start` and `!stop` are silent controls.
No extra confirmation noise.

## My Stack

- Runtime: Node.js ESM
- LLM runner: `codex exec` or `claude -p`
- Persistence: SQLite (`sqlite3` CLI)
- Slack outbound: Web API client
- Slack inbound: Socket Mode transport

## Environment Variables

Copy `.env.example` to `.env`, then fill:

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `SLACK_DM_CHANNEL_ID`
- `LLM_PROVIDER` (`codex` or `claude`)
- `PROVIDERS_CONFIG_PATH` (default `./config/providers.yaml`)
- `OPENAI_API_KEY` (for codex provider config)
- `ANTHROPIC_API_KEY` (for claude provider config)
- `DATABASE_PATH`
- `VECTOR_DEBUG`
- `VECTOR_AUTO_START`
- `VECTOR_MACOS_LIFECYCLE`

Optional legacy overrides:

- `CODEX_COMMAND`
- `CODEX_MODEL`
- `CLAUDE_COMMAND`
- `CLAUDE_MODEL`
- `CLAUDE_TIMEOUT_MS`

Provider settings are loaded from YAML (`config/providers.yaml` by default):

```yaml
defaultProvider: codex

providers:
  codex:
    command: codex
    model: null
    env:
      OPENAI_API_KEY: ${OPENAI_API_KEY}

  claude:
    command: claude
    model: null
    timeoutMs: 120000
    env:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
```

## Run Me

```bash
npm test
npm start
```

## macOS Auto Boot

Install LaunchAgent:

```bash
./scripts/install-launch-agent.sh
```

Remove LaunchAgent:

```bash
./scripts/uninstall-launch-agent.sh
```

Template:
`ops/macos/com.donkeeman.vector.plist.template`

## Lifecycle Rules

- `VECTOR_AUTO_START=1`: I auto-start the session on app launch.
- `VECTOR_MACOS_LIFECYCLE=1`: sleep/lock => `stop`, wake/unlock => `start`.
- On lifecycle restart, I close stale study threads so each round starts clean.

Bring precision, and I escalate.
Bring fluff, and I dissect it in public.
