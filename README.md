# c9scaffold

An Electron application with React and TypeScript

## How the board knows it needs you

Every card state comes from Claude Code's own lifecycle hooks — no polling, no
screen scraping, no guessing.

| Card state | It means | Enters on | Leaves on |
| --- | --- | --- | --- |
| Working | Claude's turn | you submit a prompt / a tool runs | next event |
| Needs permission | Claude is blocked on an approval | the permission prompt | you approve or deny |
| Asking you | Claude asked you a question | the AskUserQuestion tool, or a turn ending in a question | you reply — viewing is not answering |
| Your turn | Claude finished; the prompt is waiting | any finished turn | you reply, or you view the session |
| Idle | nothing to do here | a fresh session, or a finished turn you already looked at | you submit a prompt |

Two honest footnotes:

- "A turn ending in a question" is the one text heuristic in the app — and it only
  picks the FLAVOR of attention (question vs. plain your-turn). A missed question
  still shows as **Your turn**. Heuristics never decide WHETHER you're told; only
  how loudly.
- Sessions launched by the app get one extra system-prompt line asking Claude to
  use its question tool (or end questions with `?`). It applies ONLY to sessions
  this app launches — it never touches your settings files or other sessions.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
