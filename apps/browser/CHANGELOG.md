# Changelog

## 0.5.16

- fix(kernel): distinguish transient vault read failures from missing key so a temporary secrets-backend read error no longer masquerades as a missing credential (#8).
- fix(storage): harden browser local storage persistence (#7).

Release bump to publish the merged PR-drain fixes (#7, #8) to npm.
