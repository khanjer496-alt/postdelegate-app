# PostDelegate

[![M8ven Verified](https://m8ven.ai/badge/mcp/khanjer496-alt-postdelegate-app-13xqfx?variant=verified&v=fee4f03680dda16e07c1b1925ba47624)](https://m8ven.ai/mcp/khanjer496-alt-postdelegate-app-13xqfx?s=readme)

PostDelegate is a social media scheduling workspace: plan posts on a calendar, publish them to your connected channels at the right time, review analytics, work with a team, and keep your media in one library. Posts can also be drafted and scheduled by AI assistants such as Claude and ChatGPT.

- Website: https://postdelegate.com
- Documentation: https://postdelegate.com/docs
- Application: https://app.postdelegate.com

## Open source

PostDelegate is open source. This repository is the complete source of the application running at app.postdelegate.com, including code we have modified from other open-source projects; the original copyright notices are kept in the files they belong to.

## Building

The build recipe and Dockerfiles are in [`deploy/postdelegate`](deploy/postdelegate). See [`deploy/postdelegate/BUILD.md`](deploy/postdelegate/BUILD.md) for the build command and notes. This repository is a pnpm monorepo: `apps/` holds the backend, orchestrator and frontend, and `libraries/` holds the shared code.

## License

PostDelegate is released under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, the AGPL requires that you offer its source to your users.
