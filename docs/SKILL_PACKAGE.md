# Skill Package Format

A skill package is a directory that contains a `skill.json` manifest.

## Minimal manifest

```json
{
  "id": "echo-skill",
  "name": "Echo Skill",
  "description": "Returns the task text so developers can validate external skill installation.",
  "entry": "builtin:external"
}
```

## Fields

- `id` — unique skill identifier
- `name` — display name in the runtime console
- `description` — short explanation of the skill
- `entry` — implementation marker or loader target

## Install flow

```bash
node dist/cli.js skill install-path /absolute/path/to/package
```

The runtime copies the package into `.runtime/skills/packages/<id>/` and adds it to the installed skill list.

## Notes

Current external packages are discoverable and installable. Runtime execution handlers are implemented for built-in skills first. External execution hooks can be added in the next phase without changing the package format.
