# Flow Structure

This app is a static single-page field app. `index.html` owns only the shell, while page markup, styling, and behavior are split by responsibility.

## App Shell

- `index.html` - app shell and script/style loading only.
- `src/pages/*.html` - screen markup split by page.
- `src/pages/partials/*.html` - shared modal and sheet markup.
- `src/css/styles.css` - all app styles.
- `src/js/state.js` - shared app state, constants, mock jobs, i18n, and shared icon strings.
- `src/js/navigation.js` - screen switching helpers.
- `src/js/page-loader.js` - loads page partials into the app shell.
- `src/js/common.js` - cross-flow utilities such as draft save, job completion, and toast.
- `src/js/app.js` - bootstraps the app on `DOMContentLoaded`.

## Page Markup

- `src/pages/login.html` - login screen.
- `src/pages/dashboard.html` - appointments dashboard.
- `src/pages/job.html` - current job checklist.
- `src/pages/preassessment.html` - pre-assessment form.
- `src/pages/assessment.html` - water assessment overview.
- `src/pages/tap-photo.html` - tap photo sub-screen.
- `src/pages/visual-check.html` - visual check sub-screen.
- `src/pages/meter-readings.html` - meter readings sub-screen.
- `src/pages/chlorine-test.html` - chlorine test sub-screen.
- `src/pages/pressure-flow.html` - pressure and flow sub-screen.
- `src/pages/infrastructure.html` - infrastructure sub-screen.
- `src/pages/score.html` - water score screen.
- `src/pages/payment.html` - payment screen.
- `src/pages/feedback.html` - feedback screen.

## Page Flows

- `src/js/flows/auth.js` - login flow.
- `src/js/flows/dashboard.js` - calendar, appointment list, appointment search, notifications, language, sign out, and month picker.
- `src/js/flows/job.js` - job detail checklist and package selection sheet.
- `src/js/flows/preassessment.js` - client/property pre-assessment form, postal lookup, owner radios, multi-selects, and consent completion.
- `src/js/flows/assessment.js` - tap management, assessment task completion, segment controls, photo previews, and full-package gating.
- `src/js/flows/score.js` - water score calculation, gauge rendering, key findings, readings table, and score sharing.
- `src/js/flows/payment.js` - package price display and payment method selection.
- `src/js/flows/feedback.js` - rating, feedback suggestion, review link, report link, and feedback completion.

## Editing Rule

Keep new page-specific behavior in the matching `src/js/flows/*.js` file. Put only truly shared helpers in `src/js/common.js`, and shared data/config in `src/js/state.js`.
