#!/bin/bash
ok=1
if RULES_FILE=mut/m1_owner.rules node --test tests/rules.test.mjs > mut/m1_owner.log 2>&1; then echo "m1_owner: НЕ ПОЙМАНА"; ok=0; else echo "m1_owner: поймана ($(grep -c "^not ok\|^    not ok" mut/m1_owner.log) падений)"; grep -E "^\s+not ok" mut/m1_owner.log | head -5; fi
if RULES_FILE=mut/m2_lock.rules node --test tests/rules.test.mjs > mut/m2_lock.log 2>&1; then echo "m2_lock: НЕ ПОЙМАНА"; ok=0; else echo "m2_lock: поймана ($(grep -c "^not ok\|^    not ok" mut/m2_lock.log) падений)"; grep -E "^\s+not ok" mut/m2_lock.log | head -5; fi
if RULES_FILE=mut/m3_seeall.rules node --test tests/rules.test.mjs > mut/m3_seeall.log 2>&1; then echo "m3_seeall: НЕ ПОЙМАНА"; ok=0; else echo "m3_seeall: поймана ($(grep -c "^not ok\|^    not ok" mut/m3_seeall.log) падений)"; grep -E "^\s+not ok" mut/m3_seeall.log | head -5; fi
if RULES_FILE=mut/m4_selfrole.rules node --test tests/rules.test.mjs > mut/m4_selfrole.log 2>&1; then echo "m4_selfrole: НЕ ПОЙМАНА"; ok=0; else echo "m4_selfrole: поймана ($(grep -c "^not ok\|^    not ok" mut/m4_selfrole.log) падений)"; grep -E "^\s+not ok" mut/m4_selfrole.log | head -5; fi
[ $ok = 1 ]
