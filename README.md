# Kitz / KSA app

## Where everything lives

**Firebase project `kitzur-app1` is the home for everything:** student accounts, Firestore, Realtime Database, Storage (class files, kriah recordings), security rules, and the website. The homework site (`homework/`, site `ksa-homework`) is in it too.

`kitzur-app` is only a second web address: `kitzur-app.web.app` gets an identical copy of the site on every deploy so existing links keep working. Nothing else should ever be deployed there. When a custom domain is bought, connect it to `kitzur-app1` (Hosting → Add custom domain), then `kitzur-app` can be retired.

## Deploying

| What | Command | Goes to |
|---|---|---|
| Website (app, kriah bench, kriah data page) | `npm run deploy` | builds, then hosting on `kitzur-app1` **and** the `kitzur-app` mirror |
| Security rules (Firestore, Storage, Realtime DB) | `npm run deploy:rules` | `kitzur-app1` only. Replaces the live rules: compare with the Firebase console first |
| Homework site | `cd homework && firebase deploy` | `kitzur-app1` (site `ksa-homework`) |

Plain `firebase deploy` also targets `kitzur-app1` (the default in `.firebaserc`).

---

## Vite template notes

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
