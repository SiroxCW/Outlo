# Outlo Mail

Outlo Mail is an open source mail client for the Linux desktop. It has the layout and the shortcuts you know from Outlook on Windows, and it works with Outlook.com, Microsoft 365, Gmail and any IMAP account.

The project is in early development. There is no release yet.

## Development

You need Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

| Command             | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `npm run dev`       | Starts the app with hot reload                                        |
| `npm run dev:demo`  | Starts the app with hot reload on the demo data                       |
| `npm test`          | Runs the unit tests                                                   |
| `npm run lint`      | Checks the code with ESLint                                           |
| `npm run typecheck` | Checks the types                                                      |
| `npm run format`    | Formats the code with Prettier                                        |
| `npm run package`   | Builds the AppImage, .deb and .rpm packages into `dist/`              |
| `npm run icons`     | Renders `resources/icon.svg` into the PNG sizes in `resources/icons/` |

Building the .deb and .rpm packages on Fedora needs the `libxcrypt-compat` package.

The app starts without accounts. "Open the demo" on the first screen fills it with invented mail, and so does `npm run dev:demo`. The demo has a database of its own and never mixes with real accounts. A development build keeps its data in `~/.config/outlo-dev`. Delete that folder to start again from nothing.

The Flatpak manifest is in `packaging/flatpak/`. It is a first working version and not yet ready for Flathub.

## Source layout

```
src/main/       Electron main process: windows, security, starting the core
src/preload/    bridge between the UI and the core
src/renderer/   user interface (React and Fluent UI)
src/core/       background process: database, demo data, later the mail sync
src/shared/     code and types used by all of them
resources/      icons
packaging/      Flatpak manifest
```

## License

Outlo Mail is free software under the GNU General Public License, version 3. See [LICENSE](LICENSE).

The app includes the Selawik font by Microsoft under the SIL Open Font License. The licence text is in `src/renderer/public/fonts/LICENSE.txt`.

Outlo Mail is an independent project. It is not affiliated with, endorsed by or sponsored by Microsoft. Outlook and Microsoft are trademarks of the Microsoft group of companies.
