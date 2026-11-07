#!/bin/sh
# STAGING only. The release image is built with NEXT_PUBLIC_BACKEND_URL set to
# the production API, and Next.js inlines it into the frontend's server bundle,
# so an unpatched staging frontend would send logins and API calls to
# production. Rewrite that baked URL to this container's NEXT_PUBLIC_BACKEND_URL
# in the container's own writable layer (the image is unchanged), refuse to
# start if any copy remains, then run the image's normal command.
set -eu

from=${BAKED_BACKEND_URL:-https://app.postdelegate.com/api}
to=${NEXT_PUBLIC_BACKEND_URL:?NEXT_PUBLIC_BACKEND_URL must be set}
dir=/app/apps/frontend/.next

if [ "$from" != "$to" ]; then
    grep -rlF --exclude-dir=cache -- "$from" "$dir" | while IFS= read -r file; do
        sed -i "s#$from#$to#g" "$file"
    done
    if grep -rlF --exclude-dir=cache --exclude='*.map' -- "$from" "$dir" > /dev/null; then
        echo "frontend-url: $from is still present in $dir; refusing to start" >&2
        exit 1
    fi
    echo "frontend-url: frontend backend URL set to $to"
fi

exec "$@"
