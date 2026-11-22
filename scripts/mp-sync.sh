#!/bin/sh
# Copy the plan data and the Chinese UI strings from the site into the mini program (miniprogram/shared/ is
# gitignored, so run this after a fresh clone and whenever public/plans.js, public/charts.js or public/i18n-zh.js changes,
# then rebuild in WeChat DevTools and upload).
set -e
cd "$(dirname "$0")/.."
mkdir -p miniprogram/shared
cp public/plans.js public/charts.js public/i18n-zh.js miniprogram/shared/
echo "miniprogram/shared/ updated"
