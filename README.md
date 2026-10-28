# My Library

A small, private-by-default book catalog designed to run as a static GitHub Pages site. It is based on the existing `GGKHUB/LibraryManagementSystem` app's core book fields and workflows: title, author, ISBN, location (Home, Work, Loaned, Unknown), notes, search, sorting, details, edit/delete, and CSV import.

## Run locally

Open `index.html` in a browser. No build step or server-side runtime is needed.

## Publish on GitHub Pages

1. Put these files at the root of a new GitHub repository.
2. Push the default branch named `main`.
3. In **Settings → Pages**, choose **GitHub Actions** as the build and deployment source.
4. The included workflow deploys the site after each push. The live address is `https://<owner>.github.io/<repository>/`.

## Your book data

The site stores your catalog in this browser's `localStorage`. The book list is not uploaded to GitHub or sent to a server, and it does not automatically sync between browsers or devices. Use **Export CSV** for a backup and **Import CSV** to restore or add rows. Keep a backup before clearing browser storage.

The CSV import expects a `Title` header. It also accepts `Author`, `ISBN`, `Location`, `Description`, and `Tags` columns. Location values are `Home`, `Work`, `Loaned`, and `Unknown`.

