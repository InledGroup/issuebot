# IssueBot

Discord bot running on Cloudflare Workers that connects Discord channels to GitHub Project Boards in the Inled-Pulsar-OS and InledGroup organizations.

## Overview

IssueBot allows community members and developers to report errors, propose suggestions, and view open issues on GitHub Project Boards directly from Discord by mentioning the bot.

Supported Project Boards:
- Inled-Pulsar-OS: https://github.com/orgs/Inled-Pulsar-OS/projects/1/views/2
- InledGroup: https://github.com/orgs/InledGroup/projects/1/views/1

---

## Commands and Usage

### 1. Interactive UI and Form Modals
Users can interact with IssueBot without typing syntax by clicking the inline buttons attached to bot responses:
- **Pulsar (All) / InledGroup**: Filter and display open issues from the selected board.
- **Errors / Ideas / Help**: Filter issues by category.
- **New Issue Button**: Opens a Discord modal form with fields for Organization, Type, Title, and Description.
- **Comment Button**: Opens a modal form to submit comments on any open issue number.
- **Close Issue Button**: Opens a modal form to close an issue with an optional reason.
- **Help Button**: Displays the interactive control center and command guide.

### 2. Adding an Issue via Text
Mention `@IssueBot` (or use `!issue`) and include:
- Issue type: `error` (or `bug`) or `suggestion` (or `idea`)
- Target organization: `pulsar` (for Inled-Pulsar-OS) or `inled` (for InledGroup)
- Description of the issue

Examples:
```
@IssueBot error pulsar Spotlight icon does not show in dock
@IssueBot suggestion pulsar Add dark mode toggle in control center
@IssueBot error inled Login button unresponsive in customer portal
@IssueBot suggestion inled Improve CLI installer output
```

The bot adds a draft issue to the corresponding GitHub Project Board, automatically tags it with the appropriate Type (Error or Idea), and responds with interactive buttons and links.

### 3. Viewing Issues from a Board
Mention `@IssueBot` with `view` and the target organization (`pulsar` or `inled`):
```
@IssueBot view pulsar
@IssueBot view pulsar error
@IssueBot view pulsar idea
@IssueBot view inled
```

### 4. Commenting on an Issue
Post a comment directly to a GitHub issue:
```
@IssueBot comment #223 Fixed in the upcoming test build
```

### 5. Closing an Issue
Close an issue on GitHub with an optional explanation:
```
@IssueBot close #223 Solved in Pear OS 1.0.4 ISO
```

### 6. Help and Guide
Display the interactive guide and buttons:
```
@IssueBot help
```

---

## Log Dashboard

IssueBot includes a built-in public activity log dashboard served at `/` and `/logs`:
- Real-time Gateway connection status
- Connected Discord bot identity
- Live event logs (issue creation, views, errors) with organization filtering
- Direct links to both GitHub Project Boards

---

## Configuration and Secrets

Configure the following secrets in Cloudflare Workers using Wrangler:

```bash
# Discord Bot Token
npx wrangler secret put DISCORD_BOT_TOKEN

# GitHub Personal Access Token (requires project and repo scopes)
npx wrangler secret put GITHUB_TOKEN
```

![](settings.png)

---

## Deployment

1. Install dependencies:
   ```bash
   npm install
   ```

2. Deploy to Cloudflare Workers:
   ```bash
   npm run deploy
   ```

3. Initialize Gateway Connection:
   Visit the deployed worker URL and click "Reconectar Gateway".

---

## License

MIT - InledGroup
