// Wraps app.json to add the Firebase config for Android push (FCM).
// google-services.json is NOT committed (public repo): EAS builds get it from
// the secret file env var GOOGLE_SERVICES_JSON (preview/production/development).
// For a local build, drop the file next to this one (it's gitignored).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
});
