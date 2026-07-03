## Summary
Disabling the WebView-accessible Android vault root-key bridge prevents new `native-device-bound` vault envelopes from being created, but it does not migrate Android clients that already persisted offline-vault state with `wrapper.kind = "native-device-bound"`.

## Problem
The shared frontend offline-vault code still requires native unwrap support to read those envelopes. After the bridge is disabled, existing Android installs with previously persisted `native-device-bound` vault state can no longer decrypt that state locally.

## Expected outcome
We need an explicit migration or recovery path so upgraded Android clients do not remain stuck with unreadable legacy native-device-bound offline-vault state.

## Notes
- Android-side bridge hardening should remain in place; raw vault root keys must not be bridged back into WebView JavaScript.
- Any fix likely spans the shared frontend vault flow and Android runtime coordination.
