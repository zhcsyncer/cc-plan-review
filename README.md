# Claude Code Plan Review Plugin

A Claude Code plugin that provides human review capability for Plan Mode. The plugin intercepts `ExitPlanMode` calls via hooks and opens a browser-based review interface where users can annotate and provide feedback on Claude-generated plans.

## Features

- **ExitPlanMode Interception**: Automatically intercepts plan submissions for human review
- **Inline Comments**: Attach comments to specific text selections (like GitLab MR review)
- **Batch Review**: Create multiple draft comments before submitting
- **Version History**: Track plan revisions with diff comparison
- **Real-time Updates**: SSE-based live updates in the browser

## Installation

### Via Claude Code CLI
```bash
# Add GitHub marketplace
claude plugin marketplace add zhcsyncer/cc-plan-review

# Install the plugin
claude plugin install cc-plan-review@cc-plan-review-marketplace
```

### Via Claude Code Interactive
```
/plugin marketplace add zhcsyncer/cc-plan-review
/plugin install cc-plan-review@cc-plan-review-marketplace
```

Or simply use `/plugin` and follow the interactive prompts.

### Update
```bash
claude plugin marketplace update
```

### From Source (Development)
```bash
git clone https://github.com/zhcsyncer/cc-plan-review.git
cd cc-plan-review
pnpm install && pnpm build
claude plugin add ./cc-plan-review
```

## How It Works

The plugin consists of two components working together:

### 1. Hooks (PreToolUse)
Intercepts `ExitPlanMode` calls and triggers the review workflow:
```
ExitPlanMode called → Hook intercepts → Opens browser → User reviews → Returns approve/block
```

### 2. MCP Server
Provides 4 tools for the review workflow:
- `request_human_review`: Create a review session
- `get_review_result`: Get review status and feedback
- `ask_questions`: Agent asks clarifying questions
- `update_plan`: Submit revised plan version

## Tech Stack

- **Frontend**: Vue 3, Rsbuild, TailwindCSS
- **Backend**: Node.js, Express 5, MCP SDK

## Development

```bash
pnpm install        # Install dependencies
pnpm dev            # Watch mode
pnpm build          # Full build (server + scripts + client)
pnpm start          # Start server
```

## API

- `GET /api/reviews/:id`: Get review state
- `POST /api/reviews/:id/comments`: Create draft comment
- `PUT /api/reviews/:id/comments/:commentId`: Update draft
- `DELETE /api/reviews/:id/comments/:commentId`: Delete draft
- `POST /api/reviews/:id/submit`: Submit review
