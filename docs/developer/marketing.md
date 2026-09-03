# Developer notes: marketing site

The public marketing site is **not** in this repository. It lives in the sibling `marketing/` directory of the Capability UI Protocol workspace.

See `../../marketing/docs/developer.md` from this file (workspace path `marketing/docs/developer.md`).

`createExampleDispatcher` in `examples/shared/host.ts` is the mount API that site uses. Keep it working when you change example HTTP routes or the generative UI assets.
