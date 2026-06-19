#!/bin/bash
while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    val="${val%%  #*}"
    val="${val%% #*}"
    val="${val%"${val##*[![:space:]]}"}"
    export "${key}=${val}" 2>/dev/null || true
done < .env
exec ./tmp/megamall-crm
