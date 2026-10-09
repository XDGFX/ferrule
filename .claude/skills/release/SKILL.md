---
name: release
description: Cut a ferrule release — bump the version, tag it and publish a GitHub Release with a changelog. Use after a PR that changes what ferrule draws or reads merges to main, or when asked to release, tag or ship a version.
---

# Release ferrule

A GitHub Release is ferrule's changelog. Consumers install from a git tag
(`npm install github:XDGFX/ferrule#vX.Y.Z`), so the tag is the release and the Release page
is its notes. Nothing is published to npm.

## Steps

1. **Check main.** Work on `main`, clean and level with `origin/main`. The latest CI run on
   `main` is green (`gh run list --branch main --limit 1`). Done when all three hold.

2. **Pick the version.** Find the last tag with `git describe --tags --abbrev=0` and read every
   commit since it: `git log <last>..HEAD --format='%h %s%n%n%b'`. While ferrule is 0.x:
   - a new feature, YAML key, flag or output, or a change to how a diagram looks → minor
     (0.5.0 → 0.6.0)
   - fixes only → patch (0.5.0 → 0.5.1)

   If nothing since the last tag changes behaviour (docs, tests, refactors only), stop: there
   is nothing to release.

3. **Bump and commit.**
   - `npm version X.Y.Z --no-git-tag-version` updates `package.json` and `package-lock.json`.
   - Point the install line in `README.md` (`github:XDGFX/ferrule#v…`) at the new tag.
   - Commit those three files as `Release X.Y.Z` and push straight to `main`. Release commits
     skip the PR.

4. **Write the notes** to a file in the scratchpad: one bullet per change a user of ferrule
   would notice, written from the commit bodies, not the subjects. Name YAML keys, values and
   flags in code (`display`, `--format md`). Say what it does for the drawing or the
   reader, and what it replaced when that helps. Leave out review fixes, refactors, roadmap
   ticks, test-only changes and `Co-Authored-By` trailers. The Releases for v0.2.0, v0.3.0
   and v0.5.0 show the shape (`gh release view v0.5.0`).

5. **Publish.**

   ```bash
   gh release create vX.Y.Z --target main --title "vX.Y.Z: <headline>" --notes-file <notes>
   git fetch --tags
   ```

   The headline is a short noun phrase naming the main change, such as `v0.4.0: Opt-in row
   wrapping` or `v0.2.0: Cut lists and connector pinouts`. Always pass `--title`. Without
   it, GitHub falls back to the commit subject and shows "Release X.Y.Z". `gh` creates the
   tag on GitHub at the tip of `main`, so step 3's push must land first.

Done when `gh release list` shows `vX.Y.Z` as Latest with its headline title, the tag points
at the `Release X.Y.Z` commit, and the README installs that tag.
