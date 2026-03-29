---
name: Save confirmation message
description: Always send a visible confirmation after saving anything to the workspace
type: feedback
---

After saving any memo, link, or file, always send a confirmation message to the user (via send_message or final response) indicating what was saved.

**Why:** User explicitly asked for this so they know the save happened.

**How to apply:** Any time something is written to disk on the user's behalf, follow up with a short "✅ Saved: [description]" style message.
