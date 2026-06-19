/**
 * Bundles a small shim that disables Monaco's web workers. Monaco's language
 * services (JSON validation, syntax highlighting) work synchronously in the
 * main thread, which is fine for our read-mostly alert rule editor and keeps
 * the build simple.
 */

(self as unknown as { __mallardMonacoWorkersLoaded?: boolean }).__mallardMonacoWorkersLoaded = true;
