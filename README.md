# My Library

A small book catalog designed to run as a static GitHub Pages site. It is based on the existing `GGKHUB/LibraryManagementSystem` app's core book fields and workflows: title, author, ISBN, location (Home, Work, Loaned, Unknown), notes, search, sorting, details, edit/delete, and CSV import.

## Run locally

Open `index.html` in a browser. No build step or server-side runtime is needed.

## Publish on GitHub Pages

1. Put these files at the root of a new GitHub repository.
2. Push the default branch named `main`.
3. In **Settings → Pages**, choose **GitHub Actions** as the build and deployment source.
4. The included workflow deploys the site after each push. The live address is `https://<owner>.github.io/<repository>/`.

## Cloud database setup (Firebase Spark)

1. Create a Firebase project on the no-cost **Spark** plan. Do not link a Cloud Billing account.
2. Create a Cloud Firestore database in Native mode.
3. In **Authentication → Sign-in method**, enable **Google**.
4. In **Authentication → Settings → Authorized domains**, add `ggkhub.github.io`.
5. Publish the rules in `firestore.rules` to Firestore.
6. Register a Web app in Firebase, copy its config into `firebase-config.js`, then commit and push. GitHub Actions will republish the Pages site.

The web config is public by design; it is not a database password. Firestore rules use Firebase Authentication's user ID so each signed-in user can access only their own books. Keep the project on Spark and do not link billing: Spark requires no payment method, and Firebase turns the affected service off for the rest of the quota period if its free quota is exceeded.

On first Google sign-in, the app offers to upload any books saved in this browser's old local storage. It keeps that local copy as a backup. Once synced, your catalog loads from Firestore and is available on other devices after you sign in.

For privacy, the app automatically signs you out after two minutes without activity. Activity in another open My Library tab resets the timer too.

## Your book data

Use **Export CSV** for a portable backup and **Import CSV** to restore or add rows.

The CSV import expects a `Title` header. It also accepts `Author`, `ISBN`, `Location`, `Description`, and `Tags` columns. Location values are `Home`, `Work`, `Loaned`, and `Unknown`.

