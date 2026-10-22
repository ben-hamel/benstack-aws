# Options for remembering and resuming project work

## The problem

After days or weeks away, I want to remember what I was trying to accomplish,
where I stopped, why I made decisions, and what to do next. I usually work in the
terminal and ask an agent or rely on memory, rather than regularly opening a
project-management app.

Two distinct needs:

- **Project continuity:** How do I pick this project back up?
- **Cross-project tracking:** Which project or task should I work on?

A task list helps with the second; a checkpoint with intent and context helps
with the first. Neither automatically solves the other.

## Current experiment

Use one persistent `STATUS.md` in the repo. Update it at the end of a session
rather than creating dated copies or a growing activity log. Capture the goal,
last verified state, uncertainties, and next action with its reason. Include a
resume prompt and references to existing docs/commits. Ask before committing.

Try this for two or three sessions before adding more tooling. The filename is a
local convention, not a research-backed standard. A changelog serves a different
purpose: recording changes, not current intentions and unfinished decisions.

## Alternatives and when to consider them

| Option | Possible fit | Caveat / evaluation status |
| --- | --- | --- |
| Tuxedo plus linked notes | Terminal task overview across projects, with longer context in Markdown | README reviewed; not installed or tested in this discussion |
| GitHub Issues | Track work beside code, commits, and PRs; useful if GitHub becomes a regular review destination | Suggested as an option, not trialled or compared systematically |
| Linear | A central backlog across multiple projects | Worth evaluating if repo-local notes become hard to manage; not researched in depth here |
| Obsidian | Project context alongside personal notes | Most useful if I actually return to it routinely; not evaluated here |
| Jira | Team-oriented work tracking where the team already uses it | No identified need to introduce it for this personal continuity problem; not evaluated here |
| Beads / Gas Town | Candidate tools to investigate if agent task coordination becomes the problem | Mentioned only; capabilities and suitability were not verified here |
| Taskwarrior | CLI task tracking with projects and annotations | Documentation consulted; not tested, and not found superior to Tuxedo |

These are practical fit judgments, not rankings established by comparative
research. Avoid keeping the same mutable status in several places.

## Tuxedo: a potential next experiment

Project: <https://github.com/webstonehq/tuxedo>

Its README describes a terminal UI and scriptable CLI using plain `todo.txt`
files, project/context tags, and linked notes using `note:<path>`. Existing notes
can be opened with `o`; `O` can create/open a task note. Consult current docs for
path resolution and configuration before setting it up.

A possible workflow:

1. Open Tuxedo to choose a project/task.
2. Open its linked Markdown checkpoint for context.
3. Ask the agent to read the checkpoint, inspect current repo state, and discuss
   the next step before acting.
4. Update the checkpoint before stopping; update the task if its outcome changed.

The task is the index; the note holds the reasoning. Do not copy the full
checkpoint into both places. No need to migrate all projects to test this idea.
Taskwarrior was mentioned as a familiar example, not because a comparison showed
it was better than Tuxedo.

## Research and guidance consulted

### Human task resumption

[Parnin and Rugaber: Resumption Strategies for Interrupted Programming Tasks](https://chrisparnin.me/pdf/parnin-icpc09.pdf)

Research into how programmers reconstruct context after interruptions. Relevant
to preserving intentions and resumption cues instead of relying solely on code
history. This source was located through search; the PDF text was not fully
inspected during this discussion. Do not treat this note as a detailed literature
review, or assume findings about interruptions directly establish the best tool
for returning weeks later.

### Coding-agent continuity

[Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

The article describes using a persistent progress file alongside Git history to
help agents recover context between sessions. Its relevant passages were read.
This is practical engineering experience with agent workflows, not a controlled
comparison of human task-management tools.

[Matt Pocock: handoff skill](https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md)

The skill text was read. It writes a conversation handoff to the OS temporary
directory, references existing artifacts instead of duplicating them, suggests
skills, and calls for sensitive-information redaction. Its temporary destination
is less suitable as the sole durable reminder for returning days or weeks later.
It is useful inspiration for what to include, rather than a complete personal
project-tracking system.

[Taskwarrior manual](https://taskwarrior.org/docs/man/task.1/)

Search results from the manual confirmed project tagging and annotations. No
hands-on evaluation was performed in this discussion.

## When to change the approach

- **The checkpoint helps, but I lose track of which projects exist:** try Tuxedo
  as a cross-project index, retaining the checkpoint notes.
- **I need collaboration, discussion, or PR-linked tasks:** evaluate GitHub Issues.
- **I need a structured backlog across many projects:** evaluate Linear or another
  tracker against that specific need.
- **I already review personal notes regularly:** consider keeping context in
  Obsidian, with one authoritative home rather than duplicate status copies.
- **The file goes stale:** first fix the stopping routine. Another app will not
  automatically capture decisions or next steps either.
- **Agent dependencies or coordination become the bottleneck:** research Beads /
  Gas Town specifically before adopting them.

No tool was installed or configured as part of this discussion. The immediate
choice is a small checkpoint experiment, not a permanent commitment.
