#!/bin/sh
# zypak lets Chromium use its sandbox inside the Flatpak sandbox.
exec zypak-wrapper /app/main/outlo "$@"
