# PostDelegate

PostDelegate is a social media scheduling workspace: plan posts on a calendar, publish them to your connected channels at the right time, review analytics, work with a team, and keep your media in one library. Posts can also be drafted and scheduled by AI assistants such as Claude and ChatGPT.

- Website: https://postdelegate.com
- Documentation: https://postdelegate.com/docs
- Application: https://app.postdelegate.com

## Based on Postiz

PostDelegate is based on the open-source [Postiz](https://github.com/gitroomhq/postiz-app) project by Gitroom. We are grateful to its authors and contributors. This repository contains PostDelegate's modified version of that code.

## Building

The build recipe and Dockerfiles are in [`deploy/postdelegate`](deploy/postdelegate). See [`deploy/postdelegate/BUILD.md`](deploy/postdelegate/BUILD.md) for the build command and notes. This repository is a pnpm monorepo: `apps/` holds the backend, orchestrator and frontend, and `libraries/` holds the shared code.

## License

PostDelegate is released under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, the AGPL requires that you offer its source to your users.
